"""Builds the voice-model dataset (not committed: ~hundreds of small wav files).

 human      speakers from Google's mini_speech_commands (4 words joined, ~4 s), plus two
            longer recordings (MediaPipe test speech, a public-domain JFK recording)
 synthetic  Kokoro-82M neural TTS (many voices, speeds) + espeak-ng (many voices)
 each clip also gets a narrow-band telephone copy so the model sees phone audio for both classes

Usage: python3 build_voice_dataset.py <out_dir> <kokoro_dir> <msc_dir> <extra_dir> [human-only]
  <extra_dir> holds sentence-level human recordings (*.wav, *.flac) such as the SpeechBrain, TIMIT and JFK samples.
"""
import os, sys, glob, random, subprocess, collections
import numpy as np, soundfile as sf
from scipy.signal import resample_poly, butter, lfilter

out, kk, msc, extra = sys.argv[1:5]
human_only = len(sys.argv) > 5 and sys.argv[5] == 'human-only'
rng = np.random.default_rng(11); random.seed(11)
for d in ('human', 'synthetic'): os.makedirs(os.path.join(out, d), exist_ok=True)

def norm(x): return (x / max(1e-6, np.max(np.abs(x))) * 0.8).astype(np.float32)

def phone(x, sr):
    y = resample_poly(x, 8000, sr) if sr != 8000 else x
    b, a = butter(4, [300 / 4000, 3400 / 4000], btype='band'); y = lfilter(b, a, y)
    y = y / max(1e-6, np.max(np.abs(y))); mu = 255
    y = np.sign(y) * np.log1p(mu * np.abs(y)) / np.log1p(mu); y = np.round(y * 127) / 127
    y = np.sign(y) * (1 / mu) * ((1 + mu) ** np.abs(y) - 1)
    return norm(y + rng.normal(0, rng.uniform(0.002, 0.008), len(y))), 8000

def put(kind, name, x, sr):
    sf.write(os.path.join(out, kind, name + '.wav'), norm(np.asarray(x)), sr, subtype='PCM_16')
    p, psr = phone(np.asarray(x, dtype=np.float64), sr)
    sf.write(os.path.join(out, kind, name + '__phone.wav'), p, psr, subtype='PCM_16')

# ---- human ----
by_spk = collections.defaultdict(dict)
for w in os.listdir(msc):
    if not os.path.isdir(os.path.join(msc, w)): continue
    for f in glob.glob(os.path.join(msc, w, '*.wav')):
        by_spk[os.path.basename(f).split('_')[0]].setdefault(w, f)
speakers = [s for s, d in by_spk.items() if len(d) >= 4]
random.shuffle(speakers)
for s in speakers[:150]:
    words = random.sample(sorted(by_spk[s]), 4)
    parts = []
    for w in words:
        d, sr = sf.read(by_spk[s][w]); parts.append(d)   # clips already carry their own recorded background; no inserted silence
    put('human', f'spk_{s}', np.concatenate(parts), 16000)
for f in sorted(glob.glob(os.path.join(extra, '*.wav')) + glob.glob(os.path.join(extra, '*.flac'))):
    if os.path.getsize(f) < 1000: continue
    d, sr = sf.read(f)
    if d.ndim > 1: d = d[:, 0]
    put('human', 'sent_' + os.path.splitext(os.path.basename(f))[0], d[: sr * 12], sr)

if human_only:
    print({k: len(os.listdir(os.path.join(out, k))) for k in ('human', 'synthetic')}); sys.exit(0)

# ---- synthetic: Kokoro ----
from kokoro_onnx import Kokoro
k = Kokoro(os.path.join(kk, 'kokoro.onnx'), os.path.join(kk, 'voices.bin'))
voices = [v for v in k.get_voices() if v[:2] in ('af', 'am', 'bf', 'bm')]
texts = ['Yes. No. Up. Down. Go. Stop.', 'Please send the money now, I am in trouble.', 'This is your bank. Verify your account today.']
for v in voices:
    for ti, t in enumerate(texts[:2]):
        s, sr = k.create(t, voice=v, speed=random.choice([0.95, 1.0, 1.05]), lang='en-gb' if v[0] == 'b' else 'en-us')
        put('synthetic', f'kokoro_{v}_{ti}', s, sr)

# ---- synthetic: espeak-ng ----
n = 0
for voice in ['en-us', 'en-gb', 'en-us+m1', 'en-us+m3', 'en-us+m5', 'en-us+f1', 'en-us+f3', 'en-us+f5', 'en-gb+m2', 'en-gb+f2']:
    for sp in (140, 170):
        wav = os.path.join(out, 'synthetic', f'espeak_{n}.wav')
        subprocess.run(['espeak-ng', '-v', voice, '-s', str(sp), '-w', wav, texts[n % 3]], check=True)
        d, sr = sf.read(wav); put('synthetic', f'espeak_{n}', d, sr); n += 1
print({k: len(os.listdir(os.path.join(out, k))) for k in ('human', 'synthetic')})
