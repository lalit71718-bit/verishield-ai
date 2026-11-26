'use strict';
// Rule-based Hinglish / Hindi / English understanding. Deterministic on purpose:
// every request is parsed into a small, auditable action before anything executes.

const DEVANAGARI_DIGITS = '०१२३४५६७८९';
// Devanagari (what hi-IN speech recognition returns) -> Roman tokens used by the rules below.
const DEV_WORDS = {
  'कल': 'kal', 'आज': 'aaj', 'परसों': 'parso', 'सुबह': 'subah', 'दोपहर': 'dopahar', 'शाम': 'shaam', 'रात': 'raat',
  'बजे': 'baje', 'डॉक्टर': 'doctor', 'डाक्टर': 'doctor', 'क्लिनिक': 'clinic', 'अपॉइंटमेंट': 'appointment',
  'अपॉयंटमेंट': 'appointment', 'अपोइंटमेंट': 'appointment', 'मैकेनिक': 'mechanic', 'मिस्त्री': 'mistri', 'बिजली': 'bijli',
  'पानी': 'paani', 'गैस': 'gas', 'बिल': 'bill', 'याद': 'yaad', 'दिला': 'dila', 'रिमाइंडर': 'reminder', 'भरना': 'bharna',
  'भर': 'bhar', 'पेमेंट': 'payment', 'रुपये': 'rupaye', 'रुपए': 'rupaye', 'रूपये': 'rupaye', 'ऑर्डर': 'order', 'मंगवा': 'mangwa',
  'चावल': 'chawal', 'आटा': 'atta', 'दाल': 'dal', 'चीनी': 'cheeni', 'तेल': 'tel', 'नमक': 'namak', 'किलो': 'kilo',
  'हाँ': 'haan', 'हां': 'haan', 'जी': 'ji', 'ठीक': 'theek', 'है': 'hai', 'नहीं': 'nahi', 'नही': 'nahi', 'रद्द': 'cancel',
  'और': 'aur', 'ऑपरेटर': 'operator', 'इंसान': 'insaan', 'एक': 'ek', 'दो': 'do', 'तीन': 'teen', 'चार': 'char',
  'पांच': 'panch', 'पाँच': 'panch', 'छह': 'chhe', 'छः': 'chhe', 'सात': 'saat', 'आठ': 'aath', 'नौ': 'nau', 'दस': 'das',
  'ग्यारह': 'gyarah', 'बारह': 'barah', 'शून्य': 'zero', 'सौ': 'sau', 'हज़ार': 'hazaar', 'हजार': 'hazaar', 'साढ़े': 'saade',
  'मुझे': 'mujhe', 'करना': 'karna', 'करवा': 'karwa', 'बुक': 'book',
};

const NUM_WORDS = {
  zero: 0, ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, panch: 5, paanch: 5, five: 5,
  chhe: 6, che: 6, chhah: 6, six: 6, saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10,
  gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20,
  pachchis: 25, tees: 30, chalis: 40, pachas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
};

