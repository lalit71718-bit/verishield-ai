/**
 * KYC document tamper check (Aadhaar, PAN, salary slip, bank statement).
 *
 * Three kinds of evidence are combined:
 *   1. Identity-number rules   Aadhaar Verhoeff checksum, PAN structure, IFSC format.
 *   2. Arithmetic consistency  salary slip totals, bank statement running balance.
 *   3. File forensics          editing-tool signatures, incremental saves, date mismatch (PDF);
 *                              editor / AI-generator metadata (images).
 *
 * Output is "no tampering signs found / review manually / likely forged". It is never
 * "authentic": passing every check does not prove a document is genuine.
 */
const crypto = require('crypto');
const { analyzeImage } = require('./imageForensics');

/* ---------- Identity number rules ---------- */

// Verhoeff checksum tables (used by Aadhaar's 12th digit).
const D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]
];
const P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]
];
const INV = [0,4,3,2,1,5,6,7,8,9];

function verhoeffValid(num) {
  let c = 0;
  const digits = String(num).split('').reverse().map(Number);
  digits.forEach((d, i) => { c = D[c][P[i % 8][d]]; });
  return c === 0;
}

/** Compute the Verhoeff check digit for a numeric string (used to build test data). */
function verhoeffCheckDigit(num) {
  let c = 0;
  const digits = String(num).split('').reverse().map(Number);
  digits.forEach((d, i) => { c = D[c][P[(i + 1) % 8][d]]; });
  return INV[c];
}

function checkAadhaar(raw) {
  const n = String(raw || '').replace(/\s|-/g, '');
  if (!/^\d{12}$/.test(n)) return { ok: false, reason: 'An Aadhaar number has exactly 12 digits.' };
  if (/^[01]/.test(n)) return { ok: false, reason: 'Aadhaar numbers never start with 0 or 1.' };
  if (!verhoeffValid(n)) return { ok: false, reason: 'The last digit fails the Verhoeff checksum every real Aadhaar number passes.' };
  return { ok: true };
}

const PAN_HOLDER = { P: 'Individual', C: 'Company', H: 'HUF', F: 'Firm', A: 'AOP', T: 'Trust', B: 'BOI', L: 'Local authority', J: 'Artificial juridical person', G: 'Government' };

function checkPan(raw, name) {
  const pan = String(raw || '').toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return { ok: false, reason: 'A PAN is 5 letters, 4 digits and 1 letter.' };
  if (!PAN_HOLDER[pan[3]]) return { ok: false, reason: `The 4th character "${pan[3]}" is not a valid holder type.` };
  if (pan[3] === 'P' && name) {
    const parts = String(name).trim().toUpperCase().split(/\s+/);
    const surname = parts[parts.length - 1];
    if (surname && pan[4] !== surname[0]) {
      return { ok: false, reason: `For an individual the 5th character should be the first letter of the surname ("${surname[0]}"), but it is "${pan[4]}".` };
    }
  }
  return { ok: true, holder: PAN_HOLDER[pan[3]] };
}

const BANK_CODES = new Set(['SBIN', 'HDFC', 'ICIC', 'UTIB', 'PUNB', 'BARB', 'KKBK', 'CNRB', 'UBIN', 'IDIB', 'BKID', 'IOBA', 'YESB', 'INDB', 'FDRL', 'MAHB', 'CBIN', 'UCBA', 'KARB', 'SIBL']);

function checkIfsc(raw) {
  const ifsc = String(raw || '').toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { ok: false, reason: 'An IFSC is 4 letters, a zero, then 6 letters or digits.' };
  return { ok: true, known: BANK_CODES.has(ifsc.slice(0, 4)) };
}

/* ---------- Text parsing helpers ---------- */

const money = (s) => {
  const v = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};
const AMOUNT = '(-?[\\d,]+(?:\\.\\d{1,2})?)';

function findAmount(text, labelRegex) {
  const m = text.match(new RegExp(`${labelRegex}[^\\d\\n-]*${AMOUNT}`, 'i'));
  return m ? money(m[m.length - 1]) : null;
}

