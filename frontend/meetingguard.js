/* VeriShield AI — Live Deepfake Meeting Guard.
   Runs Google's MediaPipe Face Landmarker (478 3D landmarks + 52 blendshapes) on the
   video inside this browser, turns the face's behaviour into a handful of numeric
   features, and asks the backend (/api/meeting/analyze) to fuse them into a verdict.
   No video or image is ever uploaded. */

const MP_VERSION = '0.10.14';
const MP_BASE = window.VERISHIELD_MP_BASE || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = window.VERISHIELD_MP_MODEL ||
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const FRAME_MS = 100;          // analyse about 10 frames a second
const ANALYZE_EVERY_MS = 2000; // send features for scoring every 2 seconds
const JITTER_WINDOW = 60;      // frames (about 6 s) used for edge-stability
const CHALLENGE_MS = 14000;

// Landmark index sets from MediaPipe's face mesh.
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const INNER = [1, 4, 6, 168, 197, 195, 33, 133, 362, 263];
const EXPRESSION_SHAPES = ['mouthSmileLeft', 'mouthSmileRight', 'browInnerUp', 'browDownLeft', 'browDownRight', 'mouthFunnel', 'mouthPucker', 'cheekSquintLeft', 'cheekSquintRight', 'jawOpen'];

const $ = (id) => document.getElementById(id);
const VS = window.VS;

/* ---------- Small helpers ---------- */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const std = (arr) => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
};
const pearson = (a, b) => {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx < 1e-9 || syy < 1e-9) return null;
  return sxy / Math.sqrt(sxx * syy);
};
const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ---------- Page state ---------- */

const state = {
  source: 'screen',
  running: false,
  landmarker: null,
  stream: null,
  audio: null,        // { ctx, analyser, buf }
  startedAt: 0,
  timer: null,
  lastAnalyze: 0,
  analyzing: false,
  ema: null,          // smoothed risk score
  lastLevel: 'IDLE',
  scores: [],
  peak: 0,
  alerts: 0,
  topSignals: new Map(),
  lastResult: null,
  muted: false,
  alarmCtx: null,
  demo: null
};

// Rolling measurements for the current session.
function freshMeasures() {
  return {
    framesSeen: 0,
    framesWithFace: 0,
    recentFace: [],          // last ~10 s of 1/0
    prev: [null, null],      // last two normalised frames (for acceleration)
    ovalAcc: [],
    innerAcc: [],
    eyesClosed: false,
    blinks: 0,
    faceSeconds: 0,
    expr: [],                // last ~10 s of expression vectors
    jaw: [],
    voice: [],
    sharp: null,
    color: null,
    challenge: null,
    challengeResult: null
  };
}
let M = freshMeasures();

/* ---------- UI ---------- */

const GAUGE_RISK = (() => { $('gaugeRisk').outerHTML = VS.gaugeHTML('gaugeRisk'); return $('gaugeRisk'); })();
const GAUGE_CONF = (() => { $('gaugeConf').outerHTML = VS.gaugeHTML('gaugeConf'); return $('gaugeConf'); })();

const HINTS = {
  screen: 'Share the tab or window that shows the call. Tick "share audio" to also check lip sync.',
  camera: 'Test the guard on your own face, or on a second device pointed at your camera.',
  demo: 'No camera needed. A simulated call that turns into a face-swap, to show how the alert works.'
};

