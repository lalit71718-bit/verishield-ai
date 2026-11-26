"""Adds word-style synthetic clips that match the human word clips (4 short words joined),
so the voice model is trained and tested on like-for-like material.

Half of the synthetic clips get background noise added (15-35 dB SNR), so the model cannot
win simply by noticing that generated audio is noiseless.

Usage: python3 build_voice_words.py <out_dir> <kokoro_dir>
"""
import os, sys, random, subprocess, tempfile
import numpy as np, soundfile as sf
from scipy.signal import resample_poly, butter, lfilter

out, kk = sys.argv[1:3]
rng = np.random.default_rng(5); random.seed(5)
WORDS = ['yes', 'no', 'up', 'down', 'go', 'stop', 'left', 'right']

def norm(x): return (x / max(1e-6, np.max(np.abs(x))) * 0.8).astype(np.float32)

def noisy(x):
    snr = rng.uniform(15, 35)
    n = lfilter([1], [1, -0.9], rng.normal(0, 1, len(x)))          # coloured noise
    n = n / (np.std(n) + 1e-9) * np.std(x) / (10 ** (snr / 20))
    return x + n

def phone(x, sr):
    y = resample_poly(x, 8000, sr) if sr != 8000 else x
    b, a = butter(4, [300 / 4000, 3400 / 4000], btype='band'); y = lfilter(b, a, y)
    y = y / max(1e-6, np.max(np.abs(y))); mu = 255
    y = np.sign(y) * np.log1p(mu * np.abs(y)) / np.log1p(mu); y = np.round(y * 127) / 127
    y = np.sign(y) * (1 / mu) * ((1 + mu) ** np.abs(y) - 1)
    return norm(y + rng.normal(0, rng.uniform(0.002, 0.008), len(y))), 8000

def put(name, x, sr):
    x = np.asarray(x, dtype=np.float64)
    if random.random() < 0.5: x = noisy(x)
    sf.write(os.path.join(out, 'synthetic', name + '.wav'), norm(x), sr, subtype='PCM_16')
    p, psr = phone(x, sr)
    sf.write(os.path.join(out, 'synthetic', name + '__phone.wav'), p, psr, subtype='PCM_16')

from kokoro_onnx import Kokoro
k = Kokoro(os.path.join(kk, 'kokoro.onnx'), os.path.join(kk, 'voices.bin'))
for v in [v for v in k.get_voices() if v[:2] in ('af', 'am', 'bf', 'bm')]:
    cache = {}
    for w in WORDS:
        s, sr = k.create(w, voice=v, speed=1.0, lang='en-gb' if v[0] == 'b' else 'en-us')
        cache[w] = np.asarray(s)
    for j in range(3):
        words = random.sample(WORDS, 4)
        put(f'wkokoro_{v}_{j}', np.concatenate([cache[w] for w in words]), sr)

n = 0
for voice in ['en-us', 'en-gb', 'en-us+m1', 'en-us+m3', 'en-us+m5', 'en-us+f1', 'en-us+f3', 'en-us+f5', 'en-gb+m2', 'en-gb+f2']:
    for j in range(3):
        parts = []
        for w in random.sample(WORDS, 4):
            wav = tempfile.mktemp(suffix='.wav')
            subprocess.run(['espeak-ng', '-v', voice, '-s', str(random.choice([130, 160])), '-w', wav, w], check=True)
            d, sr = sf.read(wav); parts.append(d); os.remove(wav)
        put(f'wespeak_{n}', np.concatenate(parts), sr); n += 1
print(len(os.listdir(os.path.join(out, 'synthetic'))), 'synthetic files')
