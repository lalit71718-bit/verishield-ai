const mongoose = require('mongoose');

// A saved KYC fraud check: only the verdict and a file fingerprint, never the document itself.
const kycCaseSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  kind: { type: String, enum: ['document', 'liveness', 'voice'], required: true },
  label: { type: String, default: '', maxlength: 120 },
  docType: { type: String, default: '' },
  sha256: { type: String, default: '' },
  verdict: { type: String, required: true },
  score: { type: Number, default: 0 },
  summary: { type: String, default: '' },
  failedChecks: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('KycCase', kycCaseSchema);