function normalize(text) {
  let s = String(text || '').toLowerCase();
  s = s.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS.indexOf(d));
  s = s.replace(/[ऀ-ॿ]+/g, (w) => DEV_WORDS[w] || w);
  s = s.replace(/[।!?]/g, ' , ').replace(/[^\p{L}\p{N}:.,;\s]/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseNumber(tok) {
  if (/^\d+$/.test(tok)) return parseInt(tok, 10);
  return tok in NUM_WORDS ? NUM_WORDS[tok] : null;
}

function parseDay(s, now) {
  const base = new Date(now);
  let off = null;
  if (/\b(parso|day after tomorrow)\b/.test(s)) off = 2;
  else if (/\b(kal|tomorrow)\b/.test(s)) off = 1;
  else if (/\b(aaj|today|abhi)\b/.test(s)) off = 0;
  if (off === null) return null;
  base.setDate(base.getDate() + off);
  return isoDate(base);
}

// Returns {hour, minute} in 24h, or null. "9 baje" with no period: 7-11 -> morning, 12 -> noon, 1-6 -> afternoon/evening.
function parseTime(s) {
  let hour = null, minute = 0, explicit = null;
  let m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m) { hour = +m[1]; minute = m[2] ? +m[2] : 0; explicit = m[3]; }
  else if ((m = s.match(/\b(\d{1,2}):(\d{2})\b/))) { hour = +m[1]; minute = +m[2]; }
  else if ((m = s.match(/\b(saade|sade|dedh|dhai|dhaai)?\s*([a-z0-9]+)\s+baje\b/))) {
    const n = parseNumber(m[2]);
    if (n !== null && n >= 0 && n <= 24) {
      hour = n;
      if (m[1] === 'saade' || m[1] === 'sade') minute = 30;
    } else if (m[2] === 'dedh' || (m[1] === 'dedh')) { hour = 1; minute = 30; }
    else if (m[2] === 'dhai' || m[2] === 'dhaai' || m[1] === 'dhai') { hour = 2; minute = 30; }
  }
  if (hour === null || hour > 24 || minute > 59) return null;
  const period = /\b(subah|savere|morning)\b/.test(s) ? 'am'
    : /\b(dopahar|afternoon)\b/.test(s) ? 'noon'
    : /\b(shaam|sham|evening)\b/.test(s) ? 'eve'
    : /\b(raat|night)\b/.test(s) ? 'night' : null;
  if (explicit === 'pm' && hour < 12) hour += 12;
  else if (explicit === 'am' && hour === 12) hour = 0;
  else if (!explicit && hour <= 12) {
    if (period === 'am') { if (hour === 12) hour = 0; }
    else if (period === 'noon') { if (hour < 10) hour += 12; }
    else if (period === 'eve' || period === 'night') { if (hour < 12) hour += 12; }
    else if (hour >= 1 && hour <= 6) hour += 12;
    else if (hour === 0) hour = 0;
  }
  return { hour, minute };
}

function fmtTime(t) {
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return `${h12}${t.minute ? ':' + pad(t.minute) : ''} ${t.hour < 12 ? 'AM' : 'PM'}`;
}

function fmtDay(iso, now) {
  if (!iso) return '';
  const today = isoDate(new Date(now));
  const t = new Date(now); t.setDate(t.getDate() + 1);
  const p = new Date(now); p.setDate(p.getDate() + 2);
  if (iso === today) return 'aaj';
  if (iso === isoDate(t)) return 'kal';
  if (iso === isoDate(p)) return 'parso';
  return iso;
}

const BILLERS = [
  [/\b(bijli|electricity|light|current)\b/, 'Bijli'], [/\b(paani|water)\b/, 'Paani'], [/\bgas\b/, 'Gas'],
  [/\b(mobile|recharge|phone)\b/, 'Mobile'], [/\b(internet|wifi|broadband)\b/, 'Internet'],
];
const PROVIDERS = [
  [/\b(electrician|bijli mistri|wireman)\b/, 'Electrician'], [/\b(mechanic|garage|gaadi|gadi|bike|scooter)\b/, 'Mechanic'],
  [/\b(plumber|nalka|nal)\b/, 'Plumber'], [/\b(lab|test|blood)\b/, 'Lab test'], [/\b(doctor|clinic|dawai|dr)\b/, 'Doctor'],
];
const ITEMS = [
  [/\b(chawal|rice)\b/, 'Chawal'], [/\b(atta|aata|flour)\b/, 'Atta'], [/\b(dal|daal)\b/, 'Dal'], [/\b(cheeni|sugar)\b/, 'Cheeni'],
  [/\b(tel|oil)\b/, 'Tel'], [/\b(namak|salt)\b/, 'Namak'], [/\b(chai|tea)\b/, 'Chai patti'], [/\b(sabun|soap)\b/, 'Sabun'],
  [/\b(biscuit|biscuits)\b/, 'Biscuit'],
];
const firstMatch = (table, s) => { for (const [re, v] of table) if (re.test(s)) return v; return null; };

