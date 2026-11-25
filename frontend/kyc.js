/* VeriShield AI — KYC & loan fraud desk.
   Three checks: document tamper check, video-KYC liveness, voice-clone check.
   Faces and voices are analysed in this browser; only numbers (and the document you choose
   to upload) go to the backend at /api/kyc/*. */

const MP_VERSION = '0.10.14';
const MP_BASE = window.VERISHIELD_MP_BASE || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = window.VERISHIELD_MP_MODEL ||
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const $ = (id) => document.getElementById(id);
const VS = window.VS;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------- Shared rendering ---------- */

function verdictBlock(prefix, r) {
  $(`${prefix}Verdict`).dataset.tone = r.tone;
  $(`${prefix}VIcon`).innerHTML = VS.icon(r.tone === 'safe' ? 'check' : r.tone === 'accent' ? 'eye' : 'alert');
  $(`${prefix}VTitle`).textContent = r.title;
  $(`${prefix}VText`).textContent = r.summary;
}

/** Rows with a coloured bar. items: [{ label, tone: safe|warn|danger|'' , pct, detail }] */
function rows(host, items) {
  host.innerHTML = '';
  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'mg-signal';
    row.dataset.tone = it.tone || '';
    const name = document.createElement('div'); name.className = 'mg-signal__name'; name.textContent = it.label;
    const bar = document.createElement('div'); bar.className = 'mg-signal__bar';
    const fill = document.createElement('i'); fill.style.width = `${it.pct}%`; bar.appendChild(fill);
    const detail = document.createElement('div'); detail.className = 'mg-signal__detail'; detail.textContent = it.detail;
    row.append(name, bar, detail);
    host.appendChild(row);
  });
}

function list(host, items) {
  host.innerHTML = '';
  items.forEach((t) => { const li = document.createElement('li'); li.textContent = t; host.appendChild(li); });
}

const checkTone = (c) => (c.status === 'pass' ? 'safe' : c.status === 'fail' ? (c.severity === 'high' ? 'danger' : 'warn') : '');
const checkPct = (c) => (c.status === 'pass' ? 12 : c.status === 'fail' ? (c.severity === 'high' ? 92 : c.severity === 'medium' ? 62 : 38) : 0);

['gaugeDoc', 'gaugeLive', 'gaugeVoice'].forEach((id) => { $(id).outerHTML = VS.gaugeHTML(id); });

/* ---------- Tabs ---------- */

