'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Agent } = require('../agent');
const { Services } = require('../services');
const nlu = require('../nlu');

// Fixed "now": 2026-11-26 10:00 local.
const NOW = new Date(2026, 10, 26, 10, 0).getTime();
const mk = () => { const svc = new Services(); return { svc, agent: new Agent(svc, { now: () => NOW }) }; };

test('time parsing: Hinglish periods and defaults', () => {
  assert.deepStrictEqual(nlu.parseTime('subah 10 baje'), { hour: 10, minute: 0 });
  assert.deepStrictEqual(nlu.parseTime('shaam 6 baje'), { hour: 18, minute: 0 });
  assert.deepStrictEqual(nlu.parseTime('9 baje'), { hour: 9, minute: 0 });
  assert.deepStrictEqual(nlu.parseTime('saade das baje'), { hour: 10, minute: 30 });
  assert.deepStrictEqual(nlu.parseTime('3 baje'), { hour: 15, minute: 0 });
  assert.deepStrictEqual(nlu.parseTime('5:30 pm'), { hour: 17, minute: 30 });
});

test('Devanagari input is understood', () => {
  const a = nlu.parseRequest('कल सुबह १० बजे डॉक्टर के क्लिनिक में अपॉइंटमेंट कर देना', NOW);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].type, 'appointment');
  assert.strictEqual(a[0].slots.provider, 'Doctor');
  assert.deepStrictEqual(a[0].slots.time, { hour: 10, minute: 0 });
  assert.strictEqual(a[0].slots.day, '2026-11-27');
});

test('headline scenario: appointment + reminder, confirm, execute', () => {
  const { agent, svc } = mk();
  const r1 = agent.turn('s', 'VoiceSakhi, kal subah 10 baje doctor ke clinic mein appointment kar dena, aur bijli bill ke liye kal 9 baje yaad dila dena.');
  assert.strictEqual(r1.state, 'confirm');
  assert.match(r1.reply, /Doctor ka kal 10 AM ka appointment/);
  assert.match(r1.reply, /kal 9 AM Bijli bill payment ka reminder/);
  assert.strictEqual(svc.bookings.length, 0, 'nothing executes before confirmation');
  const r2 = agent.turn('s', 'Haan.');
  assert.strictEqual(r2.state, 'idle');
  assert.match(r2.reply, /Ref #124/);
  assert.match(r2.reply, /Ref #125/);
  assert.strictEqual(svc.bookings.length, 1);
  assert.strictEqual(svc.reminders.length, 1);
});

test('declining executes nothing', () => {
  const { agent, svc } = mk();
  agent.turn('s', 'kal 10 baje doctor appointment');
  const r = agent.turn('s', 'nahi');
  assert.strictEqual(r.state, 'idle');
  assert.strictEqual(svc.bookings.length, 0);
});

test('missing slot is asked for', () => {
  const { agent, svc } = mk();
  const r1 = agent.turn('s', 'mechanic ka appointment book karna hai');
  assert.strictEqual(r1.state, 'slot');
  assert.match(r1.reply, /baje/);
  const r2 = agent.turn('s', 'parso shaam 5 baje');
  assert.strictEqual(r2.state, 'confirm');
  assert.match(r2.reply, /Mechanic ka parso 5 PM/);
  agent.turn('s', 'haan');
  assert.strictEqual(svc.bookings[0].provider, 'Mechanic');
});

test('payment requires correct PIN; wrong PIN does not pay', () => {
  const { agent, svc } = mk();
  agent.turn('s', 'bijli bill 1200 rupaye bhar do');
  const c = agent.turn('s', 'haan');
  assert.strictEqual(c.state, 'pin');
  assert.strictEqual(svc.payments.length, 0);
  const bad = agent.turn('s', '9999');
  assert.strictEqual(bad.state, 'pin');
  assert.strictEqual(svc.payments.length, 0);
  const ok = agent.turn('s', 'ek do teen char');
  assert.strictEqual(ok.state, 'idle');
  assert.strictEqual(svc.payments.length, 1);
  assert.strictEqual(svc.payments[0].amount, 1200);
});

test('three wrong PINs block payment and hand off to a human', () => {
  const { agent, svc } = mk();
  agent.turn('s', 'gas bill 500 rupaye bhar do'); agent.turn('s', 'haan');
  agent.turn('s', '1111'); agent.turn('s', '2222');
  const r = agent.turn('s', '3333');
  assert.strictEqual(r.state, 'handoff');
  assert.strictEqual(svc.payments.length, 0);
  assert.ok(svc.log.some((l) => l.event === 'handoff.requested'));
});

test('grocery order with quantity', () => {
  const { agent, svc } = mk();
  agent.turn('s', '10 kilo chawal order kar do');
  agent.turn('s', 'haan');
  assert.deepStrictEqual(svc.orders[0].qty, { n: 10, unit: 'kilo' });
  assert.strictEqual(svc.orders[0].item, 'Chawal');
});

test('human handoff on request and after repeated confusion', () => {
  const { agent } = mk();
  assert.strictEqual(agent.turn('a', 'mujhe kisi insaan se baat karni hai').state, 'handoff');
  const b = mk().agent;
  b.turn('b', 'blah blah'); b.turn('b', 'asdf'); 
  assert.strictEqual(b.turn('b', 'qwerty').state, 'handoff');
});

test('every step is audit-logged', () => {
  const { agent, svc } = mk();
  agent.turn('s', 'kal 10 baje doctor appointment'); agent.turn('s', 'haan');
  const events = svc.log.map((l) => l.event);
  assert.deepStrictEqual(events.filter((e) => e === 'booking.created').length, 1);
  assert.ok(events.includes('user.said') && events.includes('agent.said'));
});
