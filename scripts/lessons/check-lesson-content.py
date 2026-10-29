#!/usr/bin/env python3
"""Check the lessons engine's reviewed content against the verified Quran (PD-29 P0-4).

    python3 -I scripts/lessons/check-lesson-content.py            # every apps/lessons/src/content/surah-NNN.json
    python3 -I scripts/lessons/check-lesson-content.py selftest

A lesson's content (tafsir lines, word meanings, game and quiz config, lessons
learned) is prose plus POSITIONS into the verified dataset: {ayah} or
{ayah, word}. The Quran itself is never in it. This FAILS when:
  * a position does not exist in the verified surah (word n = the n-th
    space-separated token that holds a letter, the engine's rule);
  * the tafsir does not list each ayah exactly once, or a missing line (null)
    is not flagged for review;
  * a prose string carries Uthmani-only marks, four or more consecutive words
    of the surah, or a whole (shorter) ayah -- i.e. Quran typed or pasted into prose. (Three is too
    tight: tafsir paraphrase legitimately repeats short runs such as
    "السماوات والأرض والله".) Typed Quran is matched on the rasm skeleton, so
    standard spelling (الرحمن, الصلاة) is caught as well as the Uthmani; the
    Basmala counts in every surah's lesson, since the verses carry it apart.
  * a quiz's answer or options are malformed, or a game has too few distinct words;
  * the file says "approved" while any line is still flagged, or names no reviewer.
Standard library only; reads files.
"""
import importlib.util
import json
import os
import re
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CONTENT = os.path.join(ROOT, 'apps', 'lessons', 'src', 'content')
PIN = os.path.join(ROOT, 'apps', 'lessons', 'quran-pin.json')
LETTER = re.compile('[' + chr(0x621) + '-' + chr(0x64A) + chr(0x671) + ']')
UTHMANI_ONLY = re.compile('[' + chr(0x670) + chr(0x671) + chr(0x6D6) + '-' + chr(0x6ED) + ']')
KEYS = {'surah', 'datasetId', 'review', 'provenance', 'intro', 'tafsir', 'words', 'complete', 'quiz', 'lessons', 'reflection', 'didYouKnow'}
CATEGORIES = {'hifz', 'meanings', 'lessons'}
RUN = 4  # consecutive verse words that count as typed Quran


def words_of(verse):
    return [t for t in verse.split(' ') if LETTER.search(t)]


def fold(t):
    t = t.translate({0x670: 0x627})
    t = ''.join(c for c in t if not (0x64B <= ord(c) <= 0x65F or 0x6D6 <= ord(c) <= 0x6ED or ord(c) == 0x640))
    t = t.translate({0x671: 0x627, 0x623: 0x627, 0x625: 0x627, 0x622: 0x627, 0x649: 0x64A, 0x629: 0x647})
    t = t.replace(chr(0x621) + chr(0x627), chr(0x627)).replace(chr(0x627) * 2, chr(0x627))
    return re.sub('[^' + chr(0x621) + '-' + chr(0x64A) + ' ]', ' ', t)


def _load(name):
    spec = importlib.util.spec_from_file_location(name[:-3], os.path.join(HERE, name))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# The ONE typed-Quran fold, shared with PD-48 (scripts/lessons/rasm.py): no alef or hamza of any
# form, no marks, the Uthmani waw-for-alef dropped. Positions keep fold() above.
RASM = _load('rasm.py')
rasm = RASM.rasm


def verified_surahs():
    spec = importlib.util.spec_from_file_location('snapshot', os.path.join(HERE, 'build-quran-snapshot.py'))
    snap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(snap)
    with tempfile.TemporaryDirectory() as d:
        snap.build(d, PIN)
        out = {}
        for s in range(1, 115):
            out[s] = [a['text'] for a in json.load(open(os.path.join(d, f'surah-{s:03d}.json'), encoding='utf-8'))['ayahs']]
        return out