function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  try { history.replaceState(null, '', `#${name}`); } catch (e) { /* ignore */ }
}
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
showTab(['doc', 'live', 'voice'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'doc');

/* ==========================================================================
   1. Document check
   ========================================================================== */

const SAMPLE_BASE = 'samples/docs/';
const AADHAAR_OK = '4821 7365 9049', AADHAAR_BAD = '4821 7365 9042';
const DOC_SAMPLES = {
  aadhaar: [
    ['Genuine PDF', 'genuine_aadhaar.pdf', 'application/pdf', {}],
    ['Wrong checksum + Canva', 'tampered_aadhaar_checksum.pdf', 'application/pdf', {}],
    ['Camera photo', 'genuine_aadhaar_photo.jpg', 'image/jpeg', { aadhaar: AADHAAR_OK }],
    ['Photoshopped photo', 'tampered_aadhaar_photo.png', 'image/png', { aadhaar: AADHAAR_BAD }]
  ],
  pan: [
    ['Genuine PAN', 'genuine_pan.pdf', 'application/pdf', {}],
    ['Wrong surname letter', 'tampered_pan_surname.pdf', 'application/pdf', {}]
  ],
  salary: [
    ['Genuine slip', 'genuine_salary_slip.pdf', 'application/pdf', {}],
    ['Totals changed', 'tampered_salary_totals.pdf', 'application/pdf', {}],
    ['Made in Word', 'tampered_salary_word.pdf', 'application/pdf', {}]
  ],
  bank: [
    ['Genuine statement', 'genuine_bank_statement.pdf', 'application/pdf', {}],
    ['Edited statement', 'tampered_bank_statement.pdf', 'application/pdf', {}]
  ]
};

const doc = { type: 'aadhaar', file: null };
$('docDropIcon').innerHTML = VS.icon('upload');
$('docClear').innerHTML = VS.icon('x');

function paintSamples() {
  const host = $('docSamples');
  host.innerHTML = '';
  DOC_SAMPLES[doc.type].forEach(([label, file, mime, fields]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'example'; b.textContent = label;
    b.addEventListener('click', async () => {
      try {
        const blob = await (await fetch(SAMPLE_BASE + file)).blob();
        setFile(new File([blob], file, { type: mime }));
        $('fAadhaar').value = fields.aadhaar || '';
        runDoc();
      } catch (e) { VS.toast('Could not load the specimen.', 'danger'); }
    });
    host.appendChild(b);
  });
}

document.querySelectorAll('#docTypes button').forEach((b) => b.addEventListener('click', () => {
  doc.type = b.dataset.type;
  document.querySelectorAll('#docTypes button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  paintSamples();
}));
paintSamples();

function setFile(file) {
  doc.file = file;
  $('docChosen').hidden = !file;
  $('docDrop').hidden = !!file;
  if (file) { $('docName').textContent = file.name; $('docSize').textContent = VS.formatBytes(file.size); }
}
$('docDrop').addEventListener('click', () => $('docFile').click());
$('docDrop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('docFile').click(); } });
$('docFile').addEventListener('change', () => { if ($('docFile').files[0]) setFile($('docFile').files[0]); });
$('docClear').addEventListener('click', () => { setFile(null); $('docFile').value = ''; });
['dragover', 'dragenter'].forEach((ev) => $('docDrop').addEventListener(ev, (e) => { e.preventDefault(); $('docDrop').classList.add('is-drag'); }));
['dragleave', 'drop'].forEach((ev) => $('docDrop').addEventListener(ev, (e) => { e.preventDefault(); $('docDrop').classList.remove('is-drag'); }));
$('docDrop').addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });
$('docBtn').addEventListener('click', runDoc);

function docState(name) {
  $('docEmpty').hidden = name !== 'empty';
  $('docLoading').hidden = name !== 'loading';
  $('docResult').hidden = name !== 'result';
}

async function runDoc() {
  if (!doc.file) return VS.toast('Choose a document first.', 'danger');
  const fields = {};
  [['aadhaar', 'fAadhaar'], ['pan', 'fPan'], ['name', 'fName'], ['ifsc', 'fIfsc'], ['gross', 'fGross'], ['net', 'fNet']].forEach(([k, id]) => {
    const v = $(id).value.trim();
    if (v) fields[k] = v;
  });
  const fd = new FormData();
  fd.append('document', doc.file);
  fd.append('docType', doc.type);
  fd.append('fields', JSON.stringify(fields));
  $('docBtn').disabled = true;
  docState('loading');
  try {
    const r = await VS.api('/kyc/document', { method: 'POST', formData: fd });
    verdictBlock('doc', r);
    VS.setGauge($('gaugeDoc'), r.score, r.verdict === 'UNVERIFIED' ? 'safe' : VS.scoreTone(r.score), 'Forgery risk');
    if (r.verdict === 'UNVERIFIED') $('gaugeDoc').dataset.tone = 'idle';
    rows($('docChecks'), r.checks.map((c) => ({ label: c.label, tone: checkTone(c), pct: checkPct(c), detail: c.detail })));
    list($('docAdvice'), r.advice);
    $('docHash').textContent = r.sha256;
    docState('result');
  } catch (e) {
    VS.toast(e.message, 'danger');
    docState('empty');
  } finally {
    $('docBtn').disabled = false;
  }
}

/* ==========================================================================
   2. Video-KYC liveness
   ========================================================================== */

const LABEL = { BLINK_TWICE: 'Blink twice', TURN_HEAD: 'Turn your head to the left, then to the right', OPEN_MOUTH: 'Open your mouth wide', SMILE: 'Give a big smile' };
const SHORT = { BLINK_TWICE: 'Blink twice', TURN_HEAD: 'Turn head side to side', OPEN_MOUTH: 'Open mouth', SMILE: 'Smile' };
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const INNER = [1, 4, 6, 168, 197, 195, 33, 133, 362, 263];
const EXPR = ['mouthSmileLeft', 'mouthSmileRight', 'browInnerUp', 'browDownLeft', 'browDownRight', 'mouthFunnel', 'mouthPucker', 'cheekSquintLeft', 'cheekSquintRight', 'jawOpen'];
const CHALLENGE_MS = 9000;

let landmarker = null;
let live = null;

function normalise(lm, indices) {
  const cx = mean(INNER.map((i) => lm[i].x)), cy = mean(INNER.map((i) => lm[i].y));
  const scale = Math.hypot(lm[33].x - lm[263].x, lm[33].y - lm[263].y) || 1;
  return indices.map((i) => [(lm[i].x - cx) / scale, (lm[i].y - cy) / scale]);
}

async function loadModel() {
  if (landmarker) return landmarker;
  const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'VIDEO', numFaces: 2, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
  try { landmarker = await vision.FaceLandmarker.createFromOptions(fileset, opts('GPU')); }
  catch (e) { landmarker = await vision.FaceLandmarker.createFromOptions(fileset, opts('CPU')); }
  return landmarker;
}

function liveSteps() {
  const ul = $('liveSteps');
  ul.innerHTML = '';
  live.challenges.forEach((c, i) => {
    const li = document.createElement('li');
    const r = live.results[i];
    li.textContent = `${r ? (r.passed ? '✓ ' : '✗ ') : (i === live.idx ? '▶ ' : '')}${SHORT[c]}`;
    if (r) li.style.color = r.passed ? 'var(--safe)' : 'var(--danger)';
    ul.appendChild(li);
  });
}

function setPrompt(title, text, tone) {
  $('livePrompt').hidden = false;
  $('livePrompt').dataset.tone = tone || 'accent';
  $('livePromptIcon').innerHTML = VS.icon(tone === 'safe' ? 'check' : 'eye');
  $('livePromptTitle').textContent = title;
  $('livePromptText').textContent = text;
}

async function startLive() {
  $('liveStart').disabled = true;
  $('liveStart').innerHTML = '<span class="spinner"></span>Loading AI model…';
  try {
    await loadModel();
    let challenges;
    try { challenges = (await VS.api('/kyc/liveness/challenges')).challenges; }
    catch (e) { challenges = ['BLINK_TWICE', 'TURN_HEAD', 'SMILE']; }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    const video = $('liveVideo');
    video.srcObject = stream; video.hidden = false; await video.play();
    $('liveIdle').hidden = true; $('liveResult').hidden = true;

    live = {
      stream, challenges, idx: 0, results: [], promptAt: Date.now(), startedAt: Date.now(),
      closed: false, blinksNow: 0, blinksTotal: 0, yawMin: 0, yawMax: 0, yawSeenMin: 0, yawSeenMax: 0,
      mouthFrames: 0, smileFrames: 0, prev: [null, null], ovalAcc: [], innerAcc: [], hiJit: [], loJit: [],
      frames: 0, faceFrames: 0, expr: [], maxFaces: 1, timer: null, pause: false
    };
    $('liveStart').hidden = true; $('liveStop').hidden = false;
    liveSteps();
    setPrompt(SHORT[challenges[0]], LABEL[challenges[0]], 'accent');
    tickLive();
  } catch (e) {
    VS.toast(e.name === 'NotAllowedError' ? 'Camera permission was denied.' : (e.message || 'Could not start the camera.'), 'danger');
    stopLive(true);
  }
}

function tickLive() {
  if (!live) return;
  const L = live, video = $('liveVideo');
  try {
    if (!L.pause && video.readyState >= 2) {
      const res = landmarker.detectForVideo(video, performance.now());
      L.frames++;
      L.maxFaces = Math.max(L.maxFaces, (res.faceLandmarks || []).length);
      let idx = 0, best = 0;
      (res.faceLandmarks || []).forEach((f, i) => { const w = Math.abs(f[454].x - f[234].x); if (w > best) { best = w; idx = i; } });
      const lm = (res.faceLandmarks || [])[idx];
      drawLive(lm, video);
      if (lm) {
        L.faceFrames++;
        const d = ((res.facialTransformationMatrixes || [])[idx] || {}).data;
        const yaw = d ? Math.atan2(-d[2], d[10]) * 180 / Math.PI : 0;
        L.yawMin = Math.min(L.yawMin, yaw); L.yawMax = Math.max(L.yawMax, yaw);
        L.chYawMin = Math.min(L.chYawMin ?? 0, yaw); L.chYawMax = Math.max(L.chYawMax ?? 0, yaw);

        const bs = {};
        (((res.faceBlendshapes || [])[idx] || {}).categories || []).forEach((c) => { bs[c.categoryName] = c.score; });
        const eye = ((bs.eyeBlinkLeft || 0) + (bs.eyeBlinkRight || 0)) / 2;
        if (eye > 0.55 && !L.closed) L.closed = true;
        else if (eye < 0.35 && L.closed) { L.closed = false; L.blinksNow++; L.blinksTotal++; }
        L.mouthFrames = (bs.jawOpen || 0) > 0.5 ? L.mouthFrames + 1 : 0;
        L.smileFrames = ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2 > 0.45 ? L.smileFrames + 1 : 0;
        L.expr.push(EXPR.map((k) => bs[k] || 0)); if (L.expr.length > 300) L.expr.shift();

        // Edge stability, split by how far the head is turned.
        const cur = { oval: normalise(lm, OVAL), inner: normalise(lm, INNER) };
        const [p1, p2] = L.prev;
        if (p1 && p2) {
          const acc = (c, a, b) => mean(c.map((p, i) => Math.hypot(p[0] - 2 * a[i][0] + b[i][0], p[1] - 2 * a[i][1] + b[i][1])));
          const o = acc(cur.oval, p1.oval, p2.oval), n = acc(cur.inner, p1.inner, p2.inner);
          L.ovalAcc.push(o); L.innerAcc.push(n);
          const ratio = (o + 0.0015) / (n + 0.0015);
          if (Math.abs(yaw) > 25) L.hiJit.push(ratio); else if (Math.abs(yaw) < 12) L.loJit.push(ratio);
        }
        L.prev = [cur, p1];
        checkChallenge(yaw);
      } else L.prev = [null, null];
    }
  } catch (e) { console.error('Liveness frame error:', e); }
  L.timer = setTimeout(tickLive, 100);
}

function resetChallengeState() {
  const L = live;
  L.blinksNow = 0; L.mouthFrames = 0; L.smileFrames = 0; L.chYawMin = 0; L.chYawMax = 0;
  L.promptAt = Date.now();
}

function checkChallenge(yaw) {
  const L = live, id = L.challenges[L.idx];
  if (!id || L.pause) return;
  const elapsed = Date.now() - L.promptAt;
  let ok = false;
  if (id === 'BLINK_TWICE') ok = L.blinksNow >= 2;
  else if (id === 'OPEN_MOUTH') ok = L.mouthFrames >= 3;
  else if (id === 'SMILE') ok = L.smileFrames >= 3;
  else if (id === 'TURN_HEAD') ok = L.chYawMax > 22 && L.chYawMin < -22;
  if (ok || elapsed > CHALLENGE_MS) finishChallenge(ok, elapsed);
}

function finishChallenge(ok, elapsed) {
  const L = live;
  L.results.push({ id: L.challenges[L.idx], passed: ok, reactionMs: ok ? Math.round(elapsed) : null });
  L.idx++;
  liveSteps();
  if (L.idx >= L.challenges.length) return finishLive();
  L.pause = true;
  setPrompt(ok ? 'Good' : 'Time is up', ok ? 'Next instruction in a moment…' : 'Moving on to the next instruction…', ok ? 'safe' : 'warn');
  setTimeout(() => {
    if (!live) return;
    resetChallengeState(); L.pause = false;
    setPrompt(SHORT[L.challenges[L.idx]], LABEL[L.challenges[L.idx]], 'accent');
  }, 1400);
}

function liveFeatures() {
  const L = live;
  const seconds = (Date.now() - L.startedAt) / 1000;
  const exprDims = EXPR.map((_, d) => std(L.expr.map((v) => v[d])));
  const contour = L.ovalAcc.length >= 20 ? (mean(L.ovalAcc) + 0.0015) / (mean(L.innerAcc) + 0.0015) : null;
  let profileBreak = null;
  if (L.hiJit.length >= 4 && L.loJit.length >= 4) profileBreak = clamp((mean(L.hiJit) / mean(L.loJit) - 1.4) / 2.5, 0, 1);
  const faceSeconds = L.faceFrames * 0.1;
  return {
    observedSeconds: Math.round(faceSeconds), yawRangeDeg: L.yawMax - L.yawMin, blinkCount: L.blinksTotal,
    blinksPerMin: faceSeconds >= 20 ? L.blinksTotal / (faceSeconds / 60) : null,
    contourJitter: contour, expressionVariance: L.expr.length >= 20 ? mean(exprDims) : null,
    faceVisibleRatio: L.frames ? L.faceFrames / L.frames : null, profileBreak, _wall: seconds
  };
}

async function finishLive() {
  const L = live;
  const payload = { challenges: L.results, features: liveFeatures(), maxFaces: L.maxFaces };
  delete payload.features._wall;
  stopLive(false);
  await submitLive(payload);
}

async function submitLive(payload) {
  try {
    const r = await VS.api('/kyc/liveness', { method: 'POST', body: payload });
    verdictBlock('live', r);
    VS.setGauge($('gaugeLive'), r.riskScore, VS.scoreTone(r.riskScore), 'Fraud risk');
    rows($('liveChecks'), r.checks.map((c) => ({ label: c.label, tone: checkTone(c), pct: checkPct(c), detail: c.detail })));
    $('liveResult').hidden = false;
    $('livePrompt').hidden = true;
  } catch (e) { VS.toast(e.message, 'danger'); }
}

function drawLive(lm, video) {
  const c = $('liveOverlay'), g = c.getContext('2d');
  c.width = video.videoWidth || 640; c.height = video.videoHeight || 360;
  g.clearRect(0, 0, c.width, c.height);
  if (!lm) return;
  g.strokeStyle = '#928fff'; g.lineWidth = Math.max(3, c.width / 180);
  g.beginPath();
  OVAL.forEach((i, k) => { const x = lm[i].x * c.width, y = lm[i].y * c.height; k ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.closePath(); g.stroke();
}

function stopLive(cancelled) {
  if (live) {
    clearTimeout(live.timer);
    if (live.stream) live.stream.getTracks().forEach((t) => t.stop());
  }
  live = null;
  $('liveVideo').srcObject = null; $('liveVideo').hidden = true;
  const c = $('liveOverlay'); c.getContext('2d').clearRect(0, 0, c.width, c.height);
  $('liveIdle').hidden = false;
  $('liveStart').hidden = false; $('liveStart').disabled = false; $('liveStart').textContent = 'Start with camera';
  $('liveStop').hidden = true;
  if (cancelled) { $('livePrompt').hidden = true; $('liveSteps').innerHTML = ''; }
}

$('liveStart').addEventListener('click', startLive);
$('liveStop').addEventListener('click', () => stopLive(true));

// Simulated sessions: prepared measurements sent to the same scoring engine.
const SIM = {
  genuine: {
    challenges: [{ id: 'TURN_HEAD', passed: true, reactionMs: 2100 }, { id: 'BLINK_TWICE', passed: true, reactionMs: 1500 }, { id: 'SMILE', passed: true, reactionMs: 1100 }],
    features: { observedSeconds: 24, yawRangeDeg: 58, blinkCount: 7, blinksPerMin: 17, contourJitter: 1.15, expressionVariance: 0.052, faceVisibleRatio: 1, profileBreak: 0.04, sharpnessRatio: 1.05, colorShift: 0.03 }, maxFaces: 1
  },
  photo: {
    challenges: [{ id: 'BLINK_TWICE', passed: false, reactionMs: null }, { id: 'SMILE', passed: false, reactionMs: null }, { id: 'TURN_HEAD', passed: false, reactionMs: null }],
    features: { observedSeconds: 22, yawRangeDeg: 2, blinkCount: 0, contourJitter: 1.0, expressionVariance: 0.001, faceVisibleRatio: 1 }, maxFaces: 1
  },
  swap: {
    challenges: [{ id: 'TURN_HEAD', passed: true, reactionMs: 1900 }, { id: 'SMILE', passed: true, reactionMs: 1300 }, { id: 'OPEN_MOUTH', passed: true, reactionMs: 1600 }],
    features: { observedSeconds: 24, yawRangeDeg: 50, blinkCount: 1, blinksPerMin: 3, contourJitter: 3.3, expressionVariance: 0.03, faceVisibleRatio: 0.8, profileBreak: 0.82, sharpnessRatio: 0.3, colorShift: 0.19 }, maxFaces: 1
  },
  replay: {
    challenges: [{ id: 'SMILE', passed: true, reactionMs: 140 }, { id: 'TURN_HEAD', passed: false, reactionMs: null }, { id: 'OPEN_MOUTH', passed: false, reactionMs: null }],
    features: { observedSeconds: 22, yawRangeDeg: 30, blinkCount: 5, contourJitter: 1.2, expressionVariance: 0.04, faceVisibleRatio: 1 }, maxFaces: 1
  }
};
document.querySelectorAll('[data-sim]').forEach((b) => b.addEventListener('click', () => {
  const p = SIM[b.dataset.sim];
  $('liveStage').dataset.level = 'IDLE';
  $('liveIdle').hidden = false;
  $('liveIdle').firstElementChild.textContent = `Simulated session: ${b.textContent}. No camera used.`;
  live = { challenges: p.challenges.map((c) => c.id), results: p.challenges, idx: 99 };
  liveSteps(); live = null;
  submitLive(p);
}));

/* ==========================================================================
   3. Voice-clone check
   ========================================================================== */

const VOICE_SAMPLES = [
  ['Real human voice', 'samples/audio/human_clean_16k.wav'],
  ['Real human on a phone line', 'samples/audio/human_phone_8k.wav'],
  ['Neural TTS voice (female)', 'samples/audio/kokoro_female_24k.wav'],
  ['Neural TTS voice (male)', 'samples/audio/kokoro_male_24k.wav'],
  ['Neural TTS on a phone line', 'samples/audio/kokoro_female_phone_8k.wav'],
  ['Classic TTS (espeak)', 'samples/audio/espeak_male_22k.wav']
];
VOICE_SAMPLES.forEach(([label, url]) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'example'; b.textContent = label;
  b.addEventListener('click', async () => {
    try { analyseAudio(await (await fetch(url)).arrayBuffer()); }
    catch (e) { VS.toast('Could not load the sample.', 'danger'); }
  });
  $('voiceSamples').appendChild(b);
});

function voiceState(name) {
  $('voiceEmpty').hidden = name !== 'empty';
  $('voiceLoading').hidden = name !== 'loading';
  $('voiceResult').hidden = name !== 'result';
}

/** Read a WAV file at its own sample rate (decodeAudioData would resample it to the device rate,
    which changes the very features we measure). Returns null if it is not plain PCM/float WAV. */
function decodeWav(ab) {
  const v = new DataView(ab);
  if (v.byteLength < 44 || v.getUint32(0) !== 0x52494646 || v.getUint32(8) !== 0x57415645) return null;
  let o = 12, fmt = null;
  while (o + 8 <= v.byteLength) {
    const id = v.getUint32(o), size = v.getUint32(o + 4, true);
    if (id === 0x666d7420) fmt = { tag: v.getUint16(o + 8, true), ch: v.getUint16(o + 10, true), sr: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === 0x64617461 && fmt) {
      const bytes = fmt.bits / 8, n = Math.floor(Math.min(size, v.byteLength - o - 8) / bytes / fmt.ch);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.ch; c++) {
          const p = o + 8 + (i * fmt.ch + c) * bytes;
          if (fmt.tag === 3 && fmt.bits === 32) sum += v.getFloat32(p, true);
          else if (fmt.bits === 16) sum += v.getInt16(p, true) / 32768;
          else return null;
        }
        out[i] = sum / fmt.ch;
      }
      return { samples: out, sampleRate: fmt.sr };
    }
    o += 8 + size + (size & 1);
  }
  return null;
}

