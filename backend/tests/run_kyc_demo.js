/**
 * Runs the KYC fraud checks on the committed test files and writes a report that shows
 * both kinds of result (genuine passes, fraud is flagged), with misses reported too.
 *
 *   npm run demo:kyc
 *
 * Writes docs/KYC_TEST_REPORT.md and tests/results/kyc_demo.json.
 */
const fs = require('fs');
const path = require('path');
const { analyzeDocument } = require('../services/kycDocument');
const { decideLiveness } = require('../services/kycLiveness');
const { scoreVoice } = require('../services/voiceForensics');
const VF = require('../../frontend/voicefeatures.js');

const FIX = path.join(__dirname, 'fixtures');
const RESULTS = path.join(__dirname, 'results');
fs.mkdirSync(RESULTS, { recursive: true });
const AADHAAR_OK = '4821 7365 9049', AADHAAR_BAD = '4821 7365 9042';

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const FLAGGED = new Set(['LIKELY_FORGED', 'REVIEW']);

/* ---------------- 1. Documents ---------------- */
const DOCS = [
  ['genuine_aadhaar.pdf', 'aadhaar', {}, 'genuine'],
  ['genuine_pan.pdf', 'pan', {}, 'genuine'],
  ['genuine_salary_slip.pdf', 'salary', {}, 'genuine'],
  ['genuine_bank_statement.pdf', 'bank', {}, 'genuine'],
  ['genuine_aadhaar_photo.jpg', 'aadhaar', { aadhaar: AADHAAR_OK }, 'genuine'],
  ['tampered_aadhaar_checksum.pdf', 'aadhaar', {}, 'fraud'],
  ['tampered_aadhaar_photo.png', 'aadhaar', { aadhaar: AADHAAR_BAD }, 'fraud'],
  ['tampered_pan_surname.pdf', 'pan', {}, 'fraud'],
  ['tampered_salary_totals.pdf', 'salary', {}, 'fraud'],
  ['tampered_salary_word.pdf', 'salary', {}, 'fraud'],
  ['tampered_bank_statement.pdf', 'bank', {}, 'fraud']
];
const WHAT = {
  'genuine_aadhaar.pdf': 'Valid Aadhaar number, plain generator',
  'genuine_pan.pdf': 'Valid PAN, surname letter matches',
  'genuine_salary_slip.pdf': 'Earnings, deductions and net pay add up',
  'genuine_bank_statement.pdf': 'Every row follows from the previous balance',
  'genuine_aadhaar_photo.jpg': 'Camera photo (EXIF) with a valid number typed in',
  'tampered_aadhaar_checksum.pdf': 'Last digit changed + saved with Canva',
  'tampered_aadhaar_photo.png': 'Saved by Adobe Photoshop + number with wrong checksum',
  'tampered_pan_surname.pdf': '5th PAN letter does not match the surname',
  'tampered_salary_totals.pdf': 'Gross inflated and net pay raised by 25,000',
  'tampered_salary_word.pdf': 'Net pay raised, document made in Microsoft Word',
  'tampered_bank_statement.pdf': 'One credit edited to 79,900 and re-saved with iLovePDF'
};

async function runDocs() {
  const out = [];
  for (const [file, docType, fields, truth] of DOCS) {
    const buffer = fs.readFileSync(path.join(FIX, 'docs', file));
    const mimeType = file.endsWith('.pdf') ? 'application/pdf' : file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const r = await analyzeDocument({ buffer, mimeType, fileName: file, docType, fields });
    out.push({
      file, docType, truth, what: WHAT[file], verdict: r.verdict, score: r.score,
      failed: r.checks.filter((c) => c.status === 'fail').map((c) => c.label),
      correct: truth === 'genuine' ? !FLAGGED.has(r.verdict) : FLAGGED.has(r.verdict)
    });
  }
  return out;
}

