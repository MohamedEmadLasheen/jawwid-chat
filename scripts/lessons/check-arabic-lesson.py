#!/usr/bin/env python3
"""Check the Arabic letters lessons (PD-29 P0-5).

    python3 -I scripts/lessons/check-arabic-lesson.py            # every apps/lessons/src/arabic/lesson-NNN.json
    python3 -I scripts/lessons/check-arabic-lesson.py selftest

A lesson is units (a letter, the hamza with its seats, لا) with their forms, a
note and example words, plus a fixed quiz. Nothing derivable is stored: where a
letter sits in a word is computed by THE ONE LETTER RULE, which is the Python
twin of apps/lessons/src/arabic/letters.ts. Only marks are removed, and no
letter is folded into another (أ إ آ ٱ ا ء are six letters). The selftest runs
letters.fixture.json, the same cases the TypeScript tests run, so the two
cannot disagree. This FAILS when:
  * a word is not one written word (letters and marks, in NFC), or does not contain its unit's letter
    (for example an أ word filed under alif);
  * a reading string misses full tashkeel on the STRICT rule (every letter
    marked, the qamari lam of ال included), the audit's rule;
  * a word or unit name does not end in the one final mark, the pausal sukun
    ("finalMark": "sukun", the owner's decision of 2026-10-28). Tanween or a
    short vowel at the end is refused unless the word carries
    "finalMarkException": "<reason>";
  * a word keeps the old spelling in `was` without being flagged: a word whose
    marks the rebuild changed stays held until a teacher clears it, and
    clearing sets `review` and `was` to null;
  * a quiz question does not have exactly one right answer by the rule, or
    shows a word that is not in the lesson;
  * a reading string (a unit's name, a note, a word) has no stable id, or one
    that is not a lowercase slug or is used twice in the lesson. A voice-over
    clip binds to (id, SHA-256 of the text), so an id must never be reused;
  * the file says "approved" while anything is flagged or uncleared.
Standard library only; reads files.
"""
import json
import os
import re
import sys
import unicodedata

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ARABIC = os.path.join(ROOT, 'apps', 'lessons', 'src', 'arabic')
FIXTURE = os.path.join(ARABIC, 'letters.fixture.json')
KEYS = {'lesson', 'review', 'provenance', 'finalMark', 'units', 'quiz'}
UNIT_KEYS = {'id', 'letters', 'name', 'forms', 'note', 'words'}
POSITIONS = ['start', 'middle', 'end']
ID = re.compile(r'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')

MARKS = {chr(c) for c in range(0x64B, 0x653)} | {chr(0x670)}
SUKUN, SHADDA, DAMMA, KASRA = chr(0x652), chr(0x651), chr(0x64F), chr(0x650)
TANWEEN = {chr(0x64B), chr(0x64C), chr(0x64D)}
VOWELS = {chr(0x64E), chr(0x64F), chr(0x650)}
NO_MARK = {chr(0x627), chr(0x649), chr(0x671), chr(0x622)}  # bare alif, alif maqsura, alif wasla, alif madda
WAW, YA, LAM = chr(0x648), chr(0x64A), chr(0x644)


# --- The one letter rule (letters.ts).
def is_mark(ch):
    return ch in MARKS


def is_letter(ch):
    c = ord(ch)
    return (0x621 <= c <= 0x64A and c != 0x640) or c == 0x671


def is_word(w):
    """One written word, in NFC (marks in canonical order) so its text hash, the voice-over binding, is stable."""
    return isinstance(w, str) and len(w) > 0 and w == unicodedata.normalize('NFC', w) and is_letter(w[0]) and all(is_letter(c) or is_mark(c) for c in w)


def letters_of(w):
    return [c for c in w if is_letter(c)]


def occurrences(w, unit_letters):
    ls = letters_of(w)
    out = []
    for entry in unit_letters:
        seq = list(entry)
        for i in range(len(ls) - len(seq) + 1):
            if ls[i:i + len(seq)] == seq:
                out.append((i, len(seq)))
    return sorted(out)


def has(w, unit_letters):
    return bool(occurrences(w, unit_letters))


def positions(w, unit_letters):
    n = len(letters_of(w))
    found = {'start' if at == 0 else 'end' if at + length == n else 'middle' for at, length in occurrences(w, unit_letters)}
    return [p for p in POSITIONS if p in found]