async function analyseAudio(arrayBuffer) {
  voiceState('loading');
  try {
    let decoded = decodeWav(arrayBuffer);
    if (!decoded) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const mono = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < buf.length; i++) mono[i] += ch[i] / buf.numberOfChannels; }
      ctx.close();
      decoded = { samples: mono, sampleRate: buf.sampleRate };
    }
    await new Promise((r) => setTimeout(r, 30)); // let the spinner paint before the heavy loop
    const features = window.VoiceFeatures.extract(decoded.samples, decoded.sampleRate);
    const r = await VS.api('/kyc/voice', { method: 'POST', body: { features } });
    verdictBlock('voice', r);
    VS.setGauge($('gaugeVoice'), r.score, r.verdict === 'TOO_SHORT' ? 'safe' : VS.scoreTone(r.score), 'Synthetic-voice risk');
    if (r.verdict === 'TOO_SHORT') $('gaugeVoice').dataset.tone = 'idle';
    $('voiceNotes').textContent = (r.notes || []).join(' ');
    rows($('voiceSignals'), (r.signals || []).slice(0, 6).map((s) => ({ label: s.label, tone: s.status === 'safe' ? 'safe' : s.status, pct: s.score, detail: s.detail })));
    list($('voiceAdvice'), r.advice);
    voiceState('result');
  } catch (e) {
    VS.toast(e.message || 'Could not read this audio file.', 'danger');
    voiceState('empty');
  }
}