function setSource(name) {
  state.source = name;
  document.querySelectorAll('[data-source]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === name)));
  $('sourceHint').textContent = HINTS[name];
}

document.querySelectorAll('[data-source]').forEach((b) => b.addEventListener('click', () => {
  if (!state.running) setSource(b.dataset.source);
}));
setSource('screen');

function setTag(text, tone) {
  const tag = $('stageTag');
  tag.hidden = !text;
  tag.textContent = text || '';
  if (tone) tag.dataset.tone = tone;
}

function logEvent(text, tone) {
  const ul = $('log');
  if (ul.children.length === 1 && ul.firstElementChild.textContent.includes('Nothing yet')) ul.innerHTML = '';
  const li = document.createElement('li');
  if (tone) li.dataset.tone = tone;
  const t = document.createElement('time');
  t.textContent = fmtTime(state.running ? (Date.now() - state.startedAt) / 1000 : 0);
  const s = document.createElement('span');
  s.textContent = text;
  li.append(t, s);
  ul.prepend(li);
  while (ul.children.length > 40) ul.lastElementChild.remove();
}

function paintVerdict(r) {
  const verdict = $('verdict');
  verdict.dataset.tone = r.tone;
  $('verdictIcon').innerHTML = VS.icon(r.tone === 'danger' ? 'alert' : r.tone === 'safe' ? 'check' : r.tone === 'warn' ? 'alert' : 'eye');
  $('verdictTitle').textContent = r.title;
  $('verdictText').textContent = r.summary;
  $('stage').dataset.level = r.level;
  VS.setGauge(GAUGE_RISK, r.score, r.level === 'CALIBRATING' ? 'safe' : VS.scoreTone(r.score), 'Face-swap risk');
  if (r.level === 'CALIBRATING') GAUGE_RISK.dataset.tone = 'idle';
  VS.setGauge(GAUGE_CONF, r.confidence, 'safe', 'Confidence');
  GAUGE_CONF.dataset.tone = 'safe';

  const sig = $('signals');
  if (sig.dataset.built !== '1' || sig.children.length !== r.signals.length) {
    sig.innerHTML = '';
    sig.dataset.built = r.signals.length ? '1' : '';
    r.signals.forEach(() => {
      const row = document.createElement('div');
      row.className = 'mg-signal';
      const name = document.createElement('div'); name.className = 'mg-signal__name';
      const bar = document.createElement('div'); bar.className = 'mg-signal__bar';
      bar.appendChild(document.createElement('i'));
      const detail = document.createElement('div'); detail.className = 'mg-signal__detail';
      row.append(name, bar, detail);
      sig.appendChild(row);
    });
  }
  r.signals.forEach((s, i) => {
    const row = sig.children[i];
    row.dataset.tone = s.status === 'waiting' ? '' : s.status;
    row.querySelector('.mg-signal__name').textContent = s.label;
    row.querySelector('.mg-signal__detail').textContent = s.detail;
    row.querySelector('i').style.width = `${s.available ? Math.max(4, s.score) : 0}%`;
  });

  const adv = $('advice');
  adv.innerHTML = '';
  r.advice.forEach((a) => { const li = document.createElement('li'); li.textContent = a; adv.appendChild(li); });
}

/* ---------- Alarm ---------- */

function beep() {
  if (state.muted) return;
  try {
    state.alarmCtx = state.alarmCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = state.alarmCtx;
    [0, 0.22].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.16);
    });
  } catch (e) { /* audio blocked */ }
}

$('muteBtn').addEventListener('click', () => {
  state.muted = !state.muted;
  $('muteBtn').setAttribute('aria-pressed', String(state.muted));
  $('muteBtn').textContent = `Alarm sound: ${state.muted ? 'off' : 'on'}`;
});

/* ---------- Face model ---------- */