def check(content, verses, dataset_id, also=()):
    """verses: the surah's verse texts, ayah 1 first. also: more Quran text that
    prose must not type (the Basmala, which the verses carry apart)."""
    errors = []
    err = errors.append
    n = len(verses)
    counts = [len(words_of(v)) for v in verses]
    if set(content) != KEYS:
        return [f'keys must be exactly {sorted(KEYS)}, not {sorted(content)}']
    if content['datasetId'] != dataset_id:
        err(f'datasetId {content["datasetId"]!r} is not the pinned {dataset_id!r}')
    prose = []  # (where, text)
    flagged = []

    def note(where, item):
        r = item.get('review') if isinstance(item, dict) else None
        if r is not None and (not isinstance(r, str) or not r.strip()):
            err(f'{where}: review must be null or a non-empty note')
        if r:
            flagged.append(where)

    def text(where, t):
        if not isinstance(t, str) or not t.strip():
            err(f'{where}: must be non-empty text')
        else:
            prose.append((where, t))

    def ayah_ref(where, r):
        if not isinstance(r, dict) or set(r) != {'ayah'} or not isinstance(r['ayah'], int) or not 1 <= r['ayah'] <= n:
            err(f'{where}: {r!r} is not an ayah of this surah (1..{n})')

    def word_ref(where, r):
        if not isinstance(r, dict) or set(r) != {'ayah', 'word'} or not all(isinstance(r[k], int) for k in r):
            err(f'{where}: {r!r} is not a {{ayah, word}} position')
        elif not 1 <= r['ayah'] <= n or not 1 <= r['word'] <= counts[r['ayah'] - 1]:
            err(f'{where}: {r!r} is not a word of this surah')

    def word_text(r):
        return fold(words_of(verses[r['ayah'] - 1])[r['word'] - 1]).strip()

    review = content['review']
    if not isinstance(review, dict) or review.get('status') not in ('pending', 'approved'):
        err('review.status must be "pending" or "approved"')
        review = {}

    text('intro.text', content['intro'].get('text'))
    note('intro', content['intro'])

    tafsir = content['tafsir']
    if [t.get('ayah') for t in tafsir] != list(range(1, n + 1)):
        err(f'tafsir must list ayat 1..{n} once each, in order')
    for t in tafsir:
        where = f'tafsir {t.get("ayah")}'
        note(where, t)
        if t.get('text') is None:
            if not t.get('review'):
                err(f'{where}: a missing line must be flagged for review')
        else:
            text(where, t['text'])

    for i, w in enumerate(content['words']):
        where = f'words[{i}]'
        word_ref(where, {k: w.get(k) for k in ('ayah', 'word')})
        text(f'{where}.meaning', w.get('meaning'))
        note(where, w)

    complete = content['complete']
    for i, r in enumerate(complete):
        word_ref(f'complete[{i}]', r)
    if not errors and len({word_text(r) for r in complete}) < 3:
        err('complete: needs at least three distinct words (each round offers three)')

    ids = [q.get('id') for q in content['quiz']]
    if len(set(ids)) != len(ids) or not all(isinstance(i, str) and i for i in ids):
        err('quiz ids must be unique')
    for q in content['quiz']:
        where = f'quiz {q.get("id")}'
        note(where, q)
        if q.get('category') not in CATEGORIES:
            err(f'{where}: category must be one of {sorted(CATEGORIES)}')
        text(f'{where}.question', q.get('question'))
        if 'prompt' in q:
            p = q['prompt']
            if not isinstance(p, dict) or set(p) != {'ayah', 'words'} or not isinstance(p.get('ayah'), int) \
                    or not 1 <= p['ayah'] <= n or not isinstance(p.get('words'), int) or not 1 <= p['words'] < counts[p['ayah'] - 1]:
                err(f'{where}: prompt must show the first 1..(count-1) words of an ayah')
        if 'word' in q:
            word_ref(f'{where}.word', q['word'])
        opts = q.get('options')
        if not isinstance(opts, list) or not 2 <= len(opts) <= 4:
            err(f'{where}: 2 to 4 options')
            continue
        for j, o in enumerate(opts):
            if isinstance(o, dict) and set(o) == {'text'}:
                text(f'{where}.options[{j}]', o['text'])
            elif isinstance(o, dict) and set(o) == {'ayah'}:
                ayah_ref(f'{where}.options[{j}]', o)
            else:
                word_ref(f'{where}.options[{j}]', o)
        if len({json.dumps(o, sort_keys=True) for o in opts}) != len(opts):
            err(f'{where}: options must be distinct')
        if not isinstance(q.get('answer'), int) or not 0 <= q['answer'] < len(opts):
            err(f'{where}: answer must index an option')

    for key in ('lessons', 'didYouKnow'):
        for i, item in enumerate(content[key]):
            text(f'{key}[{i}]', item.get('text'))
            note(f'{key}[{i}]', item)
    refl = content['reflection']
    text('reflection.question', refl.get('question'))
    for i, idea in enumerate(refl.get('ideas') or []):
        text(f'reflection.ideas[{i}]', idea)
    note('reflection', refl)

    # Runs of RUN words, or a whole ayah when it is shorter than that -- but never a
    # ONE-word ayah: a single word in prose cannot be told from the surah's name
    # (al-Qari'ah, al-Haqqah and al-'Asr are each their surah's whole first ayah).
    grams = set()
    for v in [*verses, *also]:
        ws = rasm(v).split()
        if len(ws) < 2:
            continue
        k = min(RUN, len(ws))
        grams.update(tuple(ws[i:i + k]) for i in range(len(ws) - k + 1))
    sizes = {len(g) for g in grams}
    for where, t in prose:
        if UTHMANI_ONLY.search(t):
            err(f'{where}: carries Uthmani-only marks (Quran text belongs in positions, never in prose)')
        ws = rasm(t).split()
        if any(tuple(ws[i:i + k]) in grams for k in sizes for i in range(len(ws) - k + 1)):
            err(f'{where}: contains {RUN} consecutive words of the surah, or a whole ayah (use a position, not typed Quran)')

    if review.get('status') == 'approved':
        if not isinstance(review.get('by'), str) or not review['by'].strip():
            err('review: an approved lesson names its reviewer')
        if flagged:
            err(f'review: approved while {len(flagged)} line(s) are still flagged ({", ".join(flagged[:3])}...)')
    return errors