function parseSalary(text) {
  const earnLabels = ['basic(?: salary| pay)?', 'hra|house rent allowance', 'special allowance', 'conveyance(?: allowance)?', 'medical allowance', 'other allowance', 'bonus', 'overtime'];
  const parts = {};
  earnLabels.forEach((l) => {
    const v = findAmount(text, `(?:^|\\n)\\s*(?:${l})`);
    if (v !== null) parts[l.split('(')[0].split('|')[0]] = v;
  });
  return {
    parts,
    gross: findAmount(text, '(?:gross (?:earnings|salary|pay)|total earnings)'),
    deductions: findAmount(text, 'total deductions?'),
    net: findAmount(text, '(?:net (?:pay|salary|payable|amount)|take[- ]home)'),
    pf: findAmount(text, '(?:provident fund|\\bpf\\b|epf)'),
    basic: parts.basic ?? null
  };
}

function parseStatement(text) {
  const rows = [];
  const dateRe = /^\s*(\d{2}[\/-]\d{2}[\/-]\d{2,4})\s+(.*)$/;
  text.split('\n').forEach((line) => {
    const m = line.match(dateRe);
    if (!m) return;
    const nums = (m[2].match(/-?\d[\d,]*\.\d{2}/g) || []).map(money).filter((n) => n !== null);
    if (nums.length >= 2) rows.push({ date: m[1], amounts: nums.slice(0, -1), balance: nums[nums.length - 1], line: line.trim() });
  });
  const opening = findAmount(text, 'opening balance');
  return { rows, opening };
}

/* ---------- PDF forensics ---------- */

const EDITORS = [
  [/photoshop|illustrator|indesign/i, 'Adobe image/design tool'],
  [/canva/i, 'Canva'],
  [/ilovepdf|smallpdf|sejda|pdfescape|pdf24|sodapdf|pdf-?xchange|master pdf|foxit|nitro|pdffiller|lightpdf|pdfcandy|pdf2go/i, 'PDF editing tool'],
  [/acrobat(?! distiller)|adobe pdf library 1/i, 'Acrobat editor'],
  [/gimp|paint\.net|pixlr|fotor|picsart/i, 'Image editor']
];
const OFFICE_TOOLS = /microsoft.*word|ms ?word|libreoffice|openoffice|wps|google docs|pages|powerpoint/i;

function pdfDate(s) {
  const m = String(s || '').match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
}

function pdfForensics(buffer) {
  const raw = buffer.toString('latin1');
  const get = (key) => {
    const m = raw.match(new RegExp(`/${key}\\s*\\(([^)]*)\\)`)) || raw.match(new RegExp(`/${key}\\s*<([0-9A-Fa-f]+)>`));
    if (!m) return null;
    if (/^[0-9A-Fa-f]+$/.test(m[1]) && !m[0].includes('(')) {
      try { return Buffer.from(m[1], 'hex').toString('utf16le').replace(/^﻿/, '') || Buffer.from(m[1], 'hex').toString('latin1'); } catch (e) { return m[1]; }
    }
    return m[1];
  };
  const info = { producer: get('Producer'), creator: get('Creator'), creationDate: get('CreationDate'), modDate: get('ModDate') };
  const eofCount = (raw.match(/%%EOF/g) || []).length;
  const fonts = new Set((raw.match(/\/BaseFont\s*\/([A-Za-z0-9+_,-]+)/g) || []).map((s) => s.replace(/.*\//, '').replace(/^[A-Z]{6}\+/, '')));
  return { valid: raw.startsWith('%PDF-'), info, eofCount, fonts: [...fonts], bytes: buffer.length };
}

const zlib = require('zlib');

/** Minimal text extractor for simple PDFs: used when pdf-parse cannot open the file. */
function rawPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const out = [];
  const unescape = (s) => s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, g) => {
    if (/^[0-7]+$/.test(g)) return String.fromCharCode(parseInt(g, 8));
    return { n: '\n', r: '\r', t: '\t', b: '', f: '' }[g] ?? g;
  });
  const re = /<<([^>]*)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = re.lastIndex;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    let body = Buffer.from(raw.slice(start, end), 'latin1');
    if (/FlateDecode/.test(m[1])) { try { body = zlib.inflateSync(body); } catch (e) { continue; } }
    const content = body.toString('latin1');
    if (!/\bBT\b/.test(content)) continue;
    let line = '';
    const tok = /\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|\[((?:[^\]\\]|\\.)*)\]\s*TJ|(T\*|Td|TD|ET)\b/g;
    let t;
    while ((t = tok.exec(content))) {
      if (t[1] !== undefined) line += unescape(t[1]);
      else if (t[2] !== undefined) (t[2].match(/\(((?:\\.|[^\\)])*)\)/g) || []).forEach((p) => { line += unescape(p.slice(1, -1)); });
      else { if (line.trim()) out.push(line); line = ''; }
    }
    if (line.trim()) out.push(line);
  }
  return out.join('\n');
}

async function pdfText(buffer) {
  let text = '';
  let pages = 0;
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    text = data.text || '';
    pages = data.numpages || 0;
  } catch (e) { /* fall through to the raw extractor */ }
  if (!text.trim()) { try { text = rawPdfText(buffer); } catch (e) { /* no text */ } }
  return { text, pages };
}

/* ---------- Checks ---------- */

const WEIGHT = { high: 0.5, medium: 0.28, low: 0.1 };

function mkCheck(id, label, status, severity, detail) {
  return { id, label, status, severity, detail }; // status: pass | fail | info | skipped
}

async function analyzeDocument({ buffer, mimeType, fileName, docType, fields }) {
  const checks = [];
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const f = { ...(fields || {}) };
  const isPdf = /pdf/i.test(mimeType || '') || buffer.slice(0, 5).toString() === '%PDF-';
  const isImage = /^image\//i.test(mimeType || '') || /^(\x89PNG|\xff\xd8\xff|RIFF)/.test(buffer.slice(0, 4).toString('latin1'));
  let text = '';
  let fileKind = 'unknown';

  /* --- file forensics --- */
  if (isPdf) {
    fileKind = 'pdf';
    const pf = pdfForensics(buffer);
    const t = await pdfText(buffer);
    text = t.text;
    const producerText = `${pf.info.producer || ''} ${pf.info.creator || ''}`;

    if (!pf.valid) checks.push(mkCheck('structure', 'PDF structure', 'fail', 'high', 'The file does not start with a valid PDF header.'));
    else checks.push(mkCheck('structure', 'PDF structure', 'pass', 'low', 'Valid PDF header.'));

    const editor = EDITORS.find(([re]) => re.test(producerText));
    if (editor) checks.push(mkCheck('editor', 'Editing software', 'fail', 'high', `Created or saved with ${editor[1]} ("${producerText.trim()}"). Genuine KYC documents come straight from the issuer's system, not an editor.`));
    else if (OFFICE_TOOLS.test(producerText)) checks.push(mkCheck('editor', 'Editing software', 'fail', 'medium', `Made with an office word-processor ("${producerText.trim()}"). Bank and payroll systems do not produce documents this way.`));
    else checks.push(mkCheck('editor', 'Editing software', 'pass', 'low', producerText.trim() ? `Generator: ${producerText.trim()}. No known editing tool.` : 'No generator recorded.'));

    if (pf.eofCount > 1) checks.push(mkCheck('increments', 'Saved after creation', 'fail', 'high', `The file contains ${pf.eofCount} save blocks. Content was appended or replaced after the original was created, which is how text in a PDF is silently changed.`));
    else checks.push(mkCheck('increments', 'Saved after creation', 'pass', 'low', 'Single save block, no later edits appended.'));

    const c = pdfDate(pf.info.creationDate), m = pdfDate(pf.info.modDate);
    if (c && m && m - c > 60 * 1000) checks.push(mkCheck('dates', 'Creation vs modified date', 'fail', 'medium', `Modified ${Math.round((m - c) / 60000)} minutes after it was created.`));
    else if (c && m) checks.push(mkCheck('dates', 'Creation vs modified date', 'pass', 'low', 'Created and modified at the same time.'));

    if (pf.fonts.length >= 6) checks.push(mkCheck('fonts', 'Font mix', 'fail', 'low', `${pf.fonts.length} different fonts. Pasted-over text often brings in extra fonts.`));

    if (!text.trim()) checks.push(mkCheck('text', 'Readable text', 'info', 'low', 'This PDF has no selectable text (a scan). Enter the key details below so they can be checked.'));
  } else if (isImage) {
    fileKind = 'image';
    const img = analyzeImage(buffer);
    if (img.kind === 'ai') checks.push(mkCheck('image', 'Image origin', 'fail', 'high', img.anomalies[0] || 'Looks AI-generated.'));
    else if (img.kind === 'edited') checks.push(mkCheck('image', 'Image origin', 'fail', 'high', img.anomalies[0] || 'Saved by an image editor.'));
    else if (img.kind === 'camera') checks.push(mkCheck('image', 'Image origin', 'pass', 'low', 'Camera or scanner metadata present, no editor named.'));
    else checks.push(mkCheck('image', 'Image origin', 'info', 'low', 'No provenance metadata, so the origin cannot be confirmed from the file alone.'));
  } else {
    checks.push(mkCheck('format', 'File type', 'fail', 'medium', 'Not a PDF or a PNG/JPEG/WebP image.'));
  }

  /* --- identity numbers: typed by the user, otherwise read from the PDF text --- */
  const find = (re) => { const m = text.match(re); return m ? m[0] : null; };
  const aadhaar = f.aadhaar || (docType === 'aadhaar' ? find(/\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/) : null);
  const pan = f.pan || (['pan', 'salary', 'bank'].includes(docType) ? find(/\b[A-Z]{5}\d{4}[A-Z]\b/) : null);
  const ifsc = f.ifsc || (docType === 'bank' ? find(/\b[A-Z]{4}0[A-Z0-9]{6}\b/) : null);
  const nameMatch = text.match(/(?<!Father's |Father's |Mother's )\bName\s*:\s*([A-Za-z][A-Za-z .]+)/);
  const name = f.name || (nameMatch ? nameMatch[1].trim() : null);

  if (docType === 'aadhaar') {
    if (aadhaar) {
      const r = checkAadhaar(aadhaar);
      checks.push(mkCheck('aadhaar', 'Aadhaar number', r.ok ? 'pass' : 'fail', r.ok ? 'low' : 'high', r.ok ? 'Passes the Verhoeff checksum.' : r.reason));
    } else checks.push(mkCheck('aadhaar', 'Aadhaar number', 'skipped', 'low', 'No Aadhaar number found. Type it in to check it.'));
    if (text && !/aadhaar|unique identification|uidai|आधार/i.test(text)) checks.push(mkCheck('issuer', 'Issuer wording', 'fail', 'medium', 'The text does not mention Aadhaar or UIDAI.'));
  }
  if (docType === 'pan' || pan) {
    if (pan) {
      const r = checkPan(pan, name);
      checks.push(mkCheck('pan', 'PAN structure', r.ok ? 'pass' : 'fail', r.ok ? 'low' : 'high', r.ok ? `Valid format (${r.holder}).` : r.reason));
    } else checks.push(mkCheck('pan', 'PAN structure', 'skipped', 'low', 'No PAN found. Type it in to check it.'));
  }
  if (ifsc) {
    const r = checkIfsc(ifsc);
    checks.push(mkCheck('ifsc', 'IFSC code', r.ok ? (r.known ? 'pass' : 'info') : 'fail', r.ok ? 'low' : 'medium', r.ok ? (r.known ? 'Valid format and known bank code.' : 'Valid format, unfamiliar bank code.') : r.reason));
  }

  /* --- arithmetic --- */
  if (docType === 'salary') {
    const s = parseSalary(text);
    const gross = f.gross != null && f.gross !== '' ? money(f.gross) : s.gross;
    const net = f.net != null && f.net !== '' ? money(f.net) : s.net;
    const ded = s.deductions;
    const earned = Object.values(s.parts).reduce((a, b) => a + b, 0);
    if (gross != null && Object.keys(s.parts).length >= 2) {
      const ok = Math.abs(earned - gross) <= 1;
      checks.push(mkCheck('earnings', 'Earnings add up', ok ? 'pass' : 'fail', ok ? 'low' : 'high', ok ? `Components add up to the gross of ${gross.toLocaleString('en-IN')}.` : `Components add up to ${earned.toLocaleString('en-IN')} but the gross says ${gross.toLocaleString('en-IN')}.`));
    }
    if (gross != null && ded != null && net != null) {
      const ok = Math.abs(gross - ded - net) <= 1;
      checks.push(mkCheck('net', 'Net pay is correct', ok ? 'pass' : 'fail', ok ? 'low' : 'high', ok ? 'Gross minus deductions equals net pay.' : `Gross ${gross.toLocaleString('en-IN')} minus deductions ${ded.toLocaleString('en-IN')} should be ${(gross - ded).toLocaleString('en-IN')}, but net pay says ${net.toLocaleString('en-IN')}.`));
    }
    if (s.pf != null && s.basic) {
      const rate = s.pf / s.basic;
      const ok = rate >= 0.1 && rate <= 0.13;
      checks.push(mkCheck('pf', 'Provident fund rate', ok ? 'pass' : 'fail', 'low', ok ? 'PF is about 12% of basic pay.' : `PF is ${(rate * 100).toFixed(1)}% of basic pay. The usual employee share is 12%.`));
    }
    if (gross == null && net == null && !text) checks.push(mkCheck('earnings', 'Earnings add up', 'skipped', 'low', 'No readable figures. Enter gross and net pay to check them.'));
  }
  if (docType === 'bank') {
    const st = parseStatement(text);
    if (st.rows.length >= 3) {
      const bad = [];
      let prev = st.opening;
      st.rows.forEach((r, i) => {
        if (prev === null || prev === undefined) { prev = r.balance; return; }
        const delta = Math.abs(r.balance - prev);
        if (!r.amounts.some((a) => Math.abs(Math.abs(a) - delta) < 0.02)) bad.push({ row: i + 1, line: r.line });
        prev = r.balance;
      });
      if (bad.length) checks.push(mkCheck('balance', 'Running balance', 'fail', 'high', `${bad.length} row${bad.length > 1 ? 's' : ''} break the balance chain (first: row ${bad[0].row}, "${bad[0].line.slice(0, 70)}"). Edited amounts do not match the balances around them.`));
      else checks.push(mkCheck('balance', 'Running balance', 'pass', 'low', `All ${st.rows.length} transactions follow from the previous balance.`));
    } else if (isPdf) checks.push(mkCheck('balance', 'Running balance', 'skipped', 'low', 'Could not read transaction rows from this statement.'));
  }

  /* --- verdict --- */
  const fails = checks.filter((c) => c.status === 'fail');
  const pass = checks.filter((c) => c.status === 'pass').length;
  let keep = 1;
  fails.forEach((c) => { keep *= 1 - WEIGHT[c.severity]; });
  let score = Math.round((1 - keep) * 100);
  const strong = fails.filter((c) => c.severity === 'high').length;

  let verdict;
  if (score >= 60 || strong >= 2) verdict = 'LIKELY_FORGED';
  else if (score >= 25 || strong >= 1) verdict = 'REVIEW';
  else if (pass >= 2) verdict = 'NO_TAMPER_SIGNS';
  else verdict = 'UNVERIFIED';
  if (verdict === 'LIKELY_FORGED') score = Math.max(score, 70);

  const META = {
    LIKELY_FORGED: { tone: 'danger', title: 'Likely forged or edited', summary: 'Several independent checks failed. Do not accept this document.' },
    REVIEW: { tone: 'warn', title: 'Needs manual review', summary: 'At least one check failed. A human officer should look at the original.' },
    NO_TAMPER_SIGNS: { tone: 'safe', title: 'No tampering signs found', summary: 'Every check we could run passed. This is not proof the document is genuine.' },
    UNVERIFIED: { tone: 'accent', title: 'Not enough to check', summary: 'Too little could be read from this file. Enter the key details to run more checks.' }
  }[verdict];

  const advice = verdict === 'LIKELY_FORGED'
    ? ['Reject this document and ask for the original from the issuer.', 'Verify the number directly with the issuer (UIDAI, Income Tax, employer HR, bank branch).', 'Record the SHA-256 fingerprint below in your case notes.']
    : verdict === 'REVIEW'
      ? ['Ask the customer for the original or a fresh copy from the issuer.', 'Verify the failed items directly with the issuer before approving.']
      : ['Still confirm key details with the issuer for high-value decisions.', 'A clean result does not prove a document is genuine.'];

  return { verdict, ...META, score, sha256, fileKind, fileName: fileName || null, docType, checks, advice, disclaimer: 'Indicator only, not proof. Confirm with the issuing authority.' };
}

module.exports = { analyzeDocument, checkAadhaar, checkPan, checkIfsc, verhoeffValid, verhoeffCheckDigit, parseSalary, parseStatement, pdfForensics };
