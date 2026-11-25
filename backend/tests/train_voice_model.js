/**
 * Trains the small logistic-regression voice model used by services/voiceForensics.js.
 *
 *   node tests/train_voice_model.js <dataset_dir>
 *
 * <dataset_dir>/human/*.wav and <dataset_dir>/synthetic/*.wav (built by build_voice_dataset.py).
 * Clips are split into train and held-out test by clip, so a clean clip and its telephone
 * copy are always on the same side. Writes services/voiceModel.json and tests/results/voice_holdout.json.
 */
const fs = require('fs');
const path = require('path');
const VF = require('../../frontend/voicefeatures.js');

const dir = process.argv[2];
if (!dir) { console.error('usage: node tests/train_voice_model.js <dataset_dir>'); process.exit(1); }

function readWav(p) {
  const b = fs.readFileSync(p);
  const sr = b.readUInt32LE(24);
  let o = 12;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'data') {
      const n = Math.floor(sz / 2), f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = b.readInt16LE(o + 8 + i * 2) / 32768;
      return { samples: f, sr };
    }
    o += 8 + sz + (sz & 1);
  }
  throw new Error('no data chunk in ' + p);
}

// The transforms live in the service so training and scoring can never drift apart.
const { TRANSFORMS: FEATURES } = require('../services/voiceForensics');
const NAMES = Object.keys(FEATURES);

// Stable pseudo-random split by clip name (about 30% held out).
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

const rows = [];
for (const label of ['human', 'synthetic']) {
  for (const file of fs.readdirSync(path.join(dir, label)).filter((f) => f.endsWith('.wav')).sort()) {
    const { samples, sr } = readWav(path.join(dir, label, file));
    const f = VF.extract(samples, sr);
    if (f.speechSeconds < 1.5) continue;
    const clipName = file.replace(/__phone|__aug\d+/g, '').replace('.wav', '');
    const group = clipName.startsWith('spk_') ? 'human words' : clipName.startsWith('sent_') ? 'human sentences'
      : clipName.startsWith('wkokoro') ? 'Kokoro words' : clipName.startsWith('wespeak') ? 'espeak words'
      : clipName.startsWith('kokoro') ? 'Kokoro sentences' : 'espeak sentences';
    // Split by base clip, so a clip and all its phone/augmented copies stay on the same side.
    // Sentence-style human recordings are scarce, so half of them are held out; word clips: 30%.
    const sentence = group.endsWith('sentences');
    const frac = group === 'human sentences' ? 0.5 : 0.3;
    rows.push({ file, label, group, sentence, y: label === 'synthetic' ? 1 : 0, phone: file.includes('__phone'), clip: `${label}/${clipName}`, f, aug: file.includes('__aug'), test: hash(`${label}/${clipName}`) < frac });
  }
}
console.log(`clips: ${rows.length}  (human ${rows.filter((r) => r.y === 0).length}, synthetic ${rows.filter((r) => r.y === 1).length})`);

const vec = (r) => NAMES.map((n) => FEATURES[n](r.f));
const train = rows.filter((r) => !r.test), test = rows.filter((r) => r.test);

// Standardise on the training set; missing values become the training mean.
const cols = NAMES.map((_, j) => train.map((r) => vec(r)[j]).filter((v) => v !== null));
const mean = cols.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
const std = cols.map((c, j) => Math.sqrt(c.reduce((a, b) => a + (b - mean[j]) ** 2, 0) / c.length) || 1);
const norm = (r) => vec(r).map((v, j) => (v === null ? 0 : (v - mean[j]) / std[j]));

// Class-balanced L2 logistic regression by gradient descent.
const X = train.map(norm), Y = train.map((r) => r.y);
const pos = Y.filter((y) => y === 1).length, neg = Y.length - pos;
const wPos = Y.length / (2 * pos), wNeg = Y.length / (2 * neg);
let w = new Array(NAMES.length).fill(0), b = 0;
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const LAMBDA = 0.3;
for (let it = 0; it < 4000; it++) {
  const gw = new Array(w.length).fill(0); let gb = 0;
  X.forEach((x, i) => {
    const p = sigmoid(x.reduce((a, v, j) => a + v * w[j], b));
    const e = (p - Y[i]) * (Y[i] ? wPos : wNeg);
    x.forEach((v, j) => { gw[j] += e * v; }); gb += e;
  });
  w = w.map((wj, j) => wj - 0.1 * (gw[j] / X.length + LAMBDA * wj));
  b -= 0.1 * gb / X.length;
}
const predict = (r) => sigmoid(norm(r).reduce((a, v, j) => a + v * w[j], b));

// Operating points are chosen on TRAINING humans only: we want few false accusations.
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const trainHumanProbs = train.filter((r) => r.y === 0).map(predict);
const T_LOW = +q(trainHumanProbs, 0.90).toFixed(3);    // "be careful" at about 10% false alarms on training humans
const T_HIGH = +q(trainHumanProbs, 0.97).toFixed(3);   // "synthetic traits found" at about 3%

function auc(set) {
  const pos = set.filter((r) => r.y === 1).map(predict), neg = set.filter((r) => r.y === 0).map(predict);
  let wins = 0;
  pos.forEach((p) => neg.forEach((n) => { wins += p > n ? 1 : p === n ? 0.5 : 0; }));
  return +(wins / (pos.length * neg.length || 1)).toFixed(3);
}
function metrics(set, T = T_HIGH) {
  const P = set.filter((r) => r.y === 1), N = set.filter((r) => r.y === 0);
  const caught = P.filter((r) => predict(r) >= T).length, falseAlarm = N.filter((r) => predict(r) >= T).length;
  return { n: set.length, auc: auc(set), syntheticCaught: `${caught}/${P.length}`, recall: P.length ? +(caught / P.length).toFixed(3) : null, humanFalseAlarms: `${falseAlarm}/${N.length}`, falseAlarmRate: N.length ? +(falseAlarm / N.length).toFixed(3) : null };
}
const out = {
  thresholds: { low: T_LOW, high: T_HIGH },
  train: metrics(train), holdout: metrics(test),
  holdoutClean: metrics(test.filter((r) => !r.phone && !r.aug)), holdoutPhone: metrics(test.filter((r) => r.phone)), holdoutAugmented: metrics(test.filter((r) => r.aug)),
  holdoutByGroup: Object.fromEntries([...new Set(test.map((r) => r.group))].map((g) => [g, metrics(test.filter((r) => r.group === g))]))
};
console.log(JSON.stringify(out, null, 1));

const model = {
  version: 1,
  note: 'Logistic regression on voice features. Trained on a small public sample set; see docs/KYC_TEST_REPORT.md for limits.',
  features: NAMES, mean, std, weights: w, bias: b, thresholds: { low: T_LOW, high: T_HIGH },
  trainedOn: { clips: train.length, human: train.filter((r) => r.y === 0).length, synthetic: train.filter((r) => r.y === 1).length },
  metrics: out
};
fs.writeFileSync(path.join(__dirname, '../services/voiceModel.json'), JSON.stringify(model, null, 1));
fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'results/voice_holdout.json'), JSON.stringify(test.map((r) => ({ file: r.file, label: r.label, group: r.group, phone: r.phone, aug: r.aug, probSynthetic: +predict(r).toFixed(3), features: r.f })), null, 1));
console.log('weights:', NAMES.map((n, j) => `${n}=${w[j].toFixed(2)}`).join('  '));