async function loadModel() {
  if (state.landmarker) return state.landmarker;
  const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numFaces: 2,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  try {
    state.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (e) {
    state.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
  }
  return state.landmarker;
}

/* ---------- Feature extraction (one video frame) ---------- */

const patchCanvas = document.createElement('canvas');
patchCanvas.width = patchCanvas.height = 40;
const patchCtx = patchCanvas.getContext('2d', { willReadFrequently: true });

/** Laplacian variance (sharpness) and chroma of a square region of the video. */
function samplePatch(video, cx, cy, side) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const sx = cx - side / 2, sy = cy - side / 2;
  if (sx < 0 || sy < 0 || sx + side > vw || sy + side > vh || side < 8) return null;
  patchCtx.drawImage(video, sx, sy, side, side, 0, 0, 40, 40);
  const d = patchCtx.getImageData(0, 0, 40, 40).data;
  const lum = new Float32Array(1600);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 1600; i++) {
    const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2];
    lum[i] = 0.299 * R + 0.587 * G + 0.114 * B;
    r += R; g += G; b += B;
  }
  const lap = [];
  for (let y = 1; y < 39; y++) {
    for (let x = 1; x < 39; x++) {
      const i = y * 40 + x;
      lap.push(lum[i - 1] + lum[i + 1] + lum[i - 40] + lum[i + 40] - 4 * lum[i]);
    }
  }
  const total = r + g + b || 1;
  const cr = r / total, cg = g / total;
  // Only compare real skin: clothing, hair or a collar would give false alarms.
  const skin = cr > 0.34 && cr < 0.52 && cg > 0.28 && cg < 0.37 && cr > cg && total / 1600 / 3 > 40;
  return { sharp: std(lap) ** 2, cr, cg, skin };
}

/** Compare face skin (both cheeks) with the neck just under the chin. */
function sampleSkin(video, lm) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const px = (i) => [lm[i].x * vw, lm[i].y * vh];
  const [lx] = px(234), [rx] = px(454);
  const fw = Math.abs(rx - lx);
  const [chinX, chinY] = px(152);
  const [, top] = px(10);
  const fh = chinY - top;
  const side = fw * 0.14;
  const [c1x, c1y] = px(205), [c2x, c2y] = px(425);
  const cheeks = [samplePatch(video, c1x, c1y, side), samplePatch(video, c2x, c2y, side)].filter((p) => p && p.skin);
  const necks = [
    samplePatch(video, chinX - fw * 0.12, chinY + fh * 0.2, side),
    samplePatch(video, chinX + fw * 0.12, chinY + fh * 0.2, side)
  ].filter((p) => p && p.skin);
  if (!cheeks.length || !necks.length) return null;
  const avg = (list, k) => mean(list.map((p) => p[k]));
  const sharpRatio = (avg(cheeks, 'sharp') + 1) / (avg(necks, 'sharp') + 1);
  const chroma = Math.hypot(avg(cheeks, 'cr') - avg(necks, 'cr'), avg(cheeks, 'cg') - avg(necks, 'cg'));
  return { sharpRatio, color: clamp(chroma * 4, 0, 1) };
}

/** Pose (yaw in degrees) from MediaPipe's 4x4 facial transformation matrix (column-major). */
function yawFrom(matrix) {
  if (!matrix || !matrix.data) return 0;
  const d = matrix.data;
  return Math.abs(Math.atan2(-d[2], d[10]) * 180 / Math.PI);
}

function normalise(lm, indices, ref) {
  // Express points relative to the inner-feature centroid, in units of eye-to-eye distance.
  const cx = mean(ref.map((i) => lm[i].x)), cy = mean(ref.map((i) => lm[i].y));
  const scale = Math.hypot(lm[33].x - lm[263].x, lm[33].y - lm[263].y) || 1;
  return indices.map((i) => [(lm[i].x - cx) / scale, (lm[i].y - cy) / scale]);
}

