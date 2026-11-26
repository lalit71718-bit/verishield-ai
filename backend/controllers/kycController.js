const KycCase = require('../models/KycCase');
const { analyzeDocument } = require('../services/kycDocument');
const { decideLiveness, newChallengeSet } = require('../services/kycLiveness');
const { scoreVoice } = require('../services/voiceForensics');

const DOC_TYPES = ['aadhaar', 'pan', 'salary', 'bank'];

// Saving is best effort: a database outage must never block a fraud check.
async function remember(req, data) {
  try {
    if (!req.user) return;
    await KycCase.create({ user: req.user._id, ...data });
  } catch (err) {
    console.warn('KYC case save warning:', err.message);
  }
}

// POST /api/kyc/document   multipart: document (file), docType, fields (JSON string, optional)
const checkDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Attach a document to check.' });
    const docType = String(req.body.docType || '').toLowerCase();
    if (!DOC_TYPES.includes(docType)) return res.status(400).json({ error: 'Choose a document type: aadhaar, pan, salary or bank.' });

    let fields = {};
    if (req.body.fields) {
      try { fields = JSON.parse(req.body.fields); } catch (e) { return res.status(400).json({ error: 'The details you typed could not be read.' }); }
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fields = {};
    }
    const result = await analyzeDocument({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
      docType,
      fields
    });
    await remember(req, {
      kind: 'document', label: req.file.originalname, docType, sha256: result.sha256,
      verdict: result.verdict, score: result.score, summary: result.title,
      failedChecks: result.checks.filter((c) => c.status === 'fail').map((c) => c.label)
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('KYC document error:', err);
    return res.status(500).json({ error: 'Could not analyse this document.' });
  }
};

// GET /api/kyc/liveness/challenges  -> a fresh random set of actions
const livenessChallenges = (req, res) => res.status(200).json({ success: true, challenges: newChallengeSet(3) });

// POST /api/kyc/liveness
const checkLiveness = async (req, res) => {
  try {
    const result = decideLiveness(req.body);
    await remember(req, {
      kind: 'liveness', label: 'Video KYC', verdict: result.verdict, score: result.riskScore, summary: result.title,
      failedChecks: result.checks.filter((c) => c.status === 'fail').map((c) => c.label)
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('KYC liveness error:', err);
    return res.status(500).json({ error: 'Could not evaluate the liveness session.' });
  }
};

// POST /api/kyc/voice   body: { features: {...} } measured in the browser
const checkVoice = async (req, res) => {
  try {
    const { features } = req.body || {};
    if (!features || typeof features !== 'object' || Array.isArray(features)) {
      return res.status(400).json({ error: 'Send the measured voice features.' });
    }
    const result = scoreVoice(features);
    await remember(req, {
      kind: 'voice', label: 'Voice check', verdict: result.verdict, score: result.score, summary: result.title,
      failedChecks: result.signals.filter((s) => s.status === 'danger').map((s) => s.label)
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('KYC voice error:', err);
    return res.status(500).json({ error: 'Could not analyse this voice.' });
  }
};

// GET /api/kyc/history  (signed in)
const history = async (req, res) => {
  try {
    const cases = await KycCase.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
    return res.status(200).json({ success: true, cases });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load your cases.' });
  }
};

module.exports = { checkDocument, livenessChallenges, checkLiveness, checkVoice, history };