/* ---------------- 2. Liveness ---------------- */
const SESSIONS = [
  ['Genuine customer follows 3 random actions', 'genuine', {
    challenges: [{ id: 'TURN_HEAD', passed: true, reactionMs: 2100 }, { id: 'BLINK_TWICE', passed: true, reactionMs: 1500 }, { id: 'SMILE', passed: true, reactionMs: 1100 }],
    features: { observedSeconds: 24, yawRangeDeg: 58, blinkCount: 7, blinksPerMin: 17, contourJitter: 1.15, expressionVariance: 0.052, faceVisibleRatio: 1, profileBreak: 0.04, sharpnessRatio: 1.05, colorShift: 0.03 }, maxFaces: 1
  }],
  ['Genuine customer, slower reactions', 'genuine', {
    challenges: [{ id: 'OPEN_MOUTH', passed: true, reactionMs: 3200 }, { id: 'SMILE', passed: true, reactionMs: 2600 }, { id: 'BLINK_TWICE', passed: true, reactionMs: 4100 }],
    features: { observedSeconds: 28, yawRangeDeg: 35, blinkCount: 6, blinksPerMin: 13, contourJitter: 1.3, expressionVariance: 0.04, faceVisibleRatio: 0.98, profileBreak: null, sharpnessRatio: 0.9, colorShift: 0.05 }, maxFaces: 1
  }],
  ['Photo held up to the camera', 'fraud', {
    challenges: [{ id: 'BLINK_TWICE', passed: false }, { id: 'SMILE', passed: false }, { id: 'TURN_HEAD', passed: false }],
    features: { observedSeconds: 22, yawRangeDeg: 2, blinkCount: 0, contourJitter: 1.0, expressionVariance: 0.001, faceVisibleRatio: 1 }, maxFaces: 1
  }],
  ['Real-time face-swap on a live call', 'fraud', {
    challenges: [{ id: 'TURN_HEAD', passed: true, reactionMs: 1900 }, { id: 'SMILE', passed: true, reactionMs: 1300 }, { id: 'OPEN_MOUTH', passed: true, reactionMs: 1600 }],
    features: { observedSeconds: 24, yawRangeDeg: 50, blinkCount: 1, blinksPerMin: 3, contourJitter: 3.3, expressionVariance: 0.03, faceVisibleRatio: 0.8, profileBreak: 0.82, sharpnessRatio: 0.3, colorShift: 0.19 }, maxFaces: 1
  }],
  ['Pre-recorded video replayed to the camera', 'fraud', {
    challenges: [{ id: 'SMILE', passed: true, reactionMs: 140 }, { id: 'TURN_HEAD', passed: false }, { id: 'OPEN_MOUTH', passed: false }],
    features: { observedSeconds: 22, yawRangeDeg: 30, blinkCount: 5, contourJitter: 1.2, expressionVariance: 0.04, faceVisibleRatio: 1 }, maxFaces: 1
  }],
  ['Coach standing next to the customer', 'fraud', {
    challenges: [{ id: 'TURN_HEAD', passed: true, reactionMs: 2000 }, { id: 'BLINK_TWICE', passed: true, reactionMs: 1700 }, { id: 'SMILE', passed: true, reactionMs: 1200 }],
    features: { observedSeconds: 24, yawRangeDeg: 50, blinkCount: 6, contourJitter: 1.2, expressionVariance: 0.05, faceVisibleRatio: 1, profileBreak: 0.05 }, maxFaces: 2
  }]
];
function runLiveness() {
  return SESSIONS.map(([name, truth, body]) => {
    const r = decideLiveness(body);
    return { name, truth, verdict: r.verdict, risk: r.riskScore, failed: r.checks.filter((c) => c.status === 'fail').map((c) => c.label), correct: truth === 'genuine' ? r.verdict === 'VERIFIED' : r.verdict !== 'VERIFIED' };
  });
}

/* ---------------- 3. Voice ---------------- */
function readWav(p) {
  const b = fs.readFileSync(p);
  const sr = b.readUInt32LE(24);
  let o = 12;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'data') { const f = new Float32Array(Math.floor(sz / 2)); for (let i = 0; i < f.length; i++) f[i] = b.readInt16LE(o + 8 + i * 2) / 32768; return { samples: f, sr }; }
    o += 8 + sz + (sz & 1);
  }
  throw new Error('no data chunk');
}
const VOICES = [
  ['human_clean_16k.wav', 'genuine', 'Real human speech (MediaPipe test recording)'],
  ['human_clean_48k.wav', 'genuine', 'Same real recording, 48 kHz'],
  ['human_phone_8k.wav', 'genuine', 'Real human speech through a simulated phone line'],
  ['kokoro_female_24k.wav', 'fraud', 'Kokoro neural TTS, female ("Hi mom, I am in trouble")'],
  ['kokoro_male_24k.wav', 'fraud', 'Kokoro neural TTS, male'],
  ['kokoro_british_24k.wav', 'fraud', 'Kokoro neural TTS, British'],
  ['kokoro_female_phone_8k.wav', 'fraud', 'Kokoro neural TTS through a simulated phone line'],
  ['espeak_male_22k.wav', 'fraud', 'espeak-ng classic TTS, male ("Hello, this is your bank")'],
  ['espeak_female_22k.wav', 'fraud', 'espeak-ng classic TTS, female']
];
function runVoice() {
  return VOICES.map(([file, truth, what]) => {
    const { samples, sr } = readWav(path.join(FIX, 'audio', file));
    const r = scoreVoice(VF.extract(samples, sr));
    const flagged = r.verdict === 'LIKELY_SYNTHETIC' || r.verdict === 'SUSPICIOUS';
    return { file, truth, what, verdict: r.verdict, score: r.score, correct: truth === 'genuine' ? !flagged : flagged };
  });
}