function processFace(result, video, now) {
  M.framesSeen++;
  const faces = result.faceLandmarks || [];
  // Use the largest face (the person you are looking at).
  let idx = 0, best = 0;
  faces.forEach((f, i) => {
    const w = Math.abs(f[454].x - f[234].x);
    if (w > best) { best = w; idx = i; }
  });
  const lm = faces[idx];
  const has = !!lm;
  M.recentFace.push(has ? 1 : 0);
  if (M.recentFace.length > 100) M.recentFace.shift();
  if (M.challenge) M.challenge.frames.push({ has, yaw: has ? yawFrom((result.facialTransformationMatrixes || [])[idx]) : null, jit: null });
  if (!has) { M.prev = [null, null]; return null; }

  M.framesWithFace++;
  M.faceSeconds += FRAME_MS / 1000;

  // Edge stability: second difference of outline points vs inner points.
  const frame = { oval: normalise(lm, OVAL, INNER), inner: normalise(lm, INNER, INNER) };
  const [p1, p2] = M.prev;
  let frameJit = null;
  if (p1 && p2) {
    const acc = (cur, a, b) => mean(cur.map((p, i) => Math.hypot(p[0] - 2 * a[i][0] + b[i][0], p[1] - 2 * a[i][1] + b[i][1])));
    const o = acc(frame.oval, p1.oval, p2.oval);
    const n = acc(frame.inner, p1.inner, p2.inner);
    M.ovalAcc.push(o); M.innerAcc.push(n);
    if (M.ovalAcc.length > JITTER_WINDOW) { M.ovalAcc.shift(); M.innerAcc.shift(); }
    frameJit = (o + 0.0015) / (n + 0.0015);
  }
  M.prev = [frame, p1];
  if (M.challenge && frameJit !== null) M.challenge.frames[M.challenge.frames.length - 1].jit = frameJit;

  // Blendshapes: blinks, expression, mouth opening.
  const cats = ((result.faceBlendshapes || [])[idx] || {}).categories || [];
  const bs = {};
  cats.forEach((c) => { bs[c.categoryName] = c.score; });
  const eye = ((bs.eyeBlinkLeft || 0) + (bs.eyeBlinkRight || 0)) / 2;
  if (eye > 0.55 && !M.eyesClosed) M.eyesClosed = true;
  else if (eye < 0.35 && M.eyesClosed) { M.eyesClosed = false; M.blinks++; }
  M.expr.push(EXPRESSION_SHAPES.map((k) => bs[k] || 0));
  if (M.expr.length > 100) M.expr.shift();

  // Voice level for lip sync.
  let level = null;
  if (state.audio) {
    state.audio.analyser.getByteTimeDomainData(state.audio.buf);
    let s = 0;
    for (let i = 0; i < state.audio.buf.length; i++) { const v = (state.audio.buf[i] - 128) / 128; s += v * v; }
    level = Math.sqrt(s / state.audio.buf.length);
  }
  if (level !== null) {
    M.jaw.push(bs.jawOpen || 0); M.voice.push(level);
    if (M.jaw.length > 80) { M.jaw.shift(); M.voice.shift(); }
  }

  // Skin match every third frame, smoothed.
  if (M.framesSeen % 3 === 0) {
    const skin = sampleSkin(video, lm);
    if (skin) {
      const logSharp = Math.log(skin.sharpRatio);
      M.sharp = M.sharp === null ? logSharp : M.sharp * 0.85 + logSharp * 0.15;
      M.color = M.color === null ? skin.color : M.color * 0.85 + skin.color * 0.15;
    }
  }
  return lm;
}

function currentFeatures() {
  const seconds = (Date.now() - state.startedAt) / 1000;
  const faceMin = M.faceSeconds / 60;
  const exprDims = EXPRESSION_SHAPES.map((_, d) => std(M.expr.map((v) => v[d])));
  let contour = null;
  if (M.ovalAcc.length >= 20) contour = (mean(M.ovalAcc) + 0.0015) / (mean(M.innerAcc) + 0.0015);
  const sync = (M.voice.length >= 30 && std(M.voice) > 0.01 && std(M.jaw) > 0.02) ? pearson(M.jaw, M.voice) : null;
  return {
    observedSeconds: Math.round(M.faceSeconds),
    blinksPerMin: faceMin > 0 ? M.blinks / faceMin : null,
    contourJitter: contour,
    sharpnessRatio: M.sharp === null ? null : Math.exp(M.sharp),
    colorShift: M.color,
    expressionVariance: M.expr.length >= 20 ? mean(exprDims) : null,
    lipSyncCorr: sync,
    faceVisibleRatio: M.recentFace.length >= 20 ? mean(M.recentFace) : null,
    profileBreak: M.challengeResult,
    _wallSeconds: seconds
  };
}

/* ---------- Scoring (backend, with a small offline estimate) ---------- */