# --- Full tashkeel (the audit's STRICT rule, tashkeel_coverage.py) and the one final mark.
def letters_marks(w):
    out = []
    for c in w:
        if is_letter(c):
            out.append((c, set()))
        elif out and is_mark(c):
            out[-1][1].add(c)
    return out


def unmarked(w):
    """The letters of one word that need a mark and have none (STRICT: the final letter and the qamari lam too)."""
    ls = letters_marks(w)
    base = ''.join(c for c, _ in ls)
    m = re.match('^(?:[' + WAW + chr(0x641) + chr(0x628) + chr(0x643) + ']?' + chr(0x627) + LAM + '|' + LAM + LAM + ')', base)
    al_lam = m.end() - 1 if m and len(base) > m.end() else None
    missing = []
    for k, (c, mk) in enumerate(ls):
        if mk:
            continue
        madd = k > 0 and ((c == WAW and DAMMA in ls[k - 1][1]) or (c == YA and KASRA in ls[k - 1][1]))
        shamsi = k == al_lam and k + 1 < len(ls) and SHADDA in ls[k + 1][1]
        if c in NO_MARK or madd or shamsi:
            continue
        missing.append(f'letter {k + 1} ({c})')
    return missing


def bad_ending(w):
    """None when the word ends the pausal way (a sukun, or a letter that takes no mark); else what it ends with."""
    ls = letters_marks(w)
    c, mk = ls[-1]
    if not mk and (c in NO_MARK or (len(ls) > 1 and ((c == WAW and DAMMA in ls[-2][1]) or (c == YA and KASRA in ls[-2][1])))):
        return None
    if mk & TANWEEN:
        return 'tanween'
    if mk & VOWELS:
        return 'a short vowel'
    if SUKUN not in mk:
        return 'no sukun'
    return None


def tashkeel(where, w, err, exception=None):
    gaps = unmarked(w)
    if gaps:
        err(f'{where}: {w!r} is not fully vowelled ({", ".join(gaps)} unmarked)')
    end = bad_ending(w)
    if end and not exception:
        err(f'{where}: {w!r} ends with {end}, not the pausal sukun (the one final mark; set finalMarkException to keep it)')