/* ---------------- Report ---------------- */
function holdoutSummary() {
  const p = path.join(RESULTS, 'voice_holdout.json');
  if (!fs.existsSync(p)) return null;
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  const model = JSON.parse(fs.readFileSync(path.join(__dirname, '../services/voiceModel.json'), 'utf8'));
  const groups = {};
  rows.forEach((r) => {
    const g = groups[r.group] || (groups[r.group] = { n: 0, ok: 0, truth: r.label });
    g.n++;
    // Judged at the same "be careful" threshold the product uses.
    if ((r.label === 'synthetic') === (r.probSynthetic >= model.thresholds.low)) g.ok++;
  });
  const flag = (r) => r.probSynthetic >= model.thresholds.low;
  const tot = { hOk: rows.filter((r) => r.label === 'human' && !flag(r)).length, hN: rows.filter((r) => r.label === 'human').length, sOk: rows.filter((r) => r.label === 'synthetic' && flag(r)).length, sN: rows.filter((r) => r.label === 'synthetic').length };
  return { groups, n: rows.length, model, tot };
}

(async () => {
  const docs = await runDocs();
  const live = runLiveness();
  const voice = runVoice();
  const hold = holdoutSummary();
  const sum = (rows, truth) => ({ n: rows.filter((r) => r.truth === truth).length, ok: rows.filter((r) => r.truth === truth && r.correct).length });
  const S = { docs: [sum(docs, 'genuine'), sum(docs, 'fraud')], live: [sum(live, 'genuine'), sum(live, 'fraud')], voice: [sum(voice, 'genuine'), sum(voice, 'fraud')] };

  const icon = (c) => (c ? 'yes' : '**NO**');
  const md = [];
  md.push('# KYC fraud checks: test report', '', `Generated by \`npm run demo:kyc\` on ${new Date().toISOString().slice(0, 10)}. Every row below is real output from the code in this repository.`, '');
  md.push('## Summary', '', '| Check | Genuine cases passed | Fraud cases flagged |', '|---|---|---|');
  md.push(`| Document tamper check | ${S.docs[0].ok}/${S.docs[0].n} | ${S.docs[1].ok}/${S.docs[1].n} |`);
  md.push(`| Video-KYC liveness (prepared measurements) | ${S.live[0].ok}/${S.live[0].n} | ${S.live[1].ok}/${S.live[1].n} |`);
  md.push(`| Voice-clone check, sample files (some seen in training) | ${S.voice[0].ok}/${S.voice[0].n} | ${S.voice[1].ok}/${S.voice[1].n} |`);
  if (hold) md.push(`| **Voice-clone check, held-out clips (the honest number)** | ${hold.tot.hOk}/${hold.tot.hN} (${pct(hold.tot.hOk, hold.tot.hN)}) | ${hold.tot.sOk}/${hold.tot.sN} (${pct(hold.tot.sOk, hold.tot.sN)}) |`);
  md.push('', '## 1. Document tamper check', '', 'Specimen documents with fake names and numbers, stamped "SPECIMEN - TEST DATA". "Flagged" means the verdict was *Needs manual review* or *Likely forged*.', '');
  md.push('| File | What it is | Truth | Verdict | Risk | Failed checks | Correct |', '|---|---|---|---|---|---|---|');
  docs.forEach((r) => md.push(`| ${r.file} | ${r.what} | ${r.truth} | ${r.verdict} | ${r.score} | ${r.failed.join(', ') || 'none'} | ${icon(r.correct)} |`));
  md.push('', '## 2. Video-KYC liveness', '', 'The scoring engine is run on prepared measurements for each situation (a person is not needed to reproduce it). The live camera path measures the same fields in the browser. A real still photo shown to the real camera pipeline is recorded separately below.', '');
  md.push('| Situation | Truth | Verdict | Risk | Failed checks | Correct |', '|---|---|---|---|---|---|');
  live.forEach((r) => md.push(`| ${r.name} | ${r.truth} | ${r.verdict} | ${r.risk} | ${r.failed.join(', ') || 'none'} | ${icon(r.correct)} |`));
  const bj = path.join(RESULTS, 'liveness_browser.json');
  if (fs.existsSync(bj)) {
    const b = JSON.parse(fs.readFileSync(bj, 'utf8'));
    md.push('', `**Real browser run (headless Chromium, real MediaPipe face model, a still photo as the camera):** ${b.note} Verdict: **${b.verdict}**, risk ${b.risk}. Failed checks: ${b.failed.join(', ')}.`);
  }
  md.push('', '## 3. Voice-clone check', '');
  md.push('### 3a. Committed sample files (also available as buttons on the KYC Desk page)', '', '| File | What it is | Truth | Verdict | Risk | Correct |', '|---|---|---|---|---|---|');
  voice.forEach((r) => md.push(`| ${r.file} | ${r.what} | ${r.truth} | ${r.verdict} | ${r.score} | ${icon(r.correct)} |`));
  if (hold) {
    const M = hold.model.metrics;
    md.push('', '### 3b. Held-out test: the honest picture', '');
    md.push(`The voice model is a small logistic regression on voice features, trained on ${hold.model.trainedOn.clips} clips (${hold.model.trainedOn.human} human, ${hold.model.trainedOn.synthetic} synthetic). Every clip, human and synthetic, was also given random room reverb, noise, band-limiting and sample-rate changes, so the model cannot win just by spotting a different microphone. These ${hold.n} clips were never used for training.`, '');
    md.push('| Held-out slice | Clips | AUC (0.5 = coin flip, 1 = perfect) | Synthetic caught | Real voices wrongly flagged |', '|---|---|---|---|---|');
    [['All held-out clips', M.holdout], ['Clean direct recordings', M.holdoutClean], ['Simulated phone line', M.holdoutPhone], ['Noisy / reverberant / band-limited', M.holdoutAugmented]].forEach(([n, v]) => md.push(`| ${n} | ${v.n} | ${v.auc} | ${v.syntheticCaught} (${pct(parseInt(v.syntheticCaught), parseInt(v.syntheticCaught.split('/')[1]))}) | ${v.humanFalseAlarms} (${pct(parseInt(v.humanFalseAlarms), parseInt(v.humanFalseAlarms.split('/')[1]))}) |`));
    md.push('', 'Per group, judged at the product\'s "be careful" threshold:', '', '| Group | Truth | Clips | Judged correctly |', '|---|---|---|---|');
    Object.entries(hold.groups).forEach(([g, v]) => md.push(`| ${g} | ${v.truth} | ${v.n} | ${v.ok}/${v.n} (${pct(v.ok, v.n)}) |`));
    md.push('', '**What this means.** Voice detection from simple signal features is only moderately better than chance on unseen audio (and clearly better on clean direct recordings). The product therefore labels this check *experimental*, never tells a user a voice is "genuine", and sets its thresholds to avoid false accusations at the cost of missing many clones. A trained deep anti-spoofing model (for example AASIST or a fine-tuned wav2vec 2.0) is the next step; it could not be downloaded in the build environment.');
  }
  md.push('', '## Limits you should know about', '',
    '- Documents: the checks catch edited numbers, broken arithmetic, editing-software traces and invalid ID numbers. The specimen files were written to contain these specific traces, so 11/11 shows the checks work as designed, not how often real forgers leave such traces. A forger who produces a perfectly consistent document with a clean generator will pass. A pass means "no tampering signs found", never "genuine".',
    '- Liveness: the table above uses prepared measurements, so it shows the decision logic, not camera accuracy. Camera accuracy needs real recordings of real people and real attacks.',
    '- Voice: the training data is small and public (human speech from Google Speech Commands plus ten sentence recordings; synthetic speech from Kokoro and espeak). Commercial cloning tools (ElevenLabs, RVC and others) were not tested. The sample rows in 3a include clips the model saw in training, so use the held-out table in 3b for the real accuracy.',
    '- All test documents and numbers are made up for testing.');
  fs.mkdirSync(path.join(__dirname, '../../docs'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../../docs/KYC_TEST_REPORT.md'), md.join('\n') + '\n');
  fs.writeFileSync(path.join(RESULTS, 'kyc_demo.json'), JSON.stringify({ summary: S, docs, live, voice, holdout: hold && hold.groups }, null, 1));

  const row = (a, w) => String(a).padEnd(w);
  console.log('\nDOCUMENTS');
  docs.forEach((r) => console.log(`  ${row(r.file, 32)} ${row(r.truth, 8)} -> ${row(r.verdict, 16)} risk ${String(r.score).padStart(3)}  ${r.correct ? 'OK' : 'MISS'}`));
  console.log('\nLIVENESS');
  live.forEach((r) => console.log(`  ${row(r.name, 46)} ${row(r.truth, 8)} -> ${row(r.verdict, 14)} risk ${String(r.risk).padStart(3)}  ${r.correct ? 'OK' : 'MISS'}`));
  console.log('\nVOICE');
  voice.forEach((r) => console.log(`  ${row(r.file, 30)} ${row(r.truth, 8)} -> ${row(r.verdict, 20)} score ${String(r.score).padStart(3)}  ${r.correct ? 'OK' : 'MISS'}`));
  if (hold) { console.log('\nVOICE HOLD-OUT'); Object.entries(hold.groups).forEach(([g, v]) => console.log(`  ${row(g, 20)} ${v.ok}/${v.n}`)); }
  console.log('\nReport written to docs/KYC_TEST_REPORT.md');
})();