def selftest():
    BASMALA_TEST = ['بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ']
    verses = ['ألف باء تاء ثاء', 'جيم حاء خاء', 'دال ذال راء زاي سين', 'شين صاد', 'قاف']

    def base():
        return {
            'surah': 999, 'datasetId': 'test-1', 'review': {'status': 'pending', 'by': None, 'note': 'x'},
            'provenance': {}, 'intro': {'text': 'مقدمة', 'review': None},
            'tafsir': [{'ayah': i, 'text': f'شرح {i}', 'review': None} for i in range(1, 6)],
            'words': [{'ayah': 1, 'word': 2, 'meaning': 'معنى', 'review': None}],
            'complete': [{'ayah': 1, 'word': 4}, {'ayah': 2, 'word': 3}, {'ayah': 3, 'word': 5}],
            'quiz': [{'id': 'q1', 'category': 'hifz', 'question': 'أكمل', 'prompt': {'ayah': 2, 'words': 2},
                      'options': [{'ayah': 2, 'word': 3}, {'ayah': 1, 'word': 1}], 'answer': 0, 'review': None},
                     {'id': 'q2', 'category': 'meanings', 'question': 'ما معنى', 'word': {'ayah': 1, 'word': 2},
                      'options': [{'text': 'أ'}, {'text': 'ب'}], 'answer': 1, 'review': None}],
            'lessons': [{'text': 'درس', 'review': None}],
            'reflection': {'question': 'سؤال', 'ideas': ['فكرة'], 'review': None},
            'didYouKnow': [{'text': 'هل تعلم', 'review': None}],
        }

    def set_(path, value):
        def m(c):
            *head, last = path
            for k in head:
                c = c[k]
            c[last] = value
        return m

    cases = {
        'clean': (lambda c: None, None),
        'missing-flagged': (set_(['tafsir', 2], {'ayah': 3, 'text': None, 'review': 'a teacher writes it'}), None),
        'missing-unflagged': (set_(['tafsir', 2], {'ayah': 3, 'text': None, 'review': None}), 'must be flagged'),
        'tafsir-gap': (lambda c: c['tafsir'].pop(), 'tafsir must list'),
        'word-out-of-range': (set_(['words', 0, 'word'], 5), 'not a word of this surah'),
        'ayah-out-of-range': (set_(['complete', 0], {'ayah': 9, 'word': 1}), 'not a word of this surah'),
        'option-ayah-out-of-range': (set_(['quiz', 1, 'options', 0], {'ayah': 7}), 'not an ayah'),
        'answer-out-of-range': (set_(['quiz', 0, 'answer'], 2), 'answer must index'),
        'duplicate-options': (set_(['quiz', 1, 'options'], [{'text': 'أ'}, {'text': 'أ'}]), 'distinct'),
        'prompt-whole-ayah': (set_(['quiz', 0, 'prompt'], {'ayah': 2, 'words': 3}), 'prompt must show'),
        'typed-quran': (set_(['tafsir', 0, 'text'], 'كما قال دال ذال راء زاي'), 'consecutive words'),
        'typed-quran-diacritics': (set_(['lessons', 0, 'text'], 'دَالٌ ذَالٍ رَاءٌ زَايٌ'), 'consecutive words'),
        'typed-quran-standard-spelling': (set_(['tafsir', 0, 'text'], 'كما قال دال ذال رآء زاى'), 'consecutive words'),
        'typed-quran-uthmani-spelling': (set_(['lessons', 0, 'text'], 'قَالَ دَٰلْ ذَٱلْ رَـٰٓءْ زَاىْ'), 'consecutive words'),
        'typed-basmala': (set_(['intro', 'text'], 'نبدأ بقول بسم الله الرحمن الرحيم'), 'consecutive words'),
        'basmala-in-part-is-prose': (set_(['intro', 'text'], 'نبدأ ببسم الله'), None),
        'whole-short-ayah': (set_(['didYouKnow', 0, 'text'], 'شين صاد'), 'whole ayah'),
        'one-word-ayah-is-a-name': (set_(['intro', 'text'], 'سورة قاف تعلمنا'), None),
        'three-words-is-paraphrase': (set_(['tafsir', 0, 'text'], 'كما قال دال ذال راء'), None),
        'uthmani-marks': (set_(['intro', 'text'], 'نص ' + chr(0x671) + 'لله'), 'Uthmani-only'),
        'too-few-game-words': (set_(['complete'], [{'ayah': 1, 'word': 4}, {'ayah': 1, 'word': 4}, {'ayah': 2, 'word': 3}]), 'three distinct'),
        'approved-with-flags': (lambda c: (c['review'].update(status='approved', by='Teachers department'),
                                           c['words'][0].update(review='unsure')), 'still flagged'),
        'approved-no-reviewer': (set_(['review', 'status'], 'approved'), 'names its reviewer'),
        'approved-clean': (set_(['review'], {'status': 'approved', 'by': 'Teachers department', 'note': ''}), None),
        'empty-review-note': (set_(['words', 0, 'review'], ' '), 'non-empty note'),
        'bad-category': (set_(['quiz', 0, 'category'], 'tajweed'), 'category'),
        'extra-key': (set_(['tajweed'], []), 'keys must be'),
        'wrong-dataset': (set_(['datasetId'], 'other'), 'not the pinned'),
    }
    failed = []
    for name, (mutate, expected) in cases.items():
        c = base()
        mutate(c)
        errors = check(c, verses, 'test-1', also=BASMALA_TEST)
        ok = (not errors) if expected is None else any(expected in e for e in errors)
        if not ok:
            failed.append(f'{name}: expected {expected or "no errors"}, got {errors}')
    for f in failed:
        print(f'lesson-content selftest: FAIL {f}')
    if not failed:
        print(f'lesson-content selftest: {len(cases)} cases, each caught')
    return 1 if failed else 0


def main(argv):
    if argv[:1] == ['selftest']:
        return selftest()
    dataset_id = json.load(open(PIN, encoding='utf-8'))['datasetId']
    files = sorted(f for f in os.listdir(CONTENT) if re.fullmatch(r'surah-\d{3}\.json', f)) if os.path.isdir(CONTENT) else []
    surahs = verified_surahs() if files else {}
    failed = RASM.selftest(surahs) if files else 0  # the shared fixtures, on the real verified text
    for f in files:
        content = json.load(open(os.path.join(CONTENT, f), encoding='utf-8'))
        number = int(f[6:9])
        errors = check(content, surahs[number], dataset_id, also=surahs[1][:1]) if content.get('surah') == number else [f'surah is {content.get("surah")!r}, not {number}']
        for e in errors:
            print(f'lesson-content: {f}: {e}')
        if errors:
            failed += 1
        else:
            held = sum(1 for k in ('tafsir', 'words', 'quiz', 'lessons', 'didYouKnow') for x in content[k] if x.get('review'))
            print(f'lesson-content: {f}: every position resolves in the verified surah, no typed Quran; '
                  f'review {content["review"]["status"]}, {held} line(s) held for a teacher')
    if not files:
        print('lesson-content: no lesson content yet')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
