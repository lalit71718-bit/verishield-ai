'use strict';
// Mock partner services. In production each function becomes an adapter to a real API
// (clinic booking, BBPS bill payment, supplier ordering, calendar/SMS). The agent never
// touches a partner directly except through this interface, and every call is logged.

const fs = require('fs');
const path = require('path');

class Services {
  constructor({ logFile = null } = {}) {
    this.ref = 123;
    this.bookings = [];
    this.reminders = [];
    this.payments = [];
    this.orders = [];
    this.log = [];
    this.logFile = logFile;
  }
  nextRef() { return ++this.ref; }
  audit(session, event, detail) {
    const row = { at: new Date().toISOString(), session, event, detail };
    this.log.push(row);
    if (this.logFile) { try { fs.appendFileSync(this.logFile, JSON.stringify(row) + '\n'); } catch { /* demo only */ } }
    return row;
  }
  bookAppointment(session, { provider, day, time }) {
    const b = { ref: this.nextRef(), provider, day, time, status: 'confirmed' };
    this.bookings.push(b); this.audit(session, 'booking.created', b); return b;
  }
  createReminder(session, { topic, day, time }) {
    const r = { ref: this.nextRef(), topic, day, time, status: 'scheduled' };
    this.reminders.push(r); this.audit(session, 'reminder.scheduled', r); return r;
  }
  payBill(session, { biller, amount }) {
    const p = { ref: this.nextRef(), biller, amount, status: 'paid' };
    this.payments.push(p); this.audit(session, 'payment.completed', p); return p;
  }
  placeOrder(session, { item, qty }) {
    const o = { ref: this.nextRef(), item, qty, status: 'placed' };
    this.orders.push(o); this.audit(session, 'order.placed', o); return o;
  }
  snapshot() {
    return { bookings: this.bookings, reminders: this.reminders, payments: this.payments, orders: this.orders, log: this.log };
  }
}
module.exports = { Services };
