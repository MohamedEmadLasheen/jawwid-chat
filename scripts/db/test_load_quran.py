#!/usr/bin/env python3
"""Tests for scripts/db/load-quran.py: a tampered file, a count mismatch, a
split, duplicate or empty ayah, and a corrupted, missing or misplaced Basmala
are all refused before a row is written.

    python3 -I scripts/db/test_load_quran.py
"""
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True  # importing load-quran.py must leave no __pycache__ in the repo
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
_spec = importlib.util.spec_from_file_location('load_quran', os.path.join(HERE, 'load-quran.py'))
lq = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lq)

COUNTS = lq.surah_counts()


def build(rows, comment=True):
    lines = [f'{s}|{a}|{t}' for s, a, t in rows]
    if comment:
        lines += ['', '#  A synthetic stand-in for the Tanzil file; not Quran text.']
    return ('\n'.join(lines) + '\n').encode('utf-8')


def real_rows():
    raw = open(os.path.join(ROOT, 'data', 'quran', 'tanzil-uthmani-1.1.txt'), 'rb').read()
    return lq.parse(raw)


_REAL = {(s, a): t for s, a, t in real_rows()}
# Arabic comes from the pinned file, never typed: identical-looking text can differ in code points.
BASMALA = _REAL[(1, 1)]
BASMALA_SHADDA = ' '.join(_REAL[(95, 1)].split(' ')[:4])


def synthetic():
    rows = []
    for s in sorted(COUNTS):
        for a in range(1, COUNTS[s] + 1):
            t = f'نص {s}:{a}'
            if a == 1 and s not in (1, 9):
                t = f'{BASMALA_SHADDA if s in (95, 97) else BASMALA} {t}'
            rows.append((s, a, t))
    return rows


def manifest_for(raw, rows):
    hashes = [hashlib.sha256(t.encode('utf-8')).hexdigest() for _s, _a, t in rows]
    return {'id': 'synthetic-1', 'fileSha256': hashlib.sha256(raw).hexdigest(),
            'ayahsDigest': hashlib.sha256('\n'.join(hashes).encode('utf-8')).hexdigest(),
            'attribution': 'test', 'sourceUrl': 'https://example.test/quran'}