const ramp = (v, lo, hi) => Math.round(clamp((v - lo) / (hi - lo), 0, 1) * 100);

function offlineEstimate(f) {
  const parts = [];
  if (f.contourJitter != null) parts.push(ramp(f.contourJitter, 1.6, 3.2));
  if (f.sharpnessRatio != null) parts.push(Math.max(ramp(1 / Math.max(f.sharpnessRatio, 0.01), 1.6, 3.5), ramp(f.sharpnessRatio, 2.2, 5)));
  if (f.colorShift != null) parts.push(ramp(f.colorShift, 0.07, 0.2));
  const score = parts.length ? Math.round(mean(parts)) : 0;
  const level = f.observedSeconds < 6 || parts.length < 2 ? 'CALIBRATING' : score >= 60 ? 'FACE_SWAP_LIKELY' : score >= 35 ? 'CAUTION' : 'LIKELY_REAL';
  const tone = { CALIBRATING: 'accent', LIKELY_REAL: 'safe', CAUTION: 'warn', FACE_SWAP_LIKELY: 'danger' }[level];
  return {
    level, tone, score, confidence: Math.min(60, Math.round(f.observedSeconds)),
    title: level === 'FACE_SWAP_LIKELY' ? 'Face-swap likely' : level === 'CAUTION' ? 'Be careful' : level === 'CALIBRATING' ? 'Calibrating' : 'No face-swap signs',
    summary: 'Scoring server unreachable, showing a basic on-device estimate.',
    signals: [], advice: ['Start the VeriShield backend for the full analysis.'], offline: true
  };
}

async function score(features) {
  const clean = { ...features };
  delete clean._wallSeconds;
  try {
    const res = await VS.api('/meeting/analyze', { method: 'POST', body: { features: clean } });
    return res;
  } catch (e) {
    if (!state.warnedOffline) { state.warnedOffline = true; VS.toast(e.message, 'danger'); }
    return offlineEstimate(clean);
  }
}

function onResult(r) {
  state.lastResult = r;
  // Smooth the headline number so it does not jump around.
  state.ema = state.ema === null ? r.score : state.ema * 0.6 + r.score * 0.4;
  const shown = { ...r, score: Math.round(state.ema) };
  paintVerdict(shown);
  if (r.level !== 'CALIBRATING') { state.scores.push(r.score); state.peak = Math.max(state.peak, r.score); }
  (r.signals || []).filter((s) => s.score >= 60).forEach((s) => state.topSignals.set(s.label, (state.topSignals.get(s.label) || 0) + 1));

  if (r.level !== state.lastLevel) {
    if (r.level === 'FACE_SWAP_LIKELY') {
      state.alerts++;
      logEvent('FACE-SWAP LIKELY. Stop and verify this person another way.', 'danger');
      VS.toast('Face-swap likely. Do not send money or share codes.', 'danger');
      beep();
    } else if (r.level === 'CAUTION') logEvent('Some signals look unusual. Be careful.', 'warn');
    else if (r.level === 'LIKELY_REAL') logEvent('No face-swap signs right now.');
    state.lastLevel = r.level;
  }
}

/* ---------- Overlay drawing ---------- */

const overlay = $('overlay');
const octx = overlay.getContext('2d');

function drawOverlay(lm, video) {
  const w = (overlay.width = video.videoWidth || 640);
  const h = (overlay.height = video.videoHeight || 360);
  octx.clearRect(0, 0, w, h);
  if (!lm) return;
  const tone = { danger: '#ff6178', warn: '#f5b84a', safe: '#3ddc97', accent: '#928fff' }[(state.lastResult && state.lastResult.tone) || 'accent'];
  octx.strokeStyle = tone;
  octx.lineWidth = Math.max(3, w / 180);
  octx.beginPath();
  OVAL.forEach((i, k) => { const x = lm[i].x * w, y = lm[i].y * h; k ? octx.lineTo(x, y) : octx.moveTo(x, y); });
  octx.closePath();
  octx.stroke();
}