function parseAmount(s) {
  let m = s.match(/(?:rs\.?|₹|rupees?|rupaye)\s*(\d[\d,]*)/) || s.match(/(\d[\d,]*)\s*(?:rs\b|rupees?|rupaye|₹)/);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  m = s.match(/\b([a-z]+|\d+)\s+(sau|hazaar|hajar)\s*(?:([a-z]+|\d+)\s+(sau))?\s*(?:rupaye|rupees?)?/);
  if (m) {
    const n = parseNumber(m[1]); if (n === null) return null;
    let total = n * (m[2] === 'sau' ? 100 : 1000);
    if (m[3] && m[4]) { const k = parseNumber(m[3]); if (k !== null) total += k * 100; }
    return total;
  }
  return null;
}

function parseQty(s) {
  const m = s.match(/\b([a-z0-9]+)\s*(kilo|kg|packet|packets|litre|liter|ltr|peti|bori|bag)\b/);
  if (!m) return null;
  const n = parseNumber(m[1]);
  return n === null ? null : { n, unit: m[2] === 'kg' ? 'kilo' : m[2] };
}

// Extract a spoken digit string (PIN / OTP): "1234" or "ek do teen char".
function parseDigits(text) {
  const s = normalize(text);
  const out = [];
  for (const tok of s.split(/[\s,]+/)) {
    if (/^\d+$/.test(tok)) out.push(...tok.split(''));
    else if (tok in NUM_WORDS && NUM_WORDS[tok] <= 9) out.push(String(NUM_WORDS[tok]));
  }
  return out.join('');
}

const YES = /\b(haan|han|haa|ha|yes|yeah|yep|ji|theek hai|thik hai|theek|ok|okay|sahi|bilkul|kar do|kardo|confirm|pakka)\b/;
const NO = /\b(nahi|nahin|na|no|mat|galat|cancel|rehne do|ruko|stop|wrong)\b/;
const HUMAN = /\b(operator|insaan|human|agent|aadmi|kisi se baat|kisi insaan|insan|representative|customer care)\b/;

function classifyReply(text) {
  const s = normalize(text);
  if (HUMAN.test(s)) return 'human';
  // "nahi ... theek nahi" style: negatives win over a stray "theek".
  if (NO.test(s) && !/\btheek hai\b/.test(s)) return 'no';
  if (YES.test(s)) return 'yes';
  if (NO.test(s)) return 'no';
  return 'unknown';
}

// Split one utterance into clauses and parse each into an action {type, slots}.
function parseRequest(text, now = Date.now()) {
  const s = normalize(text);
  const clauses = s.split(/\b(?:aur|and|phir|also|tatha)\b|[,;]/).map((c) => c.trim()).filter(Boolean);
  const actions = [];
  let lastDay = null;
  for (const c of clauses) {
    const day = parseDay(c, now) || lastDay;
    if (parseDay(c, now)) lastDay = day;
    const time = parseTime(c);
    const biller = firstMatch(BILLERS, c);
    const isRemind = /\b(yaad|remind|reminder|alert)\b/.test(c);
    const isPay = /\b(pay|payment|bhar|bharna|bharo|jama|chukao|chuka)\b/.test(c) && /\b(bill|payment|recharge|emi)\b/.test(c);
    const isOrder = /\b(order|mangwa|mangwao|mangao|mangwana|supply|stock|khareed)\b/.test(c) || (parseQty(c) && firstMatch(ITEMS, c));
    const provider = firstMatch(PROVIDERS, c);
    const isAppt = /\b(appointment|book|booking|milna|dikhana|dikhani|visit|time lena)\b/.test(c) || (provider && (time || day) && !isRemind);
    if (isRemind) {
      actions.push({ type: 'reminder', slots: { topic: biller ? `${biller} bill payment` : provider ? `${provider} visit` : null, day, time } });
    } else if (isPay) {
      actions.push({ type: 'pay_bill', slots: { biller, amount: parseAmount(c) } });
    } else if (isOrder) {
      const q = parseQty(c);
      actions.push({ type: 'order', slots: { item: firstMatch(ITEMS, c), qty: q } });
    } else if (isAppt) {
      actions.push({ type: 'appointment', slots: { provider: provider || (/\b(appointment|milna)\b/.test(c) ? 'Doctor' : null), day, time } });
    }
  }
  return actions;
}

module.exports = { normalize, parseRequest, parseTime, parseDay, parseAmount, parseQty, parseDigits, classifyReply, fmtTime, fmtDay, isoDate, parseNumber };
