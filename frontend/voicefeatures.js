/* VeriShield AI — voice forensics feature extractor.
   Pure JavaScript with no DOM or Node dependencies, so the browser (voice check page)
   and the Node test runner use exactly the same code.
   Input: mono samples (Float32Array, -1..1) and the sample rate.
   Output: a small object of numbers describing how "natural" the recording is.
   These are heuristics for synthetic or cloned speech, not a trained classifier. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoiceFeatures = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
  const percentile = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

  /** In-place radix-2 FFT. */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  function extract(samples, sampleRate) {
    // Use at most 30 seconds.
    const x = samples.length > sampleRate * 30 ? samples.subarray(0, sampleRate * 30) : samples;
    const sr = sampleRate;
    const duration = x.length / sr;

    // Frame energies (25 ms window, 10 ms hop).
    const win = Math.round(sr * 0.025), hop = Math.round(sr * 0.01);
    const rms = [];
    for (let s = 0; s + win <= x.length; s += hop) {
      let e = 0;
      for (let i = 0; i < win; i++) e += x[s + i] * x[s + i];
      rms.push(Math.sqrt(e / win));
    }
    const rmsDb = rms.map(db);
    const peakDb = percentile(rmsDb, 0.98);
    const speechThresh = peakDb - 25;
    const speechIdx = rmsDb.map((v, i) => (v > speechThresh ? i : -1)).filter((i) => i >= 0);

    // Noise floor and digital silence between words.
    const quiet = rmsDb.filter((v) => v <= speechThresh);
    const noiseFloorDb = quiet.length >= 5 ? mean(quiet.slice().sort((a, b) => a - b).slice(0, Math.max(3, Math.floor(quiet.length * 0.3)))) : null;
    const digitalSilence = rmsDb.filter((v) => v < -80).length / Math.max(1, rmsDb.length);

    // Dynamic variation of the speech envelope.
    const speechDb = speechIdx.map((i) => rmsDb[i]);
    const envelopeStd = std(speechDb);

    // Average power spectrum of speech frames -> bandwidth and HF content.
    const N = 1024;
    const power = new Float64Array(N / 2);
    let used = 0;
    const hann = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    const step = Math.max(1, Math.floor(speechIdx.length / 200));
    for (let k = 0; k < speechIdx.length; k += step) {
      const s = speechIdx[k] * hop;
      if (s + N > x.length) continue;
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = x[s + i] * hann[i];
      fft(re, im);
      for (let i = 0; i < N / 2; i++) power[i] += re[i] * re[i] + im[i] * im[i];
      used++;
    }
    let bandwidthHz = null, hfShare = null, flatness = null;
    if (used) {
      const total = power.reduce((a, b) => a + b, 0) || 1;
      let cum = 0;
      for (let i = 0; i < N / 2; i++) { cum += power[i]; if (cum / total >= 0.995) { bandwidthHz = Math.round(i * sr / N); break; } }
      let hf = 0;
      for (let i = Math.floor(4000 * N / sr); i < N / 2; i++) hf += power[i];
      hfShare = hf / total;
      const lo = Math.floor(100 * N / sr), hi = Math.min(N / 2, Math.floor(8000 * N / sr));
      const slice = Array.from(power.slice(lo, hi)).map((v) => v + 1e-12);
      flatness = Math.exp(mean(slice.map(Math.log))) / mean(slice);
    }

    // Pitch track by autocorrelation on 40 ms windows.
    const pw = Math.round(sr * 0.04);
    const minLag = Math.floor(sr / 400), maxLag = Math.min(pw - 1, Math.floor(sr / 70));
    const f0 = [];      // Hz per voiced frame, or null
    const hnr = [];
    const amp = [];
    for (let s = 0; s + pw + maxLag <= x.length; s += hop) {
      let e0 = 0;
      for (let i = 0; i < pw; i++) e0 += x[s + i] * x[s + i];
      if (db(Math.sqrt(e0 / pw)) < speechThresh) { f0.push(null); continue; }
      let best = 0, bestLag = 0;
      const ac = new Float64Array(maxLag + 2);
      for (let lag = minLag; lag <= maxLag + 1; lag++) {
        let c = 0, e1 = 0;
        for (let i = 0; i < pw; i++) { c += x[s + i] * x[s + i + lag]; e1 += x[s + i + lag] * x[s + i + lag]; }
        ac[lag] = c / Math.sqrt(e0 * e1 + 1e-12);
        if (lag <= maxLag && ac[lag] > best) { best = ac[lag]; bestLag = lag; }
      }
      if (best < 0.6 || bestLag <= minLag || bestLag >= maxLag) { f0.push(null); continue; }
      const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
      f0.push(sr / (bestLag + shift));
      hnr.push(10 * Math.log10(best / Math.max(1e-6, 1 - best)));
      amp.push(Math.sqrt(e0 / pw));
    }
    const voiced = f0.filter((v) => v !== null);
    const voicedRatio = voiced.length / Math.max(1, f0.length);

    // Pitch micro-irregularity: change between neighbouring voiced frames, in cents.
    const cents = [];
    for (let i = 1; i < f0.length; i++) if (f0[i] !== null && f0[i - 1] !== null) cents.push(Math.abs(1200 * Math.log2(f0[i] / f0[i - 1])));
    const accel = [];
    for (let i = 2; i < f0.length; i++) if (f0[i] !== null && f0[i - 1] !== null && f0[i - 2] !== null) accel.push(Math.abs(1200 * (Math.log2(f0[i]) - 2 * Math.log2(f0[i - 1]) + Math.log2(f0[i - 2]))));
    const shimmer = [];
    for (let i = 1; i < amp.length; i++) shimmer.push(Math.abs(amp[i] - amp[i - 1]) / ((amp[i] + amp[i - 1]) / 2));
    const f0Cents = voiced.map((v) => 1200 * Math.log2(v / median(voiced)));

    // Linear-frequency cepstral coefficients (LFCC): the spectral fingerprint where vocoders leave traces.
    const NB = 20, NC = 12, fmax = Math.min(8000, sr / 2 - 50);
    const fb = [];
    for (let b = 0; b < NB; b++) {
      const lo = Math.floor((b * fmax / NB) * N / sr), hi = Math.max(lo + 1, Math.floor(((b + 1) * fmax / NB) * N / sr));
      fb.push([lo, hi]);
    }
    const cepFrames = [];
    const lstep = Math.max(1, Math.floor(speechIdx.length / 250));
    for (let k = 0; k < speechIdx.length; k += lstep) {
      const s0 = speechIdx[k] * hop;
      if (s0 + N > x.length) continue;
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = x[s0 + i] * hann[i];
      fft(re, im);
      const logE = fb.map(([lo, hi]) => { let e = 0; for (let i = lo; i < hi; i++) e += re[i] * re[i] + im[i] * im[i]; return Math.log(e / (hi - lo) + 1e-10); });
      const c = [];
      for (let q = 1; q <= NC; q++) { let a = 0; for (let b = 0; b < NB; b++) a += logE[b] * Math.cos(Math.PI * q * (b + 0.5) / NB); c.push(a / NB); }
      cepFrames.push(c);
    }
    const lfccMean = [], lfccStd = [];
    for (let q = 0; q < NC; q++) { const col = cepFrames.map((c) => c[q]); lfccMean.push(col.length ? Math.round(mean(col) * 1000) / 1000 : null); lfccStd.push(col.length ? Math.round(std(col) * 1000) / 1000 : null); }

    // Pauses: gaps between speech runs.
    const pauses = [];
    let run = 0;
    for (let i = 0; i < rmsDb.length; i++) {
      if (rmsDb[i] <= speechThresh) run++; else { if (run * 0.01 > 0.12) pauses.push(run * 0.01); run = 0; }
    }

    return {
      sampleRate: sr,
      durationSec: Math.round(duration * 100) / 100,
      speechSeconds: Math.round(speechIdx.length * 0.01 * 100) / 100,
      noiseFloorDb: noiseFloorDb === null ? null : Math.round(noiseFloorDb * 10) / 10,
      digitalSilence: Math.round(digitalSilence * 1000) / 1000,
      bandwidthHz,
      hfShare: hfShare === null ? null : Math.round(hfShare * 10000) / 10000,
      flatness: flatness === null ? null : Math.round(flatness * 10000) / 10000,
      envelopeStdDb: Math.round(envelopeStd * 10) / 10,
      voicedRatio: Math.round(voicedRatio * 1000) / 1000,
      f0MedianHz: voiced.length ? Math.round(median(voiced)) : null,
      f0SpreadCents: voiced.length ? Math.round(std(f0Cents)) : null,
      pitchStepCents: cents.length ? Math.round(median(cents) * 10) / 10 : null,
      pitchAccelCents: accel.length ? Math.round(median(accel) * 10) / 10 : null,
      shimmer: shimmer.length ? Math.round(median(shimmer) * 1000) / 1000 : null,
      hnrDb: hnr.length ? Math.round(mean(hnr) * 10) / 10 : null,
      lfccMean,
      lfccStd,
      pauseCount: pauses.length,
      pauseCv: pauses.length >= 3 ? Math.round(std(pauses) / mean(pauses) * 100) / 100 : null
    };
  }

  return { extract };
});