/* ---------- Main loop ---------- */

async function tick() {
  if (!state.running) return;
  const video = $('video');
  const t0 = performance.now();
  try {
    if (state.source !== 'demo' && video.readyState >= 2 && state.landmarker) {
      const result = state.landmarker.detectForVideo(video, t0);
      const lm = processFace(result, video, t0);
      drawOverlay(lm, video);
      setTag(lm ? 'Face tracked' : 'No face found', lm ? 'safe' : 'warn');
      if (M.challenge) updateChallenge();
    } else if (state.source === 'demo') {
      stepDemo();
    }

    const now = Date.now();
    if (now - state.lastAnalyze >= ANALYZE_EVERY_MS && !state.analyzing) {
      state.lastAnalyze = now;
      state.analyzing = true;
      const features = state.source === 'demo' ? demoFeatures() : currentFeatures();
      score(features).then(onResult).finally(() => { state.analyzing = false; });
    }
  } catch (e) {
    console.error('Meeting Guard frame error:', e);
  }
  state.timer = setTimeout(tick, Math.max(0, FRAME_MS - (performance.now() - t0)));
}

/* ---------- Head-turn challenge ---------- */

function startChallenge() {
  if (!state.running || state.source === 'demo') return;
  M.challenge = { start: Date.now(), frames: [] };
  $('challengeBtn').disabled = true;
  $('challengeHint').textContent = 'Ask the person to slowly turn their head left, then right, and back.';
  logEvent('Head-turn test started. Ask them to turn their head slowly.');
}

function updateChallenge() {
  const c = M.challenge;
  const left = Math.max(0, Math.ceil((CHALLENGE_MS - (Date.now() - c.start)) / 1000));
  $('challengeHint').textContent = `Head-turn test: ${left}s left. Ask them to look left, then right.`;
  if (Date.now() - c.start < CHALLENGE_MS) return;

  const frames = c.frames;
  const maxYaw = Math.max(0, ...frames.filter((f) => f.yaw !== null).map((f) => f.yaw));
  const side = frames.filter((f) => f.yaw !== null && f.yaw > 28);
  const front = frames.filter((f) => f.yaw !== null && f.yaw < 12 && f.jit !== null);
  const lostAtSide = frames.filter((f) => !f.has).length / Math.max(1, frames.length);
  M.challenge = null;
  $('challengeBtn').disabled = false;

  if (maxYaw < 28 || side.length < 4 || front.length < 4) {
    $('challengeHint').textContent = 'The head did not turn far enough. Try the test again and ask them to turn further.';
    logEvent('Head-turn test incomplete: the head did not turn far enough.', 'warn');
    return;
  }
  const sideJit = mean(side.filter((f) => f.jit !== null).map((f) => f.jit));
  const frontJit = mean(front.map((f) => f.jit));
  const result = clamp(Math.max((sideJit / frontJit - 1.4) / 2.5, lostAtSide * 1.5), 0, 1);
  M.challengeResult = result;
  const bad = result >= 0.5;
  $('challengeHint').textContent = bad ? 'The face glitched when turned. That is a warning sign.' : 'The face held up while turning.';
  logEvent(bad ? 'Head-turn test: the face glitched at the side.' : 'Head-turn test passed.', bad ? 'danger' : undefined);
  state.lastAnalyze = 0; // rescore straight away
}

$('challengeBtn').addEventListener('click', startChallenge);

/* ---------- Demo mode (simulated call) ---------- */

function startDemo() {
  state.demo = { t: 0 };
  setTag('Simulation', 'accent');
}

function demoPhase() {
  const t = (Date.now() - state.startedAt) / 1000;
  // 0 to 14 s: normal person. 14 to 26 s: the swap slips in. After: obvious swap.
  const k = clamp((t - 14) / 12, 0, 1);
  return { t, k };
}

