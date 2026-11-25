"""Gives every clip, human and synthetic alike, a few random recording conditions
(room reverb, background noise, band-limiting, different sample rates, codec-like quantising).

Why: without this the model can cheat by learning "noisy crowd-sourced microphone = human,
clean studio audio = synthetic". Applying the same random conditions to BOTH classes forces
it to look at the voice itself.

Usage: python3 augment_voice_dataset.py <in_dir> <out_dir> [copies=2]
"""
import os, sys, random
import numpy as np, soundfile as sf
from scipy.signal import resample_poly, butter, lfilter, fftconvolve
from math import gcd

src, dst = sys.argv[1:3]
copies = int(sys.argv[3]) if len(sys.argv) > 3 else 2
rng = np.random.default_rng(21); random.seed(21)

def norm(x): return (x / max(1e-6, np.max(np.abs(x))) * 0.8).astype(np.float32)

def condition(x, sr):
    # reverb
    if random.random() < 0.6:
        rt = random.uniform(0.08, 0.5)
        n = int(sr * rt)
        ir = rng.normal(0, 1, n) * np.exp(-np.linspace(0, 6.9, n)); ir[0] = 1.0
        x = fftconvolve(x, ir / np.sqrt(np.sum(ir ** 2)))[: len(x)]
    # band-limit
    cut = random.choice([3400, 4500, 6000, None])
    if cut and cut < sr / 2 - 100:
        b, a = butter(4, cut / (sr / 2)); x = lfilter(b, a, x)
    # resample
    new = random.choice([8000, 11025, 16000, 22050, None])
    if new and new != sr:
        g = gcd(new, sr); x = resample_poly(x, new // g, sr // g); sr = new
    # noise
    if random.random() < 0.8:
        snr = random.uniform(8, 40)
        color = random.choice([0.0, 0.9, -0.5])
        n = lfilter([1], [1, -color], rng.normal(0, 1, len(x))) if color else rng.normal(0, 1, len(x))
        x = x + n / (np.std(n) + 1e-9) * np.std(x) / (10 ** (snr / 20))
    # codec-like quantising
    if random.random() < 0.3:
        x = x / max(1e-6, np.max(np.abs(x))); mu = 255
        y = np.sign(x) * np.log1p(mu * np.abs(x)) / np.log1p(mu); y = np.round(y * 63) / 63
        x = np.sign(y) * (1 / mu) * ((1 + mu) ** np.abs(y) - 1)
    return norm(x), sr

count = 0
for label in ('human', 'synthetic'):
    os.makedirs(os.path.join(dst, label), exist_ok=True)
    for f in sorted(os.listdir(os.path.join(src, label))):
        d, sr = sf.read(os.path.join(src, label, f))
        if d.ndim > 1: d = d[:, 0]
        sf.write(os.path.join(dst, label, f), d.astype(np.float32), sr, subtype='PCM_16')
        if '__phone' in f: continue          # phone copies are already a recording condition
        base = f[:-4]
        for k in range(copies):
            y, ysr = condition(d.astype(np.float64), sr)
            sf.write(os.path.join(dst, label, f'{base}__aug{k}.wav'), y, ysr, subtype='PCM_16'); count += 1
print('augmented files:', count)
