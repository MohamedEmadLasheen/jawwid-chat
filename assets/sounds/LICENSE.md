# Reward sounds: licence

| File | Plays for | Length |
|---|---|---|
| `reward_encouragement.wav` | a star or a sticker | 0.75 s |
| `reward_applause.wav` | a praise stamp | 1.8 s |
| `reward_celebration.wav` | a celebration | 1.7 s |

**Source:** our own work. They are synthesised by `scripts/assets/make_reward_sounds.py` from sine tones and seeded noise. No sample, recording or third-party sound is used, and nothing is downloaded. A re-run writes the same bytes.

**Licence:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). To the extent possible under law, Jawwid has waived all copyright and related rights in these sound files and in the script that makes them.

**Changing them:** edit the script, re-run it, and commit the script and the files together.

```
/usr/bin/python3 -I scripts/assets/make_reward_sounds.py
```

They play only where the family's Reward sounds setting is on (on by default for a family's phone, off for a teacher and in the browser), and never while the phone is silenced (PD-55 plan §3 B2).
