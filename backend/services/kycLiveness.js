/**
 * Video-KYC liveness decision.
 *
 * The customer's browser asks them to perform random actions (blink twice, turn the head,
 * open the mouth, smile) and checks each one with a face-landmark AI model. This service
 * takes that report plus the Meeting Guard face-swap features and decides:
 *
 *   VERIFIED       all actions done in a human way, no face-swap or replay signs
 *   MANUAL_REVIEW  something was off: let a human officer decide
 *   REJECT         static photo / replayed clip / swapped face: do not onboard
 *
 * Random actions beat a replayed recording because an attacker cannot know the order in advance.
 */
const { analyzeFeatures } = require('./meetingGuard');

const CHALLENGE_IDS = ['BLINK_TWICE', 'TURN_HEAD', 'OPEN_MOUTH', 'SMILE'];
const LABEL = { BLINK_TWICE: 'Blink twice', TURN_HEAD: 'Turn head side to side', OPEN_MOUTH: 'Open mouth', SMILE: 'Smile' };

const num = (v, lo, hi, d = null) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

function decideLiveness(body) {
  const b = body && typeof body === 'object' ? body : {};
  const list = Array.isArray(b.challenges) ? b.challenges.slice(0, 8) : [];
  const challenges = list
    .filter((c) => c && CHALLENGE_IDS.includes(c.id))
    .map((c) => ({ id: c.id, label: LABEL[c.id], passed: !!c.passed, reactionMs: num(c.reactionMs, 0, 60000) }));
  const f = b.features && typeof b.features === 'object' ? b.features : {};
  const motion = {
    yawRange: num(f.yawRangeDeg, 0, 180, 0),
    blinks: num(f.blinkCount, 0, 200, 0),
    expressionVariance: num(f.expressionVariance, 0, 1, 0),
    seconds: num(f.observedSeconds, 0, 3600, 0)
  };

  const checks = [];
  const add = (id, label, status, severity, detail) => checks.push({ id, label, status, severity, detail });

  /* 1. Did they do the random actions? */
  const passed = challenges.filter((c) => c.passed).length;
  if (!challenges.length) add('actions', 'Random actions', 'fail', 'high', 'No liveness actions were reported.');
  else if (passed === challenges.length) add('actions', 'Random actions', 'pass', 'low', `All ${passed} requested actions were done.`);
  else if (passed === 0) add('actions', 'Random actions', 'fail', 'high', 'None of the requested actions were done. A photo or a recording cannot follow instructions it has not seen.');
  else if (passed * 2 < challenges.length) add('actions', 'Random actions', 'fail', 'high', `Only ${passed} of ${challenges.length} actions were done (missed: ${challenges.filter((c) => !c.passed).map((c) => c.label).join(', ')}). A replayed clip cannot follow instructions it has not seen.`);
  else add('actions', 'Random actions', 'fail', 'medium', `Only ${passed} of ${challenges.length} actions were done: ${challenges.filter((c) => !c.passed).map((c) => c.label).join(', ')}.`);

  /* 2. Reaction timing: instant or machine-regular reactions point to a pre-made clip. */
  const times = challenges.filter((c) => c.passed && c.reactionMs !== null).map((c) => c.reactionMs);
  if (times.length) {
    const tooFast = times.filter((t) => t < 250).length;
    if (tooFast) add('timing', 'Reaction time', 'fail', 'medium', `${tooFast} action${tooFast > 1 ? 's' : ''} finished in under 0.25 s, faster than a person can react to a new instruction.`);
    else if (times.length >= 3 && std(times) < 60) add('timing', 'Reaction time', 'fail', 'low', 'Reaction times were almost identical, which looks scripted.');
    else add('timing', 'Reaction time', 'pass', 'low', `Average reaction ${(mean(times) / 1000).toFixed(1)} s, which is human.`);
  }

  /* 3. Natural movement while on camera. */
  if (motion.seconds >= 6) {
    const still = motion.yawRange < 8 && motion.blinks === 0 && motion.expressionVariance < 0.005;
    if (still) add('motion', 'Natural movement', 'fail', 'high', 'The face showed no head movement, no blinking and no expression change. This is what a held-up photo or a frozen frame looks like.');
    else add('motion', 'Natural movement', 'pass', 'low', `Head moved ${Math.round(motion.yawRange)} degrees and blinked ${motion.blinks} times.`);
  }

  /* 4. Face-swap signals, reusing the Meeting Guard engine. */
  const swap = analyzeFeatures({
    observedSeconds: motion.seconds,
    blinksPerMin: num(f.blinksPerMin, 0, 120),
    contourJitter: num(f.contourJitter, 0, 20),
    sharpnessRatio: num(f.sharpnessRatio, 0, 20),
    colorShift: num(f.colorShift, 0, 1),
    expressionVariance: num(f.expressionVariance, 0, 1),
    faceVisibleRatio: num(f.faceVisibleRatio, 0, 1),
    profileBreak: num(f.profileBreak, 0, 1)
  });
  if (swap.level === 'FACE_SWAP_LIKELY') add('faceswap', 'Face-swap check', 'fail', 'high', 'The Meeting Guard engine found several face-swap signals (edge flicker, glitches when turning).');
  else if (swap.level === 'CAUTION') add('faceswap', 'Face-swap check', 'fail', 'medium', 'Some face-swap signals look unusual.');
  else if (swap.level === 'LIKELY_REAL') add('faceswap', 'Face-swap check', 'pass', 'low', 'No face-swap signals.');

  /* 5. More than one face in frame (someone coaching, or a second screen). */
  const faces = num(b.maxFaces, 0, 20, 1);
  if (faces > 1) add('faces', 'Single person', 'fail', 'medium', `${faces} faces were seen in the frame. Only the customer should be on camera.`);

  /* Decision */
  const high = checks.filter((c) => c.status === 'fail' && c.severity === 'high').length;
  const med = checks.filter((c) => c.status === 'fail' && c.severity === 'medium').length;
  const low = checks.filter((c) => c.status === 'fail' && c.severity === 'low').length;
  const risk = Math.min(100, high * 55 + med * 25 + low * 10);

  let verdict;
  if (high >= 1) verdict = 'REJECT';
  else if (med + low >= 1) verdict = 'MANUAL_REVIEW';
  else if (challenges.length >= 3 && passed === challenges.length) verdict = 'VERIFIED';
  else verdict = 'MANUAL_REVIEW';

  const META = {
    VERIFIED: { tone: 'safe', title: 'Liveness verified', summary: 'The customer followed random instructions naturally and no face-swap or replay signs were found.' },
    MANUAL_REVIEW: { tone: 'warn', title: 'Send to manual review', summary: 'Some checks were not clean. A human officer should review this video KYC.' },
    REJECT: { tone: 'danger', title: 'Reject: not a live person', summary: 'The session looks like a photo, a replayed video or a swapped face. Do not onboard this customer.' }
  }[verdict];

  return { verdict, ...META, riskScore: risk, checks, faceSwap: { level: swap.level, score: swap.score }, challenges, disclaimer: 'Indicator only. Combine with other KYC controls.' };
}

function newChallengeSet(count = 3) {
  const pool = [...CHALLENGE_IDS];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, Math.min(Math.max(count, 3), 4));
}

module.exports = { decideLiveness, newChallengeSet, CHALLENGE_IDS, LABEL };
