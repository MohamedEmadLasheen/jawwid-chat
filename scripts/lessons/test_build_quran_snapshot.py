#!/usr/bin/env python3
"""The lessons snapshot is built only from the verified dataset, verbatim.

    python3 -I scripts/lessons/test_build_quran_snapshot.py
"""
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
_spec = importlib.util.spec_from_file_location('snapshot', os.path.join(HERE, 'build-quran-snapshot.py'))
snap = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(snap)
PIN = os.path.join(ROOT, 'apps', 'lessons', 'quran-pin.json')


class Snapshot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        cls.index = snap.build(cls.dir.name, PIN)

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def surah(self, n):
        return json.load(open(os.path.join(self.dir.name, f'surah-{n:03d}.json'), encoding='utf-8'))

    def test_every_surah_every_ayah_with_its_verse_hash(self):
        self.assertEqual(len(self.index['surahs']), 114)
        self.assertEqual(sum(s['ayahCount'] for s in self.index['surahs']), 6236)
        total = basmalas = 0
        for s in self.index['surahs']:
            body = self.surah(s['number'])
            self.assertEqual([a['ayah'] for a in body['ayahs']], list(range(1, s['ayahCount'] + 1)))
            for a in body['ayahs']:
                self.assertEqual(a['sha256'], hashlib.sha256(a['text'].encode('utf-8')).hexdigest())
                basmalas += a['basmala'] is not None
            self.assertEqual(s['rangeSha256'], hashlib.sha256('\n'.join(a['sha256'] for a in body['ayahs']).encode('utf-8')).hexdigest())
            total += len(body['ayahs'])
        self.assertEqual((total, basmalas), (6236, 112))

    def test_the_text_is_the_files_verbatim_and_the_basmala_is_split_off(self):
        raw = open(os.path.join(ROOT, 'data', 'quran', 'tanzil-uthmani-1.1.txt'), 'rb').read()
        lines = {(s, a): t for s, a, t in snap.lq.parse(raw)}
        two = self.surah(2)['ayahs'][0]
        self.assertEqual(f"{two['basmala']} {two['text']}", lines[(2, 1)])
        self.assertEqual([ord(c) for c in two['text']], [0x627, 0x644, 0x653, 0x645, 0x653])
        self.assertIsNone(self.surah(9)['ayahs'][0]['basmala'])
        self.assertEqual(self.surah(1)['ayahs'][0]['text'], lines[(1, 1)])
        self.assertEqual(self.index['fileSha256'], json.load(open(PIN))['fileSha256'])

    def test_a_different_pin_is_refused_and_nothing_is_written(self):
        with tempfile.TemporaryDirectory() as d:
            bad = os.path.join(d, 'pin.json')
            json.dump({'datasetId': 'tanzil-uthmani-1.1', 'fileSha256': '0' * 64}, open(bad, 'w'))
            out = os.path.join(d, 'out')
            self.assertEqual(snap.main(['--out', out, '--pin', bad]), 1)
            self.assertFalse(os.path.exists(out))


if __name__ == '__main__':
    unittest.main(verbosity=1)