function stepDemo() {
  const { t, k } = demoPhase();
  const c = overlay;
  c.width = 640; c.height = 360;
  const g = octx;
  g.clearRect(0, 0, 640, 360);
  g.fillStyle = '#0b0f15';
  g.fillRect(0, 0, 640, 360);
  const tone = k > 0.7 ? '#ff6178' : k > 0.25 ? '#f5b84a' : '#3ddc97';
  g.strokeStyle = tone; g.fillStyle = tone;
  const cx = 320 + Math.sin(t * 0.8) * 24, cy = 175 + Math.cos(t * 0.6) * 8;
  // Face outline as 36 dots, shaking more as the swap takes over.
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const shake = k * 11;
    const x = cx + Math.cos(a) * 92 + (Math.random() - 0.5) * (1 + shake * 2);
    const y = cy + Math.sin(a) * 118 + (Math.random() - 0.5) * (1 + shake * 2);
    g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
  }
  // Eyes and mouth.
  const blink = (Math.sin(t * 2.1) > 0.97 && k < 0.5) ? 1 : 6;
  g.fillRect(cx - 40, cy - 30, 22, blink); g.fillRect(cx + 18, cy - 30, 22, blink);
  g.fillRect(cx - 26, cy + 48, 52, 4 + (k < 0.5 ? Math.abs(Math.sin(t * 5)) * 8 : 0));
  setTag('Simulation', 'accent');
}

function demoFeatures() {
  const { t, k } = demoPhase();
  const j = () => (Math.random() - 0.5);
  return {
    observedSeconds: Math.round(t),
    blinksPerMin: t > 20 ? 17 - 15 * k + j() * 2 : null,
    contourJitter: 1.1 + k * 2.4 + j() * 0.2,
    sharpnessRatio: 1 - k * 0.72 + j() * 0.05,
    colorShift: 0.03 + k * 0.17 + j() * 0.01,
    expressionVariance: t > 15 ? 0.06 - k * 0.052 : null,
    lipSyncCorr: 0.62 - k * 0.55,
    faceVisibleRatio: 1 - k * 0.2,
    profileBreak: null
  };
}

/* ---------- Start / stop ---------- */

async function getStream() {
  if (state.source === 'screen') {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('This browser cannot share a window. Use Chrome or Edge on a computer, or try "My camera".');
    }
    return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true });
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera access is not available here. Open the page over HTTPS or localhost.');
  }
  return navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
}

function attachAudio(stream) {
  state.audio = null;
  if (!stream.getAudioTracks().length) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser); // not connected to speakers, so no echo
    state.audio = { ctx, analyser, buf: new Uint8Array(analyser.fftSize) };
  } catch (e) { /* lip sync just stays unavailable */ }
}

async function start() {
  const startBtn = $('startBtn');
  startBtn.disabled = true;
  startBtn.innerHTML = '<span class="spinner"></span>Loading AI model…';
  try {
    M = freshMeasures();
    Object.assign(state, { ema: null, lastLevel: 'IDLE', scores: [], peak: 0, alerts: 0, topSignals: new Map(), lastResult: null, warnedOffline: false, lastAnalyze: 0 });
    $('log').innerHTML = '<li><time>--:--</time><span>Nothing yet.</span></li>';
    $('summaryActions').hidden = true;

    const video = $('video');
    if (state.source === 'demo') {
      startDemo();
      video.hidden = true;
    } else {
      await loadModel();
      startBtn.innerHTML = '<span class="spinner"></span>Waiting for video…';
      state.stream = await getStream();
      video.srcObject = state.stream;
      video.hidden = false;
      await video.play();
      attachAudio(state.stream);
      state.stream.getVideoTracks()[0].addEventListener('ended', () => { if (state.running) stop(); });
    }

    $('stageIdle').hidden = true;
    state.startedAt = Date.now();
    state.running = true;
    document.querySelectorAll('[data-source]').forEach((b) => { b.disabled = true; });
    startBtn.hidden = true;
    $('stopBtn').hidden = false;
    $('challengeBtn').disabled = state.source === 'demo';
    logEvent(state.source === 'demo' ? 'Simulation started.' : 'Guard started. Watching for a face…');
    paintVerdict({ level: 'CALIBRATING', tone: 'accent', title: 'Calibrating', summary: 'Learning what this face normally looks like. Keep it in view.', score: 0, confidence: 0, signals: [], advice: ['Keep the person\'s face fully visible and well lit.'] });
    tick();
  } catch (err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'AbortError');
    VS.toast(denied ? 'Sharing was cancelled, so the guard did not start.' : (err.message || 'Could not start the guard.'), 'danger');
    cleanupStream();
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = 'Start guard';
  }
}

