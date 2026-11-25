"""Builds the voice test set.

 genuine (human)   real recorded speech from Google's MediaPipe test assets (Apache-2.0)
                   + the same recording degraded the way a phone call degrades it
 synthetic         espeak-ng (classic formant TTS) and Kokoro-82M (neural TTS)
                   + one synthetic clip pushed through the same phone degradation

Needs: numpy scipy soundfile kokoro-onnx onnxruntime, the espeak-ng binary, and the Kokoro
model files (kokoro-v1.0.int8.onnx, voices-v1.0.bin). Pass their folder as argv[1].
"""
import os, sys, subprocess, urllib.request
import numpy as np, soundfile as sf
from scipy.signal import resample_poly, butter, lfilter

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/kk'
OUT = os.path.join(os.path.dirname(__file__), 'fixtures', 'audio')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

def save(name, x, sr):
    x = np.asarray(x, dtype=np.float32)
    x = x / max(1e-6, np.max(np.abs(x))) * 0.8
    sf.write(os.path.join(OUT, name), x, sr, subtype='PCM_16')

def phone(x, sr):
    """Narrow-band telephone: 300-3400 Hz, 8 kHz, mu-law style compression, line noise."""
    y = resample_poly(x, 8000, sr) if sr != 8000 else x
    b, a = butter(4, [300 / 4000, 3400 / 4000], btype='band')
    y = lfilter(b, a, y)
    y = y / max(1e-6, np.max(np.abs(y)))
    mu = 255
    y = np.sign(y) * np.log1p(mu * np.abs(y)) / np.log1p(mu)
    y = np.round(y * 127) / 127
    y = np.sign(y) * (1 / mu) * ((1 + mu) ** np.abs(y) - 1)
    return y + rng.normal(0, 0.004, len(y)), 8000

# ---- genuine human ----
human, sr = sf.read(os.path.join(SRC, 'speech_16000_hz_mono.wav'))
save('human_clean_16k.wav', human, sr)
h48, sr48 = sf.read(os.path.join(SRC, 'speech_48000_hz_mono.wav'))
save('human_clean_48k.wav', h48, sr48)
p, psr = phone(human, sr); save('human_phone_8k.wav', p, psr)

# ---- synthetic: espeak-ng ----
for name, voice in [('espeak_male', 'en-us'), ('espeak_female', 'en-us+f3')]:
    wav = os.path.join(OUT, f'{name}_22k.wav')
    subprocess.run(['espeak-ng', '-v', voice, '-s', '150', '-w', wav,
                    'Hello, this is your bank. Please share the one time password to verify your account today.'], check=True)

# ---- synthetic: Kokoro neural TTS ----
from kokoro_onnx import Kokoro
k = Kokoro(os.path.join(SRC, 'kokoro.onnx'), os.path.join(SRC, 'voices.bin'))
line = "Hi mom, it's me. I'm in trouble and my phone is broken. Please send twenty thousand rupees to this number right now."
for name, voice in [('kokoro_female', 'af_heart'), ('kokoro_male', 'am_adam'), ('kokoro_british', 'bf_emma')]:
    s, ksr = k.create(line, voice=voice, speed=1.0, lang='en-us')
    save(f'{name}_24k.wav', s, ksr)
    if name == 'kokoro_female':
        p, psr = phone(np.asarray(s), ksr); save('kokoro_female_phone_8k.wav', p, psr)

for f in sorted(os.listdir(OUT)):
    d, r = sf.read(os.path.join(OUT, f)); print(f'  {f:32} {len(d)/r:5.1f}s {r} Hz')
