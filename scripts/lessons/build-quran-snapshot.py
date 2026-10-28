#!/usr/bin/env python3
"""Build the lessons engine's Quran snapshot from the ONE verified dataset.

    python3 -I scripts/lessons/build-quran-snapshot.py [--out apps/lessons/public/data/quran] [--pin apps/lessons/quran-pin.json]

The contract (docs/product/quran-dataset-contract.md, "Loading") requires every
consumer outside the API to verify the file before using it. So this:
  1. refuses unless the pinned dataset (apps/lessons/quran-pin.json) is the one
     vendored in data/quran/, with the same file SHA-256;
  2. runs the loader's own verification (scripts/db/load-quran.py: file hash,
     counts, numbering, digest, the Basmala rule) and refuses on any failure;
  3. only then writes manifest.json and surah-NNN.json, each ayah as
     { ayah, basmala, text, sha256 } -- text is the verse, verbatim; sha256 is
     its hash, the same value the API serves.
Nothing is normalised, re-typed or edited. Standard library only.
"""
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


def surah_names():
    src = open(lq.SURAHS_TS, encoding='utf-8').read()
    return {int(n): (ar, en) for n, ar, en in re.findall(r"\[(\d+), '([^']*)', \"([^\"]*)\", \d+, \d+, \d+\]", src)}


def build(out_dir, pin_path, data_dir=os.path.join(ROOT, 'data', 'quran')):
    pin = json.load(open(pin_path, encoding='utf-8'))
    dataset_id = pin['datasetId']
    manifest = lq.load_manifest(data_dir, dataset_id)
    if manifest['fileSha256'] != pin['fileSha256']:
        raise lq.Refused(f'{pin_path} pins {pin["fileSha256"]}, but data/quran/{dataset_id}.json is {manifest["fileSha256"]}')
    raw = open(os.path.join(data_dir, f'{dataset_id}.txt'), 'rb').read()
    counts = lq.surah_counts()
    ordered = lq.verify(raw, manifest, counts)  # the loader's checks; raises Refused
    names = surah_names()
    by_surah = {}
    for s, a, t in ordered:
        basmala, verse = lq.split_basmala(s, a, t)
        by_surah.setdefault(s, []).append({'ayah': a, 'basmala': basmala, 'text': verse,
                                           'sha256': hashlib.sha256(verse.encode('utf-8')).hexdigest()})
    os.makedirs(out_dir, exist_ok=True)
    surahs = []
    for s in sorted(by_surah):
        ayahs = by_surah[s]
        range_sha = hashlib.sha256('\n'.join(x['sha256'] for x in ayahs).encode('utf-8')).hexdigest()
        body = {'datasetId': dataset_id, 'surah': s, 'ayahs': ayahs}
        with open(os.path.join(out_dir, f'surah-{s:03d}.json'), 'w', encoding='utf-8') as fh:
            json.dump(body, fh, ensure_ascii=False, separators=(',', ':'))
        surahs.append({'number': s, 'nameAr': names[s][0], 'nameEn': names[s][1], 'ayahCount': counts[s], 'rangeSha256': range_sha})
    index = {'datasetId': dataset_id, 'fileSha256': manifest['fileSha256'], 'attribution': manifest['attribution'],
             'sourceUrl': manifest['sourceUrl'], 'surahs': surahs}
    with open(os.path.join(out_dir, 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(index, fh, ensure_ascii=False, indent=1)
    return index


def main(argv):
    args = list(argv)
    out = os.path.join(ROOT, 'apps', 'lessons', 'public', 'data', 'quran')
    pin = os.path.join(ROOT, 'apps', 'lessons', 'quran-pin.json')
    if '--out' in args:
        i = args.index('--out'); out = args[i + 1]; del args[i:i + 2]
    if '--pin' in args:
        i = args.index('--pin'); pin = args[i + 1]; del args[i:i + 2]
    try:
        index = build(out, pin)
    except lq.Refused as e:
        print(f'build-quran-snapshot: REFUSED: {e}', file=sys.stderr)
        return 1
    print(f'build-quran-snapshot: {index["datasetId"]} -> {out} ({sum(s["ayahCount"] for s in index["surahs"])} ayat)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