function cleanupStream() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  if (state.audio) { try { state.audio.ctx.close(); } catch (e) { /* ignore */ } }
  state.audio = null;
  const video = $('video');
  video.srcObject = null;
}

function stop() {
  if (!state.running) return;
  state.running = false;
  clearTimeout(state.timer);
  cleanupStream();
  M.challenge = null;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  $('video').hidden = true;
  $('stageIdle').hidden = false;
  setTag('', '');
  $('startBtn').hidden = false;
  $('stopBtn').hidden = true;
  $('challengeBtn').disabled = true;
  $('challengeHint').textContent = 'The head-turn test asks the other person to look left and right. Face-swap models often glitch at the side.';
  document.querySelectorAll('[data-source]').forEach((b) => { b.disabled = false; });

  const seconds = Math.round((Date.now() - state.startedAt) / 1000);
  logEvent(`Guard stopped after ${fmtTime(seconds)}. ${state.alerts} alert${state.alerts === 1 ? '' : 's'}.`);
  $('summaryActions').hidden = false;
  $('saveBtn').disabled = false;
  $('saveBtn').textContent = VS.getToken() ? 'Save session to my account' : 'Sign in to save this session';
}

$('startBtn').addEventListener('click', start);
$('stopBtn').addEventListener('click', stop);

/* ---------- Saved sessions ---------- */

async function saveSession() {
  if (!VS.getToken()) { location.href = 'auth.html?next=meetingguard.html'; return; }
  const btn = $('saveBtn');
  btn.disabled = true;
  const top = [...state.topSignals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const last = state.lastResult;
  try {
    await VS.api('/meeting/sessions', {
      method: 'POST',
      body: {
        label: state.source === 'demo' ? 'Simulation' : 'Video call',
        source: state.source,
        durationSeconds: Math.round((Date.now() - state.startedAt) / 1000),
        averageScore: Math.round(mean(state.scores)),
        peakScore: state.peak,
        alertCount: state.alerts,
        verdict: last ? last.level : 'LIKELY_REAL',
        topSignals: top
      }
    });
    btn.textContent = 'Saved';
    VS.toast('Session saved to your account.', 'safe');
    loadHistory();
  } catch (e) {
    btn.disabled = false;
    VS.toast(e.message, 'danger');
  }
}

$('saveBtn').addEventListener('click', saveSession);

async function loadHistory() {
  if (!VS.getToken()) return;
  try {
    const data = await VS.api('/meeting/history');
    const list = data.sessions || [];
    $('historyBlock').hidden = !list.length;
    const ul = $('history');
    ul.innerHTML = '';
    list.slice(0, 5).forEach((s) => {
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.textContent = `${VS.formatDate(s.createdAt)} · ${fmtTime(s.durationSeconds || 0)}`;
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.tone = { FACE_SWAP_LIKELY: 'danger', CAUTION: 'warn', LIKELY_REAL: 'safe' }[s.verdict] || '';
      chip.textContent = `${s.alertCount} alert${s.alertCount === 1 ? '' : 's'} · peak ${s.peakScore}`;
      li.append(left, chip);
      ul.appendChild(li);
    });
  } catch (e) { /* history is optional */ }
}

loadHistory();
window.addEventListener('pagehide', () => { if (state.running) cleanupStream(); });

// Exposed for automated tests.
window.__guard = { state, currentFeatures, demoFeatures };