class LoaderRefuses(unittest.TestCase):
    def setUp(self):
        self.rows = synthetic()
        self.raw = build(self.rows)
        self.manifest = manifest_for(self.raw, self.rows)

    def refused(self, raw, manifest=None):
        with self.assertRaises(lq.Refused) as ctx:
            lq.verify(raw, manifest or self.manifest, COUNTS)
        return str(ctx.exception)

    def test_accepts_the_pinned_file_and_emits_one_transaction(self):
        ordered = lq.verify(self.raw, self.manifest, COUNTS)
        self.assertEqual(len(ordered), 6236)
        out = lq.sql('synthetic-1', self.manifest, ordered)
        self.assertTrue(out.startswith('\\set ON_ERROR_STOP on\nbegin;'))
        self.assertIn("select chat.load_quran_dataset('synthetic-1', ", out)
        self.assertTrue(out.endswith('commit;\n'))
        self.assertEqual(out.count('\n85\t'), 22)
        self.assertIn('copy quran_load (surah, ayah, text_uthmani) from stdin;', out)

    def test_a_tampered_file_is_refused(self):
        tampered = self.raw.replace('نص 101:4'.encode('utf-8'), 'نص 101:4x'.encode('utf-8'))
        self.assertIn("SHA-256", self.refused(tampered))

    def test_a_tampered_file_with_an_edited_file_pin_is_still_refused_by_the_digest(self):
        tampered = self.raw.replace('نص 101:4'.encode('utf-8'), 'نص 101:4x'.encode('utf-8'))
        repinned = dict(self.manifest, fileSha256=hashlib.sha256(tampered).hexdigest())
        self.assertIn('digest', self.refused(tampered, repinned))

    def _repinned(self, rows):
        raw = build(rows)
        return raw, dict(self.manifest, fileSha256=hashlib.sha256(raw).hexdigest())

    def test_a_count_mismatch_is_refused(self):
        missing = [r for r in self.rows if r[:2] != (89, 23)]
        self.assertIn('expected 6236', self.refused(*self._repinned(missing)))

    def test_a_split_ayah_is_refused(self):
        split = self.rows + [(89, 31, 'extra')]
        self.assertIn('expected 6236', self.refused(*self._repinned(split)))
        shifted = [(s, 31 if (s, a) == (89, 30) else a, t) for s, a, t in self.rows]
        self.assertIn('does not exist', self.refused(*self._repinned(shifted)))

    def test_a_duplicate_or_empty_ayah_is_refused(self):
        dup = [(s, 3 if (s, a) == (112, 4) else a, t) for s, a, t in self.rows]
        self.assertIn('twice', self.refused(*self._repinned(dup)))
        empty = [(s, a, '' if (s, a) == (108, 2) else t) for s, a, t in self.rows]
        self.assertIn('empty', self.refused(*self._repinned(empty)))

    def test_a_malformed_line_is_refused(self):
        raw = self.raw.replace(b'1|1|', b'1-1|', 1)
        self.assertIn('not "surah|ayah|text"', self.refused(raw, dict(self.manifest, fileSha256=hashlib.sha256(raw).hexdigest())))

    def test_the_text_is_kept_verbatim_and_copy_escaped(self):
        rows = [(s, a, 'a\tb\\c ' if (s, a) == (1, 2) else t) for s, a, t in self.rows]
        raw = build(rows).replace(b'\n', b'\r\n')
        manifest = manifest_for(raw, rows)
        ordered = lq.verify(raw, manifest, COUNTS)
        self.assertEqual(ordered[1][2], 'a\tb\\c ')
        self.assertIn('1\t2\ta\\tb\\\\c \n', lq.sql('synthetic-1', manifest, ordered))

    def test_main_refuses_without_writing_sql(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, 'synthetic-1.txt'), 'wb').write(self.raw + b'#')
            json.dump(self.manifest, open(os.path.join(d, 'synthetic-1.json'), 'w'))
            self.assertEqual(lq.main(['--check', '--data-dir', d, 'synthetic-1']), 1)
            open(os.path.join(d, 'synthetic-1.txt'), 'wb').write(self.raw)
            self.assertEqual(lq.main(['--check', '--data-dir', d, 'synthetic-1']), 0)


class Basmala(unittest.TestCase):
    """Tanzil prefixes the Basmala to ayah 1 of 112 surahs; it is split off, never counted as the verse."""

    def test_the_real_file_splits_as_the_rule_requires(self):
        splits = {(s, a): lq.split_basmala(s, a, t) for s, a, t in real_rows()}
        self.assertEqual(sum(1 for b, _v in splits.values() if b is not None), 112)
        self.assertEqual(splits[(1, 1)], (None, BASMALA))
        self.assertIsNone(splits[(9, 1)][0])
        self.assertEqual([ord(c) for c in splits[(2, 1)][1]], [0x627, 0x644, 0x653, 0x645, 0x653])  # "الٓمٓ"
        for s in (95, 97):
            self.assertEqual(splits[(s, 1)][0], BASMALA_SHADDA)

    def _refused(self, rows):
        raw = build(rows)
        with self.assertRaises(lq.Refused) as ctx:
            lq.verify(raw, manifest_for(raw, rows), COUNTS)
        return str(ctx.exception)

    def test_a_corrupted_or_missing_prefix_is_refused(self):
        rows = synthetic()
        two_one = next(t for s, a, t in rows if (s, a) == (2, 1))
        corrupted = [(s, a, two_one[:2] + two_one[3:] if (s, a) == (2, 1) else t) for s, a, t in rows]
        self.assertIn('accepted Basmala', self._refused(corrupted))
        missing = [(s, a, 'نص 2:1' if (s, a) == (2, 1) else t) for s, a, t in rows]
        self.assertIn('accepted Basmala', self._refused(missing))
        double_space = [(s, a, f'{BASMALA}  نص 2:1' if (s, a) == (2, 1) else t) for s, a, t in rows]
        self.assertIn('accepted Basmala', self._refused(double_space))

    def test_a_basmala_on_9_1_is_refused(self):
        rows = [(s, a, f'{BASMALA} {t}' if (s, a) == (9, 1) else t) for s, a, t in synthetic()]
        self.assertIn('9:1', self._refused(rows))


if __name__ == '__main__':
    unittest.main(verbosity=1)