def check(lesson, number):
    errors = []
    err = errors.append
    if set(lesson) != KEYS:
        err(f'keys must be {sorted(KEYS)}, not {sorted(lesson)}')
        return errors
    if lesson['lesson'] != number:
        err(f'lesson is {lesson["lesson"]!r}, not {number}')
    if lesson['finalMark'] != 'sukun':
        err(f'finalMark must be "sukun" (the owner\'s decision of 2026-10-28), not {lesson["finalMark"]!r}')
    review = lesson['review']
    if not isinstance(review, dict) or review.get('status') not in ('pending', 'approved'):
        err('review.status must be pending or approved')
        return errors
    flagged = []

    def note_ok(where, r):
        if r is not None and (not isinstance(r, str) or not r.strip()):
            err(f'{where}: review must be null or a non-empty note')
        if r:
            flagged.append(where)

    units, vocabulary, string_ids = {}, set(), set()

    def fresh(where, sid):
        if not isinstance(sid, str) or not ID.match(sid):
            err(f'{where}: id {sid!r} must be a lowercase slug (ba-w1, alif-note): voice-over binds to it')
        elif sid in string_ids:
            err(f'{where}: id {sid!r} is used twice in the lesson (ids are never reused)')
        string_ids.add(sid)

    for i, u in enumerate(lesson['units']):
        where = f'unit {u.get("id", i)!r}'
        if set(u) != UNIT_KEYS:
            err(f'{where}: keys must be {sorted(UNIT_KEYS)}')
            continue
        fresh(where, u['id'])
        if not u['letters'] or not all(isinstance(l, str) and l and all(is_letter(c) for c in l) for l in u['letters']):
            err(f'{where}: letters must be letters (one, or a pair such as لا)')
            continue
        units[u['id']] = u
        if not is_word(u['name']):
            err(f'{where}: name {u["name"]!r} is not one written word')
        else:
            tashkeel(f'{where} name', u['name'], err)
        if not u['forms'] or not all(isinstance(f, str) and f and all(c == chr(0x640) or any(c in l for l in u['letters']) for c in f) for f in u['forms']):
            err(f'{where}: each form is the unit\'s letter, with tatweel only')
        if u['note'] is not None:
            fresh(f'{where} note', u['note'].get('id'))
            if not isinstance(u['note'].get('text'), str) or not u['note']['text'].strip():
                err(f'{where}: a note has text')
            else:
                for token in re.findall('[' + chr(0x621) + '-' + chr(0x652) + chr(0x670) + chr(0x671) + ']+', u['note']['text']):
                    if unmarked(token):
                        err(f'{where} note: {token!r} is not fully vowelled ({", ".join(unmarked(token))} unmarked)')
            note_ok(f'{where} note', u['note'].get('review'))
        seen = set()
        for w in u['words']:
            t = w.get('text')
            ww = f'{where} word {t!r}'
            if set(w) - {'id', 'text', 'was', 'review', 'finalMarkException'} or not {'id', 'text', 'was', 'review'} <= set(w):
                err(f'{ww}: keys are id, text, was, review (and finalMarkException)')
                continue
            fresh(ww, w['id'])
            if not is_word(t):
                err(f'{ww}: not one written word')
                continue
            if t in seen:
                err(f'{ww}: listed twice')
            seen.add(t)
            vocabulary.add(t)
            if not has(t, u['letters']):
                err(f'{ww}: does not contain the unit\'s letter {"/".join(u["letters"])} (by the one rule: only marks are removed)')
            exc = w.get('finalMarkException')
            if 'finalMarkException' in w and (not isinstance(exc, str) or not exc.strip()):
                err(f'{ww}: finalMarkException needs a reason')
            tashkeel(ww, t, err, exc)
            note_ok(ww, w['review'])
            if w['was'] is not None:
                if w['was'] == t:
                    err(f'{ww}: was equals text (clearing a word sets was to null)')
                if not w['review']:
                    err(f'{ww}: changed from {w["was"]!r} but not held (a teacher clears it: review and was to null)')

    ids = set()
    for q in lesson['quiz']:
        where = f'quiz {q.get("id")}'
        if not isinstance(q.get('id'), str) or not q['id'] or q['id'] in ids:
            err(f'{where}: quiz ids must be unique')
        ids.add(q.get('id'))
        unit = units.get(q.get('unit'))
        if unit is None:
            err(f'{where}: no unit {q.get("unit")!r}')
            continue
        note_ok(where, q.get('review'))
        if q.get('kind') == 'contains':
            opts = q.get('options')
            if not isinstance(opts, list) or not 2 <= len(opts) <= 4 or len(set(opts)) != len(opts):
                err(f'{where}: 2-4 distinct options')
                continue
            for o in opts:
                if o not in vocabulary:
                    err(f'{where}: option {o!r} is not a word of this lesson')
            right = [i for i, o in enumerate(opts) if has(o, unit['letters'])]
            if right != [q.get('answer')]:
                err(f'{where}: must have exactly one right answer, the answer; by the one rule the right ones are {right}')
        elif q.get('kind') == 'position':
            if q.get('word') not in vocabulary:
                err(f'{where}: {q.get("word")!r} is not a word of this lesson')
            at = positions(q.get('word') or '', unit['letters'])
            if at != [q.get('answer')]:
                err(f'{where}: the letter must be in exactly one place, the answer; by the one rule it is {at}')
        else:
            err(f'{where}: kind must be contains or position')

    if review['status'] == 'approved':
        if not isinstance(review.get('by'), str) or not review['by'].strip():
            err('review: an approved lesson names its reviewer')
        if flagged:
            err(f'review: approved while {len(flagged)} item(s) are still flagged or uncleared ({", ".join(flagged[:3])}...)')
    return errors


def fixture_failures():
    fx = json.load(open(FIXTURE, encoding='utf-8'))
    out = []
    for c in fx['cases']:
        letters = fx['units'][c['unit']]
        if has(c['word'], letters) != c['has'] or positions(c['word'], letters) != c['positions']:
            out.append(f'fixture {c["word"]} / {c["unit"]}: got {has(c["word"], letters)}, {positions(c["word"], letters)}')
    return out, len(fx['cases'])