$('voiceFileBtn').addEventListener('click', () => $('voiceFile').click());
$('voiceFile').addEventListener('change', async () => {
  const f = $('voiceFile').files[0];
  if (f) analyseAudio(await f.arrayBuffer());
});

let rec = null;
$('recBtn').addEventListener('click', async () => {
  if (rec) { rec.recorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      clearInterval(rec.timer);
      stream.getTracks().forEach((t) => t.stop());
      rec = null;
      $('recBtn').textContent = 'Record up to 10 s';
      $('recHint').textContent = 'Speak or play the call audio near the microphone. Aim for at least 3 seconds of clear speech.';
      analyseAudio(await new Blob(chunks).arrayBuffer());
    };
    rec = { recorder, started: Date.now() };
    recorder.start();
    rec.timer = setInterval(() => {
      const s = Math.floor((Date.now() - rec.started) / 1000);
      $('recBtn').textContent = `Stop (${s}s)`;
      $('recHint').textContent = 'Recording… press Stop when you have a few seconds of clear speech.';
      if (s >= 10) recorder.stop();
    }, 250);
  } catch (e) {
    VS.toast(e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Could not start recording.', 'danger');
  }
});

window.addEventListener('pagehide', () => { if (live) stopLive(true); });
window.__kyc = { SIM };
