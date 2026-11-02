#!/usr/bin/env python3
"""PD-55: generates the reward sounds in assets/sounds/.

Our own sounds, synthesised here from sine tones and seeded noise -- no
sample, no recording, nothing downloaded. They are dedicated to the public
domain under CC0 1.0 (assets/sounds/LICENSE.md). Re-run this to change them,
and commit the script and the files together; the noise is seeded, so a re-run
writes the same bytes.

    /usr/bin/python3 -I scripts/assets/make_reward_sounds.py

  reward_encouragement.wav  a star or a sticker: two bright bell notes, rising
  reward_applause.wav       a praise stamp: a short round of applause
  reward_celebration.wav    a celebration: a little fanfare, with sparkles

22.05 kHz, 16-bit mono, each under two seconds, peaks at -3 dBFS.
"""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
PEAK = 0.708  # -3 dBFS
OUT = Path(__file__).resolve().parents[2] / 'assets' / 'sounds'


def bell(t: float, freq: float, decay: float) -> float:
    """A soft bell: a sine with a little of its octave, an 8 ms attack (no click) and a decay."""
    if t < 0:
        return 0.0
    envelope = min(1.0, t / 0.008) * math.exp(-t / decay)
    return envelope * (math.sin(2 * math.pi * freq * t) + 0.25 * math.sin(4 * math.pi * freq * t))


def brass(t: float, freq: float, length: float) -> float:
    """A rounded horn-like note: a few odd and even harmonics, swelling in and easing out."""
    if t < 0 or t > length:
        return 0.0
    attack = min(1.0, t / 0.03)
    release = min(1.0, (length - t) / 0.08)
    vibrato = 1 + 0.004 * math.sin(2 * math.pi * 5.5 * t) * min(1.0, t / 0.2)
    phase = 2 * math.pi * freq * vibrato * t
    tone = math.sin(phase) + 0.45 * math.sin(2 * phase) + 0.25 * math.sin(3 * phase) + 0.1 * math.sin(4 * phase)
    return attack * release * tone


def bandpass(signal: list[float], centre: float, q: float) -> list[float]:
    """An RBJ biquad band-pass (constant peak gain)."""
    w = 2 * math.pi * centre / RATE
    alpha = math.sin(w) / (2 * q)
    b0, b1, b2 = alpha, 0.0, -alpha
    a0, a1, a2 = 1 + alpha, -2 * math.cos(w), 1 - alpha
    out, x1, x2, y1, y2 = [], 0.0, 0.0, 0.0, 0.0
    for x in signal:
        y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
        out.append(y)
        x2, x1, y2, y1 = x1, x, y1, y
    return out


def encouragement() -> list[float]:
    length = 0.75
    notes = [(0.00, 783.99), (0.11, 1046.50)]  # G5 then C6
    samples = []
    for i in range(int(RATE * length)):
        t = i / RATE
        v = sum(bell(t - s, f, 0.24) for s, f in notes)
        v += 0.25 * bell(t - 0.2, 2093.0, 0.15)  # a quiet sparkle an octave up
        samples.append(v)
    return samples


def applause(rng: random.Random) -> list[float]:
    length = 1.8
    total = int(RATE * length)
    samples = [0.0] * total
    t = 0.0
    while t < length - 0.06:
        # Claps come thick in the middle and thin out at both ends.
        density = 55 * min(1.0, t / 0.25) * min(1.0, max(0.0, (length - 0.1 - t) / 0.6))
        t += rng.expovariate(max(density, 4.0))
        if t >= length - 0.06:
            break
        burst_len = int(RATE * 0.045)
        noise = [rng.uniform(-1, 1) * math.exp(-(k / RATE) / rng.uniform(0.008, 0.016)) for k in range(burst_len)]
        clap = bandpass(noise, rng.uniform(900, 2600), rng.uniform(1.2, 2.2))
        gain = rng.uniform(0.35, 1.0) * min(1.0, density / 40 + 0.3)
        start = int(t * RATE)
        for k, v in enumerate(clap):
            if start + k < total:
                samples[start + k] += gain * v
    # A breath of room under the claps, shaped like them.
    room = bandpass([rng.uniform(-1, 1) for _ in range(total)], 1500, 0.7)
    for i in range(total):
        t = i / RATE
        shape = min(1.0, t / 0.25) * min(1.0, max(0.0, (length - t) / 0.6))
        samples[i] += 0.06 * shape * room[i]
    return samples


def celebration(rng: random.Random) -> list[float]:
    length = 1.7
    total = int(RATE * length)
    # Ta-da: three quick rising notes, then the chord held.
    calls = [(0.00, 523.25, 0.13), (0.12, 659.25, 0.13), (0.24, 783.99, 0.13)]
    chord = [(0.38, f, 1.1) for f in (523.25, 659.25, 783.99, 1046.50)]
    sparkles = [(rng.uniform(0.4, 1.3), rng.choice([2093.0, 2349.3, 2637.0, 3136.0, 3520.0])) for _ in range(14)]
    dry = []
    for i in range(total):
        t = i / RATE
        v = sum(0.5 * brass(t - s, f, n) for s, f, n in calls)
        v += sum(0.32 * brass(t - s, f, n) for s, f, n in chord)
        v += sum(0.18 * bell(t - s, f, 0.09) for s, f in sparkles)
        dry.append(v)
    # A short echo, so it sounds like a room and not a phone speaker.
    delay = int(RATE * 0.085)
    return [dry[i] + (0.28 * dry[i - delay] if i >= delay else 0.0) for i in range(total)]


def write(name: str, samples: list[float], loudness: float = 0.0) -> None:
    """Peaks at PEAK. With [loudness] (an RMS), it is brought up to that first and
    its peaks rounded off (tanh), so spiky claps sound as loud as a bell."""
    if loudness:
        rms = math.sqrt(sum(v * v for v in samples) / len(samples)) or 1.0
        samples = [math.tanh(v * loudness / rms / PEAK) for v in samples]
    peak = max(abs(v) for v in samples) or 1.0
    fade = int(RATE * 0.05)  # the last 50 ms fade to silence
    frames = bytearray()
    for i, v in enumerate(samples):
        v = v / peak * PEAK * min(1.0, (len(samples) - i) / fade)
        frames += struct.pack('<h', int(max(-1.0, min(1.0, v)) * 32767))
    with wave.open(str(OUT / name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))
    print(f'assets/sounds/{name}: {len(samples) / RATE:.2f} s, {len(frames)} bytes of audio')


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    write('reward_encouragement.wav', encouragement())
    write('reward_applause.wav', applause(random.Random(55_01)), loudness=0.17)
    write('reward_celebration.wav', celebration(random.Random(55_02)))


if __name__ == '__main__':
    main()