def selftest():
    def base():
        return {
            'lesson': 1, 'review': {'status': 'pending', 'by': None, 'note': ''}, 'provenance': {}, 'finalMark': 'sukun',
            'units': [
                {'id': 'alif', 'letters': [chr(0x627)], 'name': 'أَلِفْ', 'forms': ['ا', 'ـا'],
                 'note': {'id': 'alif-note', 'text': 'لَا تَبْدَأُ كَلِمَةٌ بِأَلِفٍ.', 'review': 'AUTHORED'},
                 'words': [{'id': 'alif-w1', 'text': 'كِتَابْ', 'was': None, 'review': None},
                           {'id': 'alif-w2', 'text': 'عَصَا', 'was': None, 'review': None},
                           {'id': 'alif-w3', 'text': 'بَابْ', 'was': 'بَاب', 'review': 'ADDED TASHKEEL: final sukun'}]},
                {'id': 'hamza', 'letters': ['ء', 'أ', 'إ', 'ؤ', 'ئ'], 'name': 'هَمْزَةْ', 'forms': ['ء', 'أ', 'إ', 'ؤ', 'ئ'],
                 'note': None,
                 'words': [{'id': 'hamza-w1', 'text': 'أَسَدْ', 'was': None, 'review': None},
                           {'id': 'hamza-w2', 'text': 'جُزْءْ', 'was': None, 'review': None}]},
                {'id': 'ba', 'letters': ['ب'], 'name': 'بَاءْ', 'forms': ['ب', 'بـ', 'ـبـ', 'ـب'], 'note': None,
                 'words': [{'id': 'ba-w1', 'text': 'الْبَحْرْ', 'was': None, 'review': None},
                           {'id': 'ba-w2', 'text': 'الشَّبَابْ', 'was': None, 'review': None}]},
            ],
            'quiz': [
                {'id': 'q1', 'kind': 'contains', 'unit': 'alif', 'options': ['أَسَدْ', 'كِتَابْ', 'جُزْءْ'], 'answer': 1, 'review': None},
                {'id': 'q2', 'kind': 'position', 'unit': 'hamza', 'word': 'جُزْءْ', 'answer': 'end', 'review': None},
            ],
        }

    def word(unit, k, **kw):
        return lambda c: c['units'][unit]['words'][k].update(kw)

    def approve(c):
        c['review'].update(status='approved', by='Teachers department')
        c['units'][0]['note']['review'] = None
        c['units'][0]['words'][2].update(was=None, review=None)

    cases = {
        'clean': (lambda c: None, None),
        'alif-start-is-hamza': (lambda c: c['units'][0]['words'].append({'id': 'alif-w8', 'text': 'أَسَدْ', 'was': None, 'review': None}), 'does not contain'),
        'madda-is-not-alif': (lambda c: c['units'][0]['words'].append({'id': 'alif-w9', 'text': 'آدَمْ', 'was': None, 'review': None}), 'does not contain'),
        'not-a-word': (word(0, 0, text='كِتَابْ بَابْ'), 'not one written word'),
        'not-nfc': (word(2, 1, text='الش' + chr(0x651) + chr(0x64E) + 'بَابْ'), 'not one written word'),
        'listed-twice': (lambda c: c['units'][1]['words'].append({'id': 'hamza-w9', 'text': 'جُزْءْ', 'was': None, 'review': None}), 'listed twice'),
        'word-id-reused': (word(0, 1, id='alif-w1'), 'used twice'),
        'note-takes-a-word-id': (lambda c: c['units'][0]['note'].update(id='hamza-w1'), 'used twice'),
        'unit-id-is-a-word-id': (lambda c: c['units'][2].update(id='alif-w1'), 'used twice'),
        'id-not-a-slug': (word(1, 0, id='Hamza 1'), 'lowercase slug'),
        'word-without-id': (lambda c: c['units'][1]['words'][0].pop('id'), 'keys are id'),
        'no-final-mark': (word(0, 0, text='كِتَاب'), 'no sukun'),
        'tanween-final': (word(0, 0, text='كِتَابٌ'), 'tanween'),
        'vowel-final': (word(0, 0, text='كِتَابُ'), 'a short vowel'),
        'exception-keeps-tanween': (word(2, 0, text='بَحْرٌ', finalMarkException='a fixed expression'), None),
        'exception-needs-reason': (word(2, 0, text='بَحْرٌ', finalMarkException=' '), 'needs a reason'),
        'internal-mark-missing': (word(0, 0, text='كتَابْ'), 'not fully vowelled'),
        'qamari-lam-unmarked': (word(2, 0, text='البَحْرْ'), 'not fully vowelled'),
        'shamsi-lam-is-fine': (lambda c: None, None),
        'unit-name-tanween': (lambda c: c['units'][2].update(name='بَاءٌ'), 'tanween'),
        'note-unvowelled': (lambda c: c['units'][0]['note'].update(text='لا تبدأ كلمة بألف.'), 'note'),
        'was-not-held': (word(0, 2, review=None), 'not held'),
        'was-equals-text': (word(0, 2, was='بَابْ'), 'was equals text'),
        'two-right-answers': (lambda c: c['quiz'][0].update(options=['كِتَابْ', 'عَصَا'], answer=0), 'exactly one right answer'),
        'answer-not-the-right-one': (lambda c: c['quiz'][0].update(answer=0), 'exactly one right answer'),
        'option-outside-lesson': (lambda c: c['quiz'][0].update(options=['أَسَدْ', 'كِتَابْ', 'قَلَمْ']), 'not a word of this lesson'),
        'position-twice': (lambda c: c['quiz'][1].update(unit='ba', word='بَابْ', answer='start'), 'exactly one place'),
        'position-wrong': (lambda c: c['quiz'][1].update(answer='start'), 'exactly one place'),
        'quiz-unknown-unit': (lambda c: c['quiz'][1].update(unit='nope'), 'no unit'),
        'quiz-duplicate-id': (lambda c: c['quiz'][1].update(id='q1'), 'unique'),
        'quiz-bad-kind': (lambda c: c['quiz'][1].update(kind='order'), 'kind must be'),
        'unit-duplicate-id': (lambda c: c['units'][1].update(id='alif'), 'used twice'),
        'form-not-the-letter': (lambda c: c['units'][2].update(forms=['ت']), 'each form'),
        'final-mark-tanween': (lambda c: c.update(finalMark='tanween'), 'finalMark must be'),
        'approved-with-flags': (lambda c: c['review'].update(status='approved', by='Teachers department'), 'still flagged'),
        'approved-no-reviewer': (lambda c: (approve(c), c['review'].update(by=None)), 'names its reviewer'),
        'approved-clean': (approve, None),
        'empty-review-note': (word(0, 0, review=' '), 'non-empty note'),
        'extra-key': (lambda c: c.update(games=[]), 'keys must be'),
    }
    failed = []
    for name, (mutate, expected) in cases.items():
        c = base()
        mutate(c)
        errors = check(c, 1)
        ok = (not errors) if expected is None else any(expected in e for e in errors)
        if not ok:
            failed.append(f'{name}: expected {expected or "no errors"}, got {errors}')
    fx_failed, fx_count = fixture_failures()
    failed += fx_failed
    for f in failed:
        print(f'arabic-lesson selftest: FAIL {f}')
    if not failed:
        print(f'arabic-lesson selftest: {len(cases)} cases, each caught; the shared letter fixture ({fx_count} cases) agrees with letters.ts')
    return 1 if failed else 0


def main(argv):
    if argv[:1] == ['selftest']:
        return selftest()
    files = sorted(f for f in os.listdir(ARABIC) if re.fullmatch(r'lesson-\d{3}\.json', f)) if os.path.isdir(ARABIC) else []
    failed = 0
    for f in files:
        lesson = json.load(open(os.path.join(ARABIC, f), encoding='utf-8'))
        errors = check(lesson, int(f[7:10]))
        for e in errors:
            print(f'arabic-lesson: {f}: {e}')
        if errors:
            failed += 1
        else:
            held = sum(1 for u in lesson['units'] for w in u['words'] if w['review']) + \
                sum(1 for u in lesson['units'] if u['note'] and u['note']['review']) + sum(1 for q in lesson['quiz'] if q['review'])
            print(f'arabic-lesson: {f}: every word holds its letter by the one rule, full tashkeel with the pausal sukun, '
                  f'every question has one right answer; review {lesson["review"]["status"]}, {held} item(s) held for a teacher')
    if not files:
        print('arabic-lesson: no Arabic lesson files yet')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
