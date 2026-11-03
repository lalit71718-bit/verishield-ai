const mongoose = require('mongoose');

const urlScanSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  targetUrl: {
    type: String,
    required: true
  },
  domain: {
    type: String,
    required: true
  },
  trustScore: {
    type: Number,
    required: true
  },
  riskScore: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['SAFE', 'SUSPICIOUS', 'PHISHING'],
    default: 'SAFE'
  },
  verdict: {
    type: String,
    required: true
  },
  summary: {
    type: String,
    required: true
  },
  reasons: {
    type: [String],
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('UrlScan', urlScanSchema);