#!/usr/bin/env python3
"""The Quran dataset's fingerprints are pinned in three places that must agree:
apps/api/src/quran/pinned.ts (what the API serves), data/quran/<id>.json (what
the loader checks) and the vendored file data/quran/<id>.txt itself. This
fails when any two disagree, a pin has no file or a file no pin, or a vendored
file does not verify (counts, numbering, digest). Run by the `quran-dataset`
gate of scripts/qa/guards.sh.

    python3 -I scripts/db/check-quran-pins.py
"""
import glob
import hashlib
import importlib.util
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # importing load-quran.py must leave no __pycache__ in the repo
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_spec = importlib.util.spec_from_file_location('load_quran', os.path.join(ROOT, 'scripts', 'db', 'load-quran.py'))
lq = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lq)

ENTRY = re.compile(
    r"\{\s*id:\s*'([^']+)',\s*fileSha256:\s*'([0-9a-f]{64})',\s*ayahsDigest:\s*'([0-9a-f]{64})',"
    r"\s*attribution:\s*'([^']*)',\s*sourceUrl:\s*'([^']*)',?\s*\}")


def pinned_ts():
    src = open(os.path.join(ROOT, 'apps', 'api', 'src', 'quran', 'pinned.ts'), encoding='utf-8').read()
    body = src[src.index('new Map<string, PinnedDataset>('):]
    return {m.group(1): dict(id=m.group(1), fileSha256=m.group(2), ayahsDigest=m.group(3), attribution=m.group(4), sourceUrl=m.group(5))
            for m in ENTRY.finditer(body)}


def main():
    errors = []
    pins = pinned_ts()
    data = os.path.join(ROOT, 'data', 'quran')
    manifests = {os.path.basename(p)[:-5]: p for p in glob.glob(os.path.join(data, '*.json'))
                 if not p.endswith('.vectors.json')}
    texts = {os.path.basename(p)[:-4] for p in glob.glob(os.path.join(data, '*.txt'))}
    for missing in sorted(set(pins) ^ set(manifests)):
        errors.append(f'{missing}: pinned in pinned.ts and data/quran/<id>.json must both exist')
    for missing in sorted(set(manifests) ^ texts):
        errors.append(f'{missing}: data/quran/{missing}.json and data/quran/{missing}.txt must both exist')
    counts = lq.surah_counts()
    for dataset_id in sorted(set(pins) & set(manifests) & texts):
        manifest = json.load(open(manifests[dataset_id], encoding='utf-8'))
        for key in ('id', 'fileSha256', 'ayahsDigest', 'attribution', 'sourceUrl'):
            if manifest.get(key) != pins[dataset_id][key]:
                errors.append(f'{dataset_id}: {key} differs between pinned.ts and {dataset_id}.json')
        raw = open(os.path.join(data, f'{dataset_id}.txt'), 'rb').read()
        sha_file = os.path.join(data, f'{dataset_id}.sha256')
        if not os.path.exists(sha_file) or open(sha_file).read().split()[:1] != [hashlib.sha256(raw).hexdigest()]:
            errors.append(f'{dataset_id}: {dataset_id}.sha256 is missing or not the file\'s SHA-256')
        try:
            lq.verify(raw, manifest, counts)
        except lq.Refused as e:
            errors.append(f'{dataset_id}: {e}')
    for e in errors:
        print(f'quran-dataset: {e}')
    if not errors:
        print(f'quran-dataset: {len(pins)} pinned dataset(s); pins, manifests and files agree')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
