'use strict';
// Dialogue manager: understand -> fill missing slots -> read back -> confirm (+PIN if sensitive) -> execute -> log.
// States: idle | slot | confirm | pin | handoff

const nlu = require('./nlu');
const { fmtTime, fmtDay } = nlu;

const DEMO_PIN = '1234';
const MAX_PIN_TRIES = 3;
const MAX_UNCLEAR = 2;

const SENSITIVE = new Set(['pay_bill']);

const SLOT_ORDER = {
  appointment: ['provider', 'time'],
  reminder: ['topic', 'time'],
  pay_bill: ['biller', 'amount'],
  order: ['item', 'qty'],
};

const QUESTIONS = {
  provider: 'Kisse appointment chahiye — doctor, mechanic, electrician ya plumber?',
  time: 'Kis din aur kitne baje?',
  topic: 'Kis cheez ke liye yaad dilaun?',
  biller: 'Kaunsa bill — bijli, paani, gas, mobile ya internet?',
  amount: 'Kitne rupaye ka payment karna hai?',
  item: 'Kaunsa saaman order karna hai? Jaise chawal, atta, dal, cheeni, tel.',
  qty: 'Kitna chahiye? Jaise 10 kilo ya 2 packet.',
};

function describe(a, now) {
  const s = a.slots;
  const when = s.time ? `${s.day ? fmtDay(s.day, now) + ' ' : ''}${fmtTime(s.time)}` : '';
  switch (a.type) {
    case 'appointment': return `${s.provider} ka ${when} ka appointment`;
    case 'reminder': return `${when} ${s.topic} ka reminder`.replace(/\s+/g, ' ');
    case 'pay_bill': return `${s.biller} bill ka ₹${s.amount} payment`;
    case 'order': return `${s.item} ${s.qty.n} ${s.qty.unit} ka order`;
    default: return a.type;
  }
}

function missing(a) {
  return (SLOT_ORDER[a.type] || []).filter((k) => a.slots[k] == null);
}

class Agent {
  constructor(services, { now = () => Date.now() } = {}) {
    this.svc = services;
    this.now = now;
    this.sessions = new Map();
  }
  session(id) {
    if (!this.sessions.has(id)) this.sessions.set(id, { id, state: 'idle', actions: [], slotFor: null, unclear: 0, pinTries: 0, turns: 0 });
    return this.sessions.get(id);
  }
  reset(id) { this.sessions.delete(id); }

  // Fill the slot we just asked about from a short free-form answer.
  fillSlot(sess, text) {
    const a = sess.actions[sess.slotFor.i];
    const k = sess.slotFor.key;
    const now = this.now();
    const s = nlu.normalize(text);
    if (k === 'time') {
      const t = nlu.parseTime(s); const d = nlu.parseDay(s, now);
      if (t) { a.slots.time = t; if (d) a.slots.day = d; }
    } else if (k === 'amount') {
      const n = nlu.parseAmount(s) ?? (/^\d+$/.test(s.replace(/\s/g, '')) ? parseInt(s, 10) : null);
      if (n) a.slots.amount = n;
    } else if (k === 'qty') {
      const q = nlu.parseQty(s); if (q) a.slots.qty = q;
    } else {
      const probe = nlu.parseRequest(a.type === 'order' ? `order ${text}` : a.type === 'pay_bill' ? `${text} bill bhar` : a.type === 'reminder' ? `${text} yaad` : `${text} appointment`, now)[0];
      if (probe && probe.slots[k]) a.slots[k] = probe.slots[k];
      else if (k === 'topic' && s.length > 2) a.slots.topic = text.trim();
    }
    return a.slots[k] != null;
  }

  nextSlotQuestion(sess) {
    for (let i = 0; i < sess.actions.length; i++) {
      const m = missing(sess.actions[i]);
      if (m.length) { sess.slotFor = { i, key: m[0] }; return QUESTIONS[m[0]]; }
    }
    sess.slotFor = null;
    return null;
  }

  readBack(sess) {
    sess.state = 'confirm';
    const parts = sess.actions.map((a) => describe(a, this.now()));
    const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' aur ' + parts[parts.length - 1] : parts[0];
    const pin = sess.actions.some((a) => SENSITIVE.has(a.type));
    return `${list} karna hai. ${pin ? 'Payment ke liye PIN lagega. ' : ''}Theek hai?`;
  }

  handoff(sess, reason) {
    sess.state = 'handoff';
    this.svc.audit(sess.id, 'handoff.requested', { reason });
    return 'Theek hai, main aapko hamare operator se jod raha hoon. Kripya line par bane rahiye. (Demo: operator ko transfer kiya gaya.)';
  }

