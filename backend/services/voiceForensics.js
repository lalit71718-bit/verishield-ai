/**
 * Voice-clone / synthetic-speech check.
 *
 * The browser decodes the recording and measures voice features locally with
 * frontend/voicefeatures.js (pitch smoothness, how clean the voice is, noise floor,
 * silence between words, spectral shape...). This service scores those numbers with a small
 * logistic-regression model (services/voiceModel.json) and explains the result in plain words.
 *
 * Audio never leaves the user's device. The model is trained on a small public sample set and
 * is EXPERIMENTAL: on held-out clips it separates synthetic from human only moderately (AUC about
 * 0.67 overall, about 0.8 on clean direct recordings). Operating points are set to avoid false
 * accusations, which means it misses many clones. See docs/KYC_TEST_REPORT.md.
 */
const fs = require('fs');
const path = require('path');

const clip = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const log1 = (v) => Math.log(1 + v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Must stay identical to the transforms used when the model was trained.
const TRANSFORMS = {
  hnrDb: (f) => (isNum(f.hnrDb) ? f.hnrDb : null),
  noiseFloorDb: (f) => (isNum(f.noiseFloorDb) ? clip(f.noiseFloorDb, -110, -30) : null),
  digitalSilence: (f) => (isNum(f.digitalSilence) ? f.digitalSilence : null),
  shimmer: (f) => (isNum(f.shimmer) ? f.shimmer : null),
  pitchStepCents: (f) => (isNum(f.pitchStepCents) ? log1(f.pitchStepCents) : null),
  pitchAccelCents: (f) => (isNum(f.pitchAccelCents) ? log1(f.pitchAccelCents) : null),
  hfShare: (f) => (isNum(f.hfShare) ? Math.sqrt(f.hfShare) : null),
  flatness: (f) => (isNum(f.flatness) ? f.flatness : null)
};
// LFCC mean and spread per coefficient: the spectral fingerprint of the voice.
for (let q = 0; q < 12; q++) {
  TRANSFORMS[`lfccMean${q}`] = (f) => (Array.isArray(f.lfccMean) && isNum(f.lfccMean[q]) ? f.lfccMean[q] : null);
  TRANSFORMS[`lfccStd${q}`] = (f) => (Array.isArray(f.lfccStd) && isNum(f.lfccStd[q]) ? f.lfccStd[q] : null);
}

const LABELS = {
  hnrDb: 'Voice cleanliness',
  noiseFloorDb: 'Background noise',
  digitalSilence: 'Silence between words',
  shimmer: 'Loudness wobble',
  pitchStepCents: 'Pitch movement',
  pitchAccelCents: 'Pitch smoothness',
  hfShare: 'High-frequency detail',
  flatness: 'Spectral texture'
};

const EXPLAIN = {
  hnrDb: (v, bad) => (bad ? `The voice is unusually clean and regular (${v.toFixed(1)} dB harmonic-to-noise). Real voices are rougher.` : 'Natural roughness in the voice.'),
  noiseFloorDb: (v, bad) => (bad ? `Almost no background noise between words (${Math.round(v)} dB). Real rooms and phones always add some.` : 'Normal background noise is present.'),
  digitalSilence: (v, bad) => (bad ? `${Math.round(v * 100)}% of the recording is perfectly silent, which only happens in generated audio.` : 'No perfectly silent gaps.'),
  shimmer: (v, bad) => (bad ? 'Loudness from one voice pulse to the next is unnaturally even.' : 'Natural loudness variation.'),
  pitchStepCents: (v, bad) => (bad ? 'The pitch moves in a pattern that differs from a person talking.' : 'Pitch moves like natural speech.'),
  pitchAccelCents: (v, bad) => (bad ? 'The pitch curve is smoother than a real throat can produce.' : 'Natural pitch smoothness.'),
  hfShare: (v, bad) => (bad ? 'The high-frequency detail (breath, fricatives) looks synthetic.' : 'Natural high-frequency detail.'),
  flatness: (v, bad) => (bad ? 'The spectral texture is flatter or more uniform than recorded speech.' : 'Natural spectral texture.')
};

let MODEL = null;
function model() {
  if (!MODEL) MODEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'voiceModel.json'), 'utf8'));
  return MODEL;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

