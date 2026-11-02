#!/usr/bin/env python3
"""PD-55: generates assets/sounds/reward_chime.wav, the reward celebration's chime.

Our own sound, made here from three sine notes -- C6, E6, G6, a rising major
arpeggio -- each with a short attack and a soft decay, then a quiet octave
sparkle. 0.8 s, 22.05 kHz, 16-bit mono. No sample, no licence: re-run this to
change it, and commit the script and the file together.

    /usr/bin/python3 -I scripts/assets/make_reward_chime.py
"""
import math
import struct
import wave
from pathlib import Path

RATE = 22050
LENGTH = 0.8
NOTES = [(0.00, 1046.50), (0.12, 1318.51), (0.24, 1567.98)]  # (start s, Hz)
SPARKLE = (0.36, 2093.00)
OUT = Path(__file__).resolve().parents[2] / 'assets' / 'sounds' / 'reward_chime.wav'


def note(t: float, start: float, freq: float, gain: float, decay: float) -> float:
    dt = t - start
    if dt < 0:
        return 0.0
    attack = min(1.0, dt / 0.008)  # 8 ms: no click
    envelope = attack * math.exp(-dt / decay)
    # A touch of the second harmonic makes it bell-like rather than a pure beep.
    return gain * envelope * (math.sin(2 * math.pi * freq * dt) + 0.25 * math.sin(4 * math.pi * freq * dt))


def main() -> None:
    frames = bytearray()
    total = int(RATE * LENGTH)
    for i in range(total):
        t = i / RATE
        v = sum(note(t, s, f, 0.28, 0.22) for s, f in NOTES) + note(t, SPARKLE[0], SPARKLE[1], 0.12, 0.18)
        fade = min(1.0, (total - i) / (RATE * 0.05))  # the last 50 ms fade to silence
        frames += struct.pack('<h', int(max(-1.0, min(1.0, v * fade)) * 32767))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))
    print(f'{OUT.relative_to(OUT.parents[2])}: {len(frames)} bytes of audio')


if __name__ == '__main__':
    main()
