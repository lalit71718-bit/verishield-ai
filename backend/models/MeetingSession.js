const mongoose = require('mongoose');

// One saved Meeting Guard session. Only numbers and verdicts are stored;
// the video itself never leaves the user's browser.
const meetingSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  label: { type: String, default: 'Video call', maxlength: 80 },
  source: { type: String, enum: ['screen', 'camera', 'demo'], default: 'screen' },
  durationSeconds: { type: Number, default: 0 },
  averageScore: { type: Number, default: 0 },
  peakScore: { type: Number, default: 0 },
  alertCount: { type: Number, default: 0 },
  verdict: { type: String, enum: ['CALIBRATING', 'LIKELY_REAL', 'CAUTION', 'FACE_SWAP_LIKELY'], default: 'LIKELY_REAL' },
  topSignals: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MeetingSession', meetingSessionSchema);
