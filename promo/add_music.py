"""Compose a quiet original cue and mux it into the existing promo.

Requires numpy and ffmpeg. All sounds are synthesized; no sampled recordings.
"""
from pathlib import Path
import subprocess
import wave
import numpy as np

OUT = Path(__file__).resolve().parent
SR, SECONDS = 48000, 30
audio = np.zeros((SR * SECONDS, 2), dtype=np.float64)
rng = np.random.default_rng(26)

def piano(midi, start, velocity=0.15, sustain=3.8):
    """A mellow struck-string tone with a soft attack and damped overtones."""
    length = min(int(sustain * SR), len(audio) - int(start * SR))
    if length <= 0:
        return
    t = np.arange(length) / SR
    hz = 440 * 2 ** ((midi - 69) / 12)
    signal = np.zeros(length)
    for harmonic, level in [(1, 1), (2, .23), (3, .085), (4, .025)]:
        decay = np.exp(-t * (1.05 + .55 * (harmonic - 1)))
        # A tiny detuning lends warmth without a conspicuous chorus effect.
        signal += level * decay * (
            .70 * np.sin(2*np.pi*hz*harmonic*t)
            + .30 * np.sin(2*np.pi*hz*harmonic*1.0007*t))
    signal *= (1 - np.exp(-t / .014)) * velocity
    signal *= np.clip((sustain - t) / .35, 0, 1)
    pan = np.clip((midi - 60) / 70, -.35, .35)
    stereo = signal[:, None] * np.array([np.sqrt((1-pan)/2), np.sqrt((1+pan)/2)])
    at = int(start * SR)
    audio[at:at+length] += stereo

# Eight bars at 72 BPM, followed by a natural decay. C major / A minor palette.
beat = 60 / 72
chords = [
    (48, [60, 64, 67, 71]),  # Cmaj7
    (43, [59, 62, 67, 69]),  # Gadd9
    (45, [60, 64, 67, 71]),  # Am9
    (41, [57, 60, 64, 67]),  # Fmaj9
    (48, [60, 64, 67, 71]),
    (45, [60, 64, 67, 71]),
    (41, [57, 60, 64, 67]),
    (48, [60, 64, 67, 72]),
]
melody = [(0, 76), (2, 74), (4, 71), (6, 69), (8, 72), (10, 71),
          (12, 69), (14, 67), (16, 76), (18, 79), (20, 76),
          (22, 72), (24, 69), (26, 67), (28, 72)]
for bar, (bass, chord) in enumerate(chords):
    start = .3 + bar * 4 * beat
    piano(bass, start, .15, 5)
    for step, index in enumerate([0, 2, 1, 3, 2, 1]):
        # Keep the final chord spacious, leaving time for the closing title.
        if bar == 7 and step > 2:
            break
        piano(chord[index], start + step * .5 * beat + .025,
              .085 * rng.uniform(.90, 1.06), 4)
for when, note in melody:
    piano(note, .34 + when * beat, .11, 4.5)

# Soft stereo room reflections, derived only from the synthesized notes.
dry = audio.copy()
for delay, gain in [(.113, .15), (.191, .12), (.307, .10), (.443, .075),
                    (.631, .06), (.877, .04), (1.171, .025)]:
    shift = int(delay * SR)
    audio[shift:] += dry[:-shift, ::-1] * gain
fade = np.ones(len(audio))
fade[:int(.65*SR)] = np.sin(np.linspace(0, np.pi/2, int(.65*SR)))**2
fade[-int(3*SR):] = np.cos(np.linspace(0, np.pi/2, int(3*SR)))**2
audio *= fade[:, None]
audio *= .65 / max(np.max(np.abs(audio)), 1e-9)
wav = OUT/'vivlio-original-bgm.wav'
with wave.open(str(wav), 'wb') as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(SR)
    f.writeframes((audio * 32767).astype('<i2').tobytes())

output = OUT/'vivlio-promo-ja-30s-bgm.mp4'
subprocess.run([
    'ffmpeg', '-y', '-v', 'error', '-i', str(OUT/'vivlio-promo-ja-30s.mp4'),
    '-i', str(wav), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
    '-af', 'loudnorm=I=-20:TP=-2:LRA=7', '-c:a', 'aac', '-b:a', '192k',
    '-ar', str(SR), '-t', '30', '-movflags', '+faststart', str(output)
], check=True)
print(output)