  execute(sess) {
    const out = [];
    for (const a of sess.actions) {
      const s = a.slots;
      if (a.type === 'appointment') { const r = this.svc.bookAppointment(sess.id, s); out.push(`${s.provider} ka appointment ho gaya (Ref #${r.ref})`); }
      else if (a.type === 'reminder') { const r = this.svc.createReminder(sess.id, s); out.push(`main ${fmtDay(s.day, this.now()) || 'aaj'} ${fmtTime(s.time)} par ${s.topic} ki yaad dila dunga (Ref #${r.ref})`); }
      else if (a.type === 'pay_bill') { const r = this.svc.payBill(sess.id, s); out.push(`${s.biller} bill ka ₹${s.amount} payment ho gaya (Ref #${r.ref})`); }
      else if (a.type === 'order') { const r = this.svc.placeOrder(sess.id, s); out.push(`${s.item} ${s.qty.n} ${s.qty.unit} ka order place ho gaya (Ref #${r.ref})`); }
    }
    sess.actions = []; sess.state = 'idle'; sess.pinTries = 0;
    return out.join('. ') + '. Aur kuch?';
  }

  // One conversational turn. Returns {reply, state, actions}.
  turn(id, text) {
    const sess = this.session(id);
    sess.turns++;
    this.svc.audit(id, 'user.said', { text });
    const reply = this._turn(sess, String(text || ''));
    this.svc.audit(id, 'agent.said', { text: reply, state: sess.state });
    return { reply, state: sess.state, pending: sess.actions.map((a) => ({ type: a.type, summary: missing(a).length ? null : describe(a, this.now()) })) };
  }

  _turn(sess, text) {
    const cls = nlu.classifyReply(text);
    if (sess.state === 'handoff') return 'Aap operator ke saath jude hue hain. Naya kaam shuru karne ke liye "naya" bolein.';
    if (cls === 'human') return this.handoff(sess, 'user asked');

    if (sess.state === 'pin') {
      const digits = nlu.parseDigits(text);
      if (cls === 'no' && !digits) { sess.actions = []; sess.state = 'idle'; return 'Theek hai, payment cancel kar diya. Aur kuch?'; }
      if (digits === DEMO_PIN) { this.svc.audit(sess.id, 'pin.verified', {}); return this.execute(sess); }
      sess.pinTries++;
      this.svc.audit(sess.id, 'pin.failed', { tries: sess.pinTries });
      if (sess.pinTries >= MAX_PIN_TRIES) { sess.actions = []; return 'PIN teen baar galat hua, suraksha ke liye payment roka gaya. ' + this.handoff(sess, 'pin failed'); }
      return `PIN sahi nahi hai. Kripya 4 ank ka PIN dobara bolein. (${MAX_PIN_TRIES - sess.pinTries} mauke bache)`;
    }

    if (sess.state === 'confirm') {
      if (cls === 'yes') {
        if (sess.actions.some((a) => SENSITIVE.has(a.type))) { sess.state = 'pin'; sess.pinTries = 0; return 'Payment surakshit karne ke liye apna 4 ank ka PIN bolein.'; }
        return this.execute(sess);
      }
      if (cls === 'no') { sess.actions = []; sess.state = 'idle'; return 'Theek hai, kuch nahi kiya. Dobara batayein, kya karna hai?'; }
      // Not a clear yes/no: treat as a correction if it parses as a new request.
      const redo = nlu.parseRequest(text, this.now());
      if (redo.length) { sess.actions = redo; return this.afterParse(sess); }
      return this.unclear(sess, 'Kripya "haan" ya "nahi" bolein.');
    }

    if (sess.state === 'slot') {
      if (cls === 'no' && sess.slotFor) { sess.actions = []; sess.state = 'idle'; return 'Theek hai, rehne dete hain. Aur kuch?'; }
      // A fresh full request overrides the question.
      const fresh = nlu.parseRequest(text, this.now());
      const ok = this.fillSlot(sess, text);
      if (!ok && fresh.length && fresh.some((f) => !missing(f).length || f.type !== sess.actions[sess.slotFor.i].type)) { sess.actions = fresh; return this.afterParse(sess); }
      if (!ok) return this.unclear(sess, 'Samajh nahi aaya. ' + QUESTIONS[sess.slotFor.key]);
      sess.unclear = 0;
      return this.afterParse(sess);
    }

    // idle
    if (/\b(naya|new|start)\b/.test(nlu.normalize(text)) && !nlu.parseRequest(text, this.now()).length) return 'Boliye, main kya kar sakta hoon?';
    const actions = nlu.parseRequest(text, this.now());
    if (!actions.length) {
      if (/\b(namaste|hello|hi|hey|namaskar|jai)\b/.test(nlu.normalize(text))) return 'Namaste! Main VoiceSakhi hoon. Appointment, reminder, bill payment ya saaman ka order — boliye, kya karna hai?';
      return this.unclear(sess, 'Maaf kijiye, samajh nahi aaya. Aap appointment, reminder, bill payment ya order bol sakte hain.');
    }
    sess.actions = actions; sess.unclear = 0;
    return this.afterParse(sess);
  }

  afterParse(sess) {
    const q = this.nextSlotQuestion(sess);
    if (q) { sess.state = 'slot'; return q; }
    return this.readBack(sess);
  }

  unclear(sess, msg) {
    sess.unclear++;
    this.svc.audit(sess.id, 'nlu.unclear', { count: sess.unclear });
    if (sess.unclear > MAX_UNCLEAR) { sess.unclear = 0; return 'Mujhe samajhne mein dikkat ho rahi hai. ' + this.handoff(sess, 'repeated misunderstanding'); }
    return msg;
  }
}

module.exports = { Agent, DEMO_PIN };