const ADVICE = {
  LIKELY_SYNTHETIC: [
    'Do not send money, OTPs or personal details on this call.',
    'Hang up and call the person back on a number you already know.',
    'Ask for the family safe word, or a question only the real person can answer.',
    'Report the attempt: call 1930 or visit cybercrime.gov.in (India).'
  ],
  SUSPICIOUS: [
    'Do not act on this request yet. Verify on a second channel.',
    'Call back on a saved number, or ask a question only the real person can answer.',
    'Record a longer sample and check again for a firmer result.'
  ],
  NO_SYNTHETIC_SIGNS: [
    'A clean result does not prove the speaker is who they claim to be.',
    'For money or password requests, still verify on a second channel.'
  ],
  TOO_SHORT: ['Record at least 3 seconds of clear speech with little music or other voices.']
};

function scoreVoice(features) {
  const f = features && typeof features === 'object' ? features : {};
  const speech = isNum(f.speechSeconds) ? f.speechSeconds : 0;
  const rate = isNum(f.sampleRate) ? f.sampleRate : 0;

  if (speech < 2) {
    return {
      verdict: 'TOO_SHORT', tone: 'accent', title: 'Not enough speech', score: 0,
      summary: 'Fewer than 2 seconds of speech were found. Short clips cannot be judged reliably.',
      signals: [], advice: ADVICE.TOO_SHORT, quality: { speechSeconds: speech, sampleRate: rate },
      disclaimer: 'Indicator only. Verify the caller on a second channel.'
    };
  }

  const m = model();
  let z = m.bias;
  const parts = m.features.map((name, j) => {
    const raw = TRANSFORMS[name](f);
    const zj = raw === null ? 0 : (raw - m.mean[j]) / m.std[j];
    const contribution = m.weights[j] * zj;
    z += contribution;
    return { name, raw, contribution };
  });
  const prob = sigmoid(z);
  const score = Math.round(prob * 100);

  const T = m.thresholds || { low: 0.5, high: 0.75 };
  const verdict = prob >= T.high ? 'LIKELY_SYNTHETIC' : prob >= T.low ? 'SUSPICIOUS' : 'NO_SYNTHETIC_SIGNS';
  const META = {
    LIKELY_SYNTHETIC: { tone: 'danger', title: 'Synthetic-voice traits found', summary: 'This voice shows traits common in generated speech. Treat the caller as unverified.' },
    SUSPICIOUS: { tone: 'warn', title: 'Some unusual traits', summary: 'A few traits look unusual for a natural voice. Verify the caller before acting.' },
    NO_SYNTHETIC_SIGNS: { tone: 'safe', title: 'No strong synthetic traits', summary: 'Nothing obvious was found. This check cannot clear a voice, so it is not proof of identity.' }
  }[verdict];

  // Group the many spectral-fingerprint (LFCC) terms into one readable signal.
  const named = parts.filter((p) => !p.name.startsWith('lfcc') && p.raw !== null);
  const lf = parts.filter((p) => p.name.startsWith('lfcc') && p.raw !== null);
  const toSignal = (id, label, contribution, detail) => ({
    id, label, status: contribution > 0.5 ? 'danger' : contribution > 0.2 ? 'warn' : 'safe',
    score: Math.round(clip(50 + contribution * 30, 0, 100)), detail, contribution: Math.round(contribution * 100) / 100
  });
  const signals = named.map((p) => toSignal(p.name, LABELS[p.name], p.contribution, EXPLAIN[p.name](p.raw, p.contribution > 0.2)));
  if (lf.length) {
    const c = lf.reduce((a, p) => a + p.contribution, 0);
    signals.push(toSignal('lfcc', 'Spectral fingerprint', c, c > 0.2
      ? 'The fine spectral fingerprint, where voice generators leave traces, differs from natural recordings.'
      : 'The fine spectral fingerprint is consistent with natural recordings.'));
  }
  signals.sort((a, b) => b.contribution - a.contribution);

  const notes = [];
  if (rate && rate <= 8000) notes.push('Phone-quality audio (8 kHz). Results are less reliable than on a direct recording.');
  if (speech < 3) notes.push('A short sample. A longer recording gives a firmer result.');
  notes.push('Experimental screening: it misses many cloned voices and sometimes flags real ones, especially on noisy or phone audio.');

  return {
    verdict, ...META, score, probability: Math.round(prob * 1000) / 1000, signals, advice: ADVICE[verdict], notes,
    quality: { speechSeconds: speech, sampleRate: rate },
    disclaimer: 'Indicator only, not proof. Verify the caller on a second channel.'
  };
}

module.exports = { scoreVoice, TRANSFORMS, FEATURE_NAMES: Object.keys(TRANSFORMS) };
