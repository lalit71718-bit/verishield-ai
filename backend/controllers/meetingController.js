const MeetingSession = require('../models/MeetingSession');
const { analyzeFeatures } = require('../services/meetingGuard');

const VERDICTS = ['CALIBRATING', 'LIKELY_REAL', 'CAUTION', 'FACE_SWAP_LIKELY'];
const SOURCES = ['screen', 'camera', 'demo'];
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : 0));

// POST /api/meeting/analyze  (public)
// Body: { features: { contourJitter, sharpnessRatio, ... } }
const analyze = (req, res) => {
  const { features } = req.body || {};
  if (!features || typeof features !== 'object' || Array.isArray(features)) {
    return res.status(400).json({ error: 'Send a "features" object with the measured face signals.' });
  }
  return res.status(200).json({ success: true, ...analyzeFeatures(features) });
};

// POST /api/meeting/sessions  (signed in)
const saveSession = async (req, res) => {
  try {
    const b = req.body || {};
    const session = await MeetingSession.create({
      user: req.user._id,
      label: String(b.label || 'Video call').slice(0, 80),
      source: SOURCES.includes(b.source) ? b.source : 'screen',
      durationSeconds: Math.round(clampNum(b.durationSeconds, 0, 86400)),
      averageScore: Math.round(clampNum(b.averageScore, 0, 100)),
      peakScore: Math.round(clampNum(b.peakScore, 0, 100)),
      alertCount: Math.round(clampNum(b.alertCount, 0, 100000)),
      verdict: VERDICTS.includes(b.verdict) ? b.verdict : 'LIKELY_REAL',
      topSignals: Array.isArray(b.topSignals) ? b.topSignals.slice(0, 5).map((s) => String(s).slice(0, 60)) : []
    });
    return res.status(201).json({ success: true, session });
  } catch (err) {
    console.error('Meeting session save error:', err.message);
    return res.status(500).json({ error: 'Could not save this session.' });
  }
};

// GET /api/meeting/history  (signed in)
const history = async (req, res) => {
  try {
    const sessions = await MeetingSession.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
    return res.status(200).json({ success: true, sessions });
  } catch (err) {
    console.error('Meeting history error:', err.message);
    return res.status(500).json({ error: 'Could not load your sessions.' });
  }
};

module.exports = { analyze, saveSession, history };
