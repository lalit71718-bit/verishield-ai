/**
 * Live Deepfake Meeting Guard — risk fusion.
 *
 * The browser runs a face-landmark AI model on the video locally and sends only
 * a small vector of numeric features (no video, no images). This service turns
 * those features into per-signal risk scores and one overall verdict, so the
 * thresholds can be tuned here without redeploying the frontend.
 *
 * These are indicators of a possible face-swap, not proof.
 */

// Piecewise-linear ramp: <= lo gives 0, >= hi gives 100, linear in between.
const ramp = (value, lo, hi) => {
  if (hi === lo) return value >= hi ? 100 : 0;
  const t = (value - lo) / (hi - lo);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Keeps only known numeric fields and clamps them to sane ranges. */
function sanitizeFeatures(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const clamp = (v, lo, hi) => (v === null ? null : Math.max(lo, Math.min(hi, v)));
  return {
    observedSeconds: clamp(num(f.observedSeconds), 0, 86400) ?? 0,
    blinksPerMin: clamp(num(f.blinksPerMin), 0, 120),
    contourJitter: clamp(num(f.contourJitter), 0, 20),
    sharpnessRatio: clamp(num(f.sharpnessRatio), 0, 20),
    colorShift: clamp(num(f.colorShift), 0, 1),
    expressionVariance: clamp(num(f.expressionVariance), 0, 1),
    lipSyncCorr: clamp(num(f.lipSyncCorr), -1, 1),
    faceVisibleRatio: clamp(num(f.faceVisibleRatio), 0, 1),
    profileBreak: clamp(num(f.profileBreak), 0, 1)
  };
}

// Each signal: how to score it, how much it counts, and what to tell the user.
const SIGNALS = [
  {
    id: 'contour',
    label: 'Face-edge stability',
    weight: 0.24,
    read: (f) => f.contourJitter,
    // Real faces move rigidly (ratio ~1). Swapped faces flicker at the blend edge.
    score: (v) => ramp(v, 1.6, 3.2),
    detail: (v, s) => s >= 60
      ? `The face outline flickers ${v.toFixed(1)}x more than the inner features. Swapped faces often blend poorly at the edges.`
      : 'The face outline moves together with the features inside it.'
  },
  {
    id: 'profile',
    label: 'Head-turn test',
    weight: 0.2,
    read: (f) => f.profileBreak,
    score: (v) => ramp(v, 0.25, 0.7),
    detail: (v, s) => s >= 60
      ? 'The face distorted or glitched when the head turned sideways, which is a common weakness of face-swap models.'
      : 'The face stayed stable while the head turned.'
  },
  {
    id: 'sharpness',
    label: 'Skin sharpness match',
    weight: 0.16,
    read: (f) => f.sharpnessRatio,
    // Face much smoother (or sharper) than the area around it.
    score: (v) => Math.max(ramp(1 / Math.max(v, 0.01), 1.6, 3.5), ramp(v, 2.2, 5)),
    detail: (v, s) => s >= 60
      ? `The face is ${v < 1 ? 'much softer' : 'much sharper'} than the neck and background (ratio ${v.toFixed(2)}), as if pasted on.`
      : 'Face and surroundings have matching detail.'
  },
  {
    id: 'color',
    label: 'Skin-tone match',
    weight: 0.14,
    read: (f) => f.colorShift,
    score: (v) => ramp(v, 0.07, 0.2),
    detail: (v, s) => s >= 60
      ? 'Face colour does not match the neck and ears, a typical blending mistake.'
      : 'Face and neck colours are consistent.'
  },
  {
    id: 'blink',
    label: 'Blinking pattern',
    weight: 0.14,
    // Needs enough observation time to mean anything.
    read: (f) => (f.observedSeconds >= 20 ? f.blinksPerMin : null),
    // People blink roughly 8 to 30 times a minute. Almost none, or a flutter, is odd.
    score: (v) => (v < 8 ? ramp(8 - v, 2, 7) : v > 45 ? ramp(v, 45, 70) : 0),
    detail: (v, s) => s >= 60
      ? `${Math.round(v)} blinks per minute is outside the normal 8 to 30 range.`
      : `${Math.round(v)} blinks per minute is natural.`
  },
  {
    id: 'lipsync',
    label: 'Lip and voice sync',
    weight: 0.14,
    read: (f) => f.lipSyncCorr,
    score: (v) => ramp(0.35 - v, 0, 0.45),
    detail: (v, s) => s >= 60
      ? 'Mouth movement does not line up with the voice.'
      : 'Mouth movement follows the voice.'
  },
  {
    id: 'expression',
    label: 'Expression liveliness',
    weight: 0.08,
    read: (f) => (f.observedSeconds >= 15 ? f.expressionVariance : null),
    score: (v) => ramp(0.02 - v, 0, 0.015),
    detail: (v, s) => s >= 60
      ? 'The face barely changes expression, like a mask or a looped clip.'
      : 'Natural changes in expression.'
  },
  {
    id: 'visibility',
    label: 'Face tracking',
    weight: 0.06,
    read: (f) => (f.observedSeconds >= 10 ? f.faceVisibleRatio : null),
    score: (v) => ramp(0.9 - v, 0, 0.35),
    detail: (v, s) => s >= 60
      ? 'The face keeps dropping out of detection, which can happen when a swap model fails.'
      : 'Face detected steadily.'
  }
];

const LEVELS = {
  CALIBRATING: { tone: 'accent', title: 'Calibrating', summary: 'Watching the call to learn what this person normally looks like. Keep the face in view.' },
  LIKELY_REAL: { tone: 'safe', title: 'No face-swap signs', summary: 'The face behaves like a live camera feed so far. This is not a guarantee.' },
  CAUTION: { tone: 'warn', title: 'Be careful', summary: 'Some signals look unusual. Run a quick check before you trust this person with money or private data.' },
  FACE_SWAP_LIKELY: { tone: 'danger', title: 'Face-swap likely', summary: 'Several independent signals suggest this face may be generated or swapped in real time.' }
};

const ADVICE = {
  CALIBRATING: [
    'Keep the person\'s face fully visible and well lit.',
    'Wait a few seconds for the first reading.'
  ],
  LIKELY_REAL: [
    'Stay alert: a clean reading is not proof of identity.',
    'For payments or password resets, always confirm on a second channel.'
  ],
  CAUTION: [
    'Ask them to turn their head slowly to each side.',
    'Ask them to wave a hand in front of their face.',
    'Do not share OTPs, passwords or bank details on this call.'
  ],
  FACE_SWAP_LIKELY: [
    'Do not send money, OTPs, passwords or documents.',
    'End the call and phone the person back on a number you already know.',
    'Ask a question only the real person could answer.',
    'Report the attempt: call 1930 or visit cybercrime.gov.in (India).'
  ]
};

/** Main entry point: features in, verdict out. */
function analyzeFeatures(raw) {
  const f = sanitizeFeatures(raw);
  const signals = [];
  let weighted = 0;
  let weightSum = 0;

  for (const def of SIGNALS) {
    const v = num(def.read(f));
    if (v === null) {
      signals.push({ id: def.id, label: def.label, available: false, score: null, status: 'waiting', detail: 'Not enough data yet.' });
      continue;
    }
    const score = def.score(v);
    const status = score >= 60 ? 'danger' : score >= 35 ? 'warn' : 'safe';
    signals.push({ id: def.id, label: def.label, available: true, value: Math.round(v * 1000) / 1000, score, status, detail: def.detail(v, score) });
    weighted += score * def.weight;
    weightSum += def.weight;
  }

  const available = signals.filter((s) => s.available);
  const strong = available.filter((s) => s.score >= 60).length;
  let score = weightSum > 0 ? Math.round(weighted / weightSum) : 0;

  // Several unrelated signals must agree before we raise the full alarm.
  // This keeps a single noisy signal (bad lighting, low-bitrate video) from crying wolf.
  let level;
  if (f.observedSeconds < 6 || available.length < 3) {
    level = 'CALIBRATING';
  } else if (score >= 60 && strong >= 2) {
    level = 'FACE_SWAP_LIKELY';
  } else if (score >= 35 || strong >= 1) {
    level = 'CAUTION';
    score = Math.min(score, 59);
  } else {
    level = 'LIKELY_REAL';
  }

  // Confidence grows with watch time and with how many signals we could measure.
  const confidence = Math.round(
    Math.min(1, f.observedSeconds / 45) * 60 + Math.min(1, available.length / SIGNALS.length) * 40
  );

  const meta = LEVELS[level];
  return {
    level,
    tone: meta.tone,
    title: meta.title,
    summary: meta.summary,
    score,
    confidence,
    signals,
    advice: ADVICE[level],
    disclaimer: 'Indicator only, not proof. Always verify identity through a second channel.'
  };
}

module.exports = { analyzeFeatures, sanitizeFeatures, SIGNALS, LEVELS };
