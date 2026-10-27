#!/usr/bin/env python3
"""Load one pinned Quran dataset (docs/product/quran-dataset-contract.md).

    python3 -I scripts/db/load-quran.py <dataset-id> [--data-dir data/quran] | psql -v ON_ERROR_STOP=1 "$DATABASE_URL"
    python3 -I scripts/db/load-quran.py --check <dataset-id>      # verify only, write nothing

Runs from a repo checkout, after the migrations (scripts/db/load-quran.sh, the
deploy job), never inside the API image. Before a single row is emitted:
  * the file's SHA-256 must equal the pinned one (data/quran/<id>.json, which
    the guard keeps equal to apps/api/src/quran/pinned.ts);
  * every line is `surah|ayah|text`; comments (#) and blank lines are skipped;
    the text is kept VERBATIM (only the line terminator is removed);
  * 6,236 ayat, every surah numbered 1..n with n = its ayah count
    (apps/api/src/materials/quran-surahs.ts), no empty ayah;
  * the digest of the per-ayah SHA-256s equals the pinned digest.
The SQL it prints stages the rows and calls chat.load_quran_dataset, which
checks the counts and the digest again against the database, in one
transaction. A dataset already loaded with the same fingerprints is skipped.

Standard library only: the deploy job has python3 and psql, nothing else.
"""
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SURAHS_TS = os.path.join(ROOT, 'apps', 'api', 'src', 'materials', 'quran-surahs.ts')


class Refused(Exception):
    """The dataset must not be loaded; the message says why."""


def surah_counts(path=SURAHS_TS):
    rows = re.findall(r"\[(\d+), '[^']*', \"[^\"]*\", (\d+), \d+, \d+\]", open(path, encoding='utf-8').read())
    counts = {int(n): int(c) for n, c in rows}
    if sorted(counts) != list(range(1, 115)):
        raise Refused(f'{path}: expected surahs 1..114, read {len(counts)}')
    return counts


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


# The same folding as lib/shared/utils/search_text.dart (SearchText.fold); the
# vectors in data/quran/search-normalisation.vectors.json hold both to it.
_FOLD = {0x0622: 0x0627, 0x0623: 0x0627, 0x0625: 0x0627, 0x0671: 0x0627, 0x0672: 0x0627, 0x0673: 0x0627,
         0x0649: 0x064A, 0x06CC: 0x064A, 0x06D2: 0x064A, 0x0629: 0x0647, 0x0624: 0x0621, 0x0626: 0x0621,
         0x06A9: 0x0643, 0x06AA: 0x0643}


def search_fold(text):
    out = []
    for ch in text:
        c = ord(ch)
        if 0x064B <= c <= 0x065F or c == 0x0670 or 0x06D6 <= c <= 0x06ED or c == 0x0640:
            continue
        if 0x41 <= c <= 0x5A:
            c += 0x20
        elif 0x0660 <= c <= 0x0669:
            c = c - 0x0660 + 0x30
        elif 0x06F0 <= c <= 0x06F9:
            c = c - 0x06F0 + 0x30
        else:
            c = _FOLD.get(c, c)
        out.append(chr(c))
    return re.sub(r'\s+', ' ', ''.join(out).strip())


def parse(raw):
    """Bytes of the vendored file -> [(surah, ayah, text)], verbatim."""
    text = raw.decode('utf-8')
    if text.startswith('\ufeff'):
        text = text[1:]  # a byte-order mark is an encoding marker, not text
    rows = []
    for n, line in enumerate(text.split('\n'), 1):
        line = line[:-1] if line.endswith('\r') else line
        if not line or line.startswith('#'):
            continue
        parts = line.split('|', 2)
        if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit():
            raise Refused(f'line {n}: not "surah|ayah|text"')
        rows.append((int(parts[0]), int(parts[1]), parts[2]))
    return rows


def verify(raw, manifest, counts):
    """All the checks; returns the rows with their hashes. Raises Refused."""
    file_sha = sha256_hex(raw)
    if file_sha != manifest['fileSha256']:
        raise Refused(f'the file\'s SHA-256 {file_sha} is not the pinned {manifest["fileSha256"]}')
    rows = parse(raw)
    total = sum(counts.values())
    if len(rows) != total:
        raise Refused(f'{len(rows)} ayat, expected {total}')
    seen = {}
    for s, a, t in rows:
        if (s, a) in seen:
            raise Refused(f'{s}:{a} appears twice')
        if s not in counts or not 1 <= a <= counts[s]:
            raise Refused(f'{s}:{a} does not exist')
        if not t:
            raise Refused(f'{s}:{a} is empty')
        seen[(s, a)] = t
    for s, n in counts.items():
        if sum(1 for (ss, _a) in seen if ss == s) != n:
            raise Refused(f'surah {s} does not have {n} ayat')
    ordered = [(s, a, seen[(s, a)]) for s in sorted(counts) for a in range(1, counts[s] + 1)]
    hashes = [sha256_hex(t.encode('utf-8')) for _s, _a, t in ordered]
    digest = sha256_hex('\n'.join(hashes).encode('utf-8'))
    if digest != manifest['ayahsDigest']:
        raise Refused(f'the ayat digest {digest} is not the pinned {manifest["ayahsDigest"]}')
    return ordered


def _copy(value):
    return value.replace('\\', '\\\\').replace('\t', '\\t').replace('\n', '\\n').replace('\r', '\\r')


def _lit(value):
    return "'" + value.replace("'", "''") + "'"


def sql(dataset_id, manifest, ordered):
    out = ['\\set ON_ERROR_STOP on', 'begin;',
           'create temp table quran_load (surah smallint, ayah smallint, text_uthmani text, text_search text) on commit drop;',
           'copy quran_load (surah, ayah, text_uthmani, text_search) from stdin;']
    out += [f'{s}\t{a}\t{_copy(t)}\t{_copy(search_fold(t))}' for s, a, t in ordered]
    out += ['\\.',
            f'select chat.load_quran_dataset({_lit(dataset_id)}, {_lit(manifest["fileSha256"])}, '
            f'{_lit(manifest["ayahsDigest"])}, {_lit(manifest["attribution"])}, {_lit(manifest["sourceUrl"])});',
            'commit;']
    return '\n'.join(out) + '\n'


def load_manifest(data_dir, dataset_id):
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{2,63}', dataset_id):
        raise Refused(f'not a dataset id: {dataset_id!r}')
    manifest = json.load(open(os.path.join(data_dir, f'{dataset_id}.json'), encoding='utf-8'))
    if manifest.get('id') != dataset_id:
        raise Refused(f'{dataset_id}.json names {manifest.get("id")!r}')
    return manifest


def main(argv):
    args = list(argv)
    check_only = '--check' in args
    if check_only:
        args.remove('--check')
    data_dir = os.path.join(ROOT, 'data', 'quran')
    if '--data-dir' in args:
        i = args.index('--data-dir')
        data_dir = args[i + 1]
        del args[i:i + 2]
    if len(args) != 1:
        print(__doc__.strip().split('\n\n')[1], file=sys.stderr)
        return 2
    dataset_id = args[0]
    try:
        manifest = load_manifest(data_dir, dataset_id)
        raw = open(os.path.join(data_dir, f'{dataset_id}.txt'), 'rb').read()
        ordered = verify(raw, manifest, surah_counts())
    except Refused as e:
        print(f'load-quran: REFUSED {dataset_id}: {e}', file=sys.stderr)
        return 1
    if check_only:
        print(f'load-quran: {dataset_id} verified ({len(ordered)} ayat)', file=sys.stderr)
        return 0
    sys.stdout.write(sql(dataset_id, manifest, ordered))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
