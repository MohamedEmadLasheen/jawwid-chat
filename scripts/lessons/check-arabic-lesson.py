#!/usr/bin/env python3
"""Check the Arabic letters lessons (PD-29 P0-5).

    python3 -I scripts/lessons/check-arabic-lesson.py            # every apps/lessons/src/arabic/lesson-NNN.json
    python3 -I scripts/lessons/check-arabic-lesson.py selftest

A lesson is units (a letter, the hamza with its seats, لا) with their forms, a
note and example words, plus a fixed quiz. Nothing derivable is stored: where a
letter sits in a word is computed by THE ONE LETTER RULE, which is the Python
twin of apps/lessons/src/arabic/letters.ts. Only marks are removed, and no
letter is folded into another (أ إ آ ٱ ا ء are six letters). The selftest runs
letters.fixture.json, the same cases the TypeScript tests run (the letter rule,
which characters are marks and letters, what is one written word), so the two
cannot disagree. This FAILS when:
  * a word is not one written word (letters and marks only, in NFC), or does
    not contain its unit's letter (for example an أ word filed under alif);
  * a reading string misses full tashkeel on the STRICT rule (every letter
    marked, the qamari lam of ال included), the audit's rule;
  * a word or unit name does not end in the one final mark, the pausal sukun
    ("finalMark": "sukun", the owner's decision of 2026-10-28). Tanween or a
    short vowel at the end is refused, including tanween carried by the letter
    before a final bare ا or ى (كِتَابًا, هُدًى). A final letter that carries only
    a dagger alif (عَلَىٰ) is refused too (fail closed). The way past is
    "finalMarkException": "<reason>", and such a word stays HELD until the
    file is approved;
  * a word keeps the old spelling in `was` without being flagged: a word whose
    marks the rebuild changed stays held until a teacher clears it, and
    clearing sets `review` and `was` to null;
  * a word's id is not `<its unit id>-NNN`, is used twice, or is in
    `retiredIds` (PD-48 voice-over binds a clip to it; a removed word's id is
    never reused). Unit ids are slugs without hyphens; a unit's name and note
    ids are derived (`<unit>.name`, `<unit>.note`);
  * a quiz question does not have exactly one right answer by the rule, shows
    a word that is not in the lesson, or has an answer of the wrong type (a
    boolean is not an index);
  * any other .json sits in apps/lessons/src/arabic/ (a misnamed lesson file
    would otherwise skip every check);
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
FIXTURE_NAME = 'letters.fixture.json'
FIXTURE = os.path.join(ARABIC, FIXTURE_NAME)
LESSON_FILE = re.compile(r'lesson-\d{3}\.json')
KEYS = {'lesson', 'review', 'provenance', 'finalMark', 'retiredIds', 'units', 'quiz'}
UNIT_KEYS = {'id', 'letters', 'name', 'forms', 'note', 'words'}
WORD_KEYS = {'id', 'text', 'was', 'review'}
POSITIONS = ['start', 'middle', 'end']
UNIT_ID = re.compile(r'^[a-z][a-z0-9_]*$')
WORD_ID = re.compile(r'^[a-z][a-z0-9_]*-[0-9]{3}$')

MARKS = {chr(c) for c in range(0x64B, 0x653)} | {chr(0x670)}
SUKUN, SHADDA, DAMMA, KASRA = chr(0x652), chr(0x651), chr(0x64F), chr(0x650)
TANWEEN = {chr(0x64B), chr(0x64C), chr(0x64D)}
VOWELS = {chr(0x64E), chr(0x64F), chr(0x650)}
NO_MARK = {chr(0x627), chr(0x649), chr(0x671), chr(0x622)}  # bare alif, alif maqsura, alif wasla, alif madda
WAW, YA, LAM = chr(0x648), chr(0x64A), chr(0x644)


def is_str(x):
    return isinstance(x, str)


def is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)  # bool is a subclass of int; TS refuses true as an index


# --- The one letter rule (letters.ts).
def is_mark(ch):
    return ch in MARKS


def is_letter(ch):
    c = ord(ch)
    return (0x621 <= c <= 0x64A and c != 0x640) or c == 0x671


def is_word(w):
    """One written word: letters and marks only, starting with a letter, in NFC (so its text hash is stable)."""
    return is_str(w) and len(w) > 0 and w == unicodedata.normalize('NFC', w) and is_letter(w[0]) and all(is_letter(c) or is_mark(c) for c in w)


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
    """None when the word ends the pausal way; else what it ends with."""
    ls = letters_marks(w)
    c, mk = ls[-1]
    before = ls[-2][1] if len(ls) > 1 else set()
    if not mk and c in (chr(0x627), chr(0x649)) and before & TANWEEN:
        return 'tanween'  # كِتَابًا, هُدًى: the tanween sits on the letter before the bare alif or alif maqsura
    if not mk and (c in NO_MARK or (c == WAW and DAMMA in before) or (c == YA and KASRA in before)):
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
    if not isinstance(lesson, dict) or set(lesson) != KEYS:
        err(f'keys must be {sorted(KEYS)}, not {sorted(lesson) if isinstance(lesson, dict) else type(lesson).__name__}')
        return errors
    if not is_int(lesson['lesson']) or lesson['lesson'] != number:
        err(f'lesson is {lesson["lesson"]!r}, not {number}')
    if lesson['finalMark'] != 'sukun':
        err(f'finalMark must be "sukun" (the owner\'s decision of 2026-10-28), not {lesson["finalMark"]!r}')
    review = lesson['review']
    if not isinstance(review, dict) or review.get('status') not in ('pending', 'approved'):
        err('review.status must be pending or approved')
        return errors
    approved = review['status'] == 'approved'
    retired = lesson['retiredIds']
    if not isinstance(retired, list) or not all(is_str(r) and WORD_ID.match(r) for r in retired):
        err('retiredIds must be a list of word ids (<unit>-NNN)')
        retired = []
    retired = set(retired)
    if not isinstance(lesson['units'], list) or not isinstance(lesson['quiz'], list):
        err('units and quiz must be lists')
        return errors
    flagged = []

    def note_ok(where, r):
        if r is not None and (not is_str(r) or not r.strip()):
            err(f'{where}: review must be null or a non-empty note')
        if r:
            flagged.append(where)

    units, vocabulary, word_ids = {}, set(), set()
    for i, u in enumerate(lesson['units']):
        where = f'unit {u.get("id", i)!r}' if isinstance(u, dict) else f'unit {i}'
        if not isinstance(u, dict) or set(u) != UNIT_KEYS:
            err(f'{where}: keys must be {sorted(UNIT_KEYS)}')
            continue
        if not is_str(u['id']) or not UNIT_ID.match(u['id']):
            err(f'{where}: a unit id is a lowercase slug without hyphens (ba, lam_alif)')
            continue
        if u['id'] in units:
            err(f'{where}: unit ids are unique')
        if not isinstance(u['letters'], list) or not u['letters'] or not all(is_str(l) and l and all(is_letter(c) for c in l) for l in u['letters']):
            err(f'{where}: letters must be a list of letters (one, or a pair such as لا)')
            continue
        units[u['id']] = u
        if not is_word(u['name']):
            err(f'{where}: name {u["name"]!r} is not one written word')
        else:
            tashkeel(f'{where} name', u['name'], err)
        if not isinstance(u['forms'], list) or not u['forms'] or not all(is_str(f) and f and all(c == chr(0x640) or any(c in l for l in u['letters']) for c in f) for f in u['forms']):
            err(f'{where}: each form is the unit\'s letter, with tatweel only')
        if u['note'] is not None:
            if not isinstance(u['note'], dict) or set(u['note']) != {'text', 'review'}:
                err(f'{where}: a note is {{text, review}} (its id is derived: {u["id"]}.note)')
            elif not is_str(u['note']['text']) or not u['note']['text'].strip():
                err(f'{where}: a note has text')
            else:
                if u['note']['text'] != unicodedata.normalize('NFC', u['note']['text']):
                    err(f'{where} note: not NFC')
                for token in re.findall('[' + chr(0x621) + '-' + chr(0x652) + chr(0x670) + chr(0x671) + ']+', u['note']['text']):
                    if unmarked(token):
                        err(f'{where} note: {token!r} is not fully vowelled ({", ".join(unmarked(token))} unmarked)')
                note_ok(f'{where} note', u['note']['review'])
        if not isinstance(u['words'], list):
            err(f'{where}: words must be a list')
            continue
        seen = set()
        for w in u['words']:
            t = w.get('text') if isinstance(w, dict) else None
            ww = f'{where} word {t!r}'
            if not isinstance(w, dict) or set(w) - (WORD_KEYS | {'finalMarkException'}) or not WORD_KEYS <= set(w):
                err(f'{ww}: keys are id, text, was, review (and finalMarkException)')
                continue
            wid = w['id']
            if not is_str(wid) or not WORD_ID.match(wid) or wid[:-4] != u['id']:
                err(f'{ww}: id {wid!r} must be {u["id"]}-NNN (PD-48 voice-over binds a clip to it)')
            elif wid in word_ids:
                err(f'{ww}: id {wid!r} is used twice (ids are never reused)')
            elif wid in retired:
                err(f'{ww}: id {wid!r} is retired (a removed word\'s id is never reused)')
            word_ids.add(wid)
            if not is_word(t):
                err(f'{ww}: not one written word (letters and marks, in NFC)')
                continue
            if t in seen:
                err(f'{ww}: listed twice')
            seen.add(t)
            vocabulary.add(t)
            if not has(t, u['letters']):
                err(f'{ww}: does not contain the unit\'s letter {"/".join(u["letters"])} (by the one rule: only marks are removed)')
            exc = w.get('finalMarkException')
            if 'finalMarkException' in w:
                if not is_str(exc) or not exc.strip():
                    err(f'{ww}: finalMarkException needs a reason')
                elif not w['review'] and not approved:
                    err(f'{ww}: a finalMarkException stays held (review set) until the file is approved')
            tashkeel(ww, t, err, exc)
            note_ok(ww, w['review'])
            if w['was'] is not None:
                if not is_str(w['was']):
                    err(f'{ww}: was is the old spelling, or null')
                elif w['was'] == t:
                    err(f'{ww}: was equals text (clearing a word sets was to null)')
                if not w['review']:
                    err(f'{ww}: changed from {w["was"]!r} but not held (a teacher clears it: review and was to null)')

    ids = set()
    for q in lesson['quiz']:
        if not isinstance(q, dict):
            err('a quiz question is an object')
            continue
        where = f'quiz {q.get("id")}'
        if not is_str(q.get('id')) or not q['id'] or q['id'] in ids:
            err(f'{where}: quiz ids must be unique')
        ids.add(q.get('id'))
        unit = units.get(q.get('unit'))
        if unit is None:
            err(f'{where}: no unit {q.get("unit")!r}')
            continue
        note_ok(where, q.get('review'))
        if q.get('kind') == 'contains':
            opts = q.get('options')
            if not isinstance(opts, list) or not 2 <= len(opts) <= 4 or not all(is_str(o) for o in opts) or len(set(opts)) != len(opts):
                err(f'{where}: 2-4 distinct options')
                continue
            for o in opts:
                if o not in vocabulary:
                    err(f'{where}: option {o!r} is not a word of this lesson')
            right = [i for i, o in enumerate(opts) if has(o, unit['letters'])]
            if not is_int(q.get('answer')) or right != [q['answer']]:
                err(f'{where}: must have exactly one right answer, the answer (an index); by the one rule the right ones are {right}')
        elif q.get('kind') == 'position':
            word = q.get('word')
            if not is_str(word) or word not in vocabulary:
                err(f'{where}: {word!r} is not a word of this lesson')
                continue
            at = positions(word, unit['letters'])
            if not is_str(q.get('answer')) or at != [q['answer']]:
                err(f'{where}: the letter must be in exactly one place, the answer; by the one rule it is {at}')
        else:
            err(f'{where}: kind must be contains or position')

    if approved:
        if not is_str(review.get('by')) or not review['by'].strip():
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
    for m in fx['marks']:
        if is_mark(chr(m['cp'])) != m['isMark']:
            out.append(f'fixture mark U+{m["cp"]:04X} ({m["note"]}): is_mark disagrees')
    for l in fx['letters']:
        if is_letter(chr(l['cp'])) != l['isLetter']:
            out.append(f'fixture letter U+{l["cp"]:04X} ({l["note"]}): is_letter disagrees')
    for w in fx['words']:
        t = ''.join(map(chr, w['cps'])) if 'cps' in w else w['text']
        if is_word(t) != w['isWord']:
            out.append(f'fixture word {t!r} ({w.get("note", "")}): is_word disagrees')
    return out, len(fx['cases']) + len(fx['marks']) + len(fx['letters']) + len(fx['words'])


def selftest():
    def base():
        return {
            'lesson': 1, 'review': {'status': 'pending', 'by': None, 'note': ''}, 'provenance': {}, 'finalMark': 'sukun',
            'retiredIds': ['alif-009'],
            'units': [
                {'id': 'alif', 'letters': [chr(0x627)], 'name': 'أَلِفْ', 'forms': ['ا', 'ـا'],
                 'note': {'text': 'لَا تَبْدَأُ كَلِمَةٌ بِأَلِفٍ.', 'review': 'AUTHORED'},
                 'words': [{'id': 'alif-001', 'text': 'كِتَابْ', 'was': None, 'review': None},
                           {'id': 'alif-002', 'text': 'عَصَا', 'was': None, 'review': None},
                           {'id': 'alif-003', 'text': 'بَابْ', 'was': 'بَاب', 'review': 'ADDED TASHKEEL: final sukun'}]},
                {'id': 'hamza', 'letters': ['ء', 'أ', 'إ', 'ؤ', 'ئ'], 'name': 'هَمْزَةْ', 'forms': ['ء', 'أ', 'إ', 'ؤ', 'ئ'],
                 'note': None,
                 'words': [{'id': 'hamza-001', 'text': 'أَسَدْ', 'was': None, 'review': None},
                           {'id': 'hamza-002', 'text': 'جُزْءْ', 'was': None, 'review': None}]},
                {'id': 'ba', 'letters': ['ب'], 'name': 'بَاءْ', 'forms': ['ب', 'بـ', 'ـبـ', 'ـب'], 'note': None,
                 'words': [{'id': 'ba-001', 'text': 'الْبَحْرْ', 'was': None, 'review': None},
                           {'id': 'ba-002', 'text': 'الشَّبَابْ', 'was': None, 'review': None}]},
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
        'alif-start-is-hamza': (lambda c: c['units'][0]['words'].append({'id': 'alif-007', 'text': 'أَسَدْ', 'was': None, 'review': None}), 'does not contain'),
        'madda-is-not-alif': (lambda c: c['units'][0]['words'].append({'id': 'alif-008', 'text': 'آدَمْ', 'was': None, 'review': None}), 'does not contain'),
        'not-a-word': (word(0, 0, text='كِتَابْ بَابْ'), 'not one written word'),
        'not-nfc': (word(2, 1, text='الش' + chr(0x651) + chr(0x64E) + 'بَابْ'), 'not one written word'),
        'listed-twice': (lambda c: c['units'][1]['words'].append({'id': 'hamza-003', 'text': 'جُزْءْ', 'was': None, 'review': None}), 'listed twice'),
        'word-id-reused': (word(0, 1, id='alif-001'), 'used twice'),
        'word-id-retired': (word(0, 1, id='alif-009'), 'retired'),
        'word-id-other-unit': (word(0, 1, id='hamza-005'), 'must be alif-NNN'),
        'word-id-not-three-digits': (word(1, 0, id='hamza-1'), 'must be hamza-NNN'),
        'word-without-id': (lambda c: c['units'][1]['words'][0].pop('id'), 'keys are id'),
        'retired-not-word-ids': (lambda c: c.update(retiredIds=['Alif 9']), 'retiredIds'),
        'unit-id-with-hyphen': (lambda c: c['units'][2].update(id='lam-alif'), 'without hyphens'),
        'note-with-id-key': (lambda c: c['units'][0]['note'].update(id='alif-note'), 'its id is derived'),
        'note-text-not-a-string': (lambda c: c['units'][0]['note'].update(text=42), 'a note has text'),
        'letters-a-plain-string': (lambda c: c['units'][2].update(letters='ب'), 'a list of letters'),
        'no-final-mark': (word(0, 0, text='كِتَاب'), 'no sukun'),
        'tanween-final': (word(0, 0, text='كِتَابٌ'), 'tanween'),
        'tanween-before-final-alif': (word(0, 1, text='كِتَابًا'), 'tanween'),
        'tanween-before-final-maqsura': (lambda c: c['units'][0]['words'].append({'id': 'alif-004', 'text': 'هُدًى', 'was': None, 'review': None}), 'tanween'),
        'vowel-final': (word(0, 0, text='كِتَابُ'), 'a short vowel'),
        'dagger-alif-final-fails-closed': (lambda c: c['units'][0]['words'].append({'id': 'alif-005', 'text': 'عَلَىٰ', 'was': None, 'review': None}), 'no sukun'),
        'exception-must-be-held': (word(2, 0, text='بَحْرٌ', finalMarkException='a fixed expression'), 'stays held'),
        'exception-held': (word(2, 0, text='بَحْرٌ', finalMarkException='a fixed expression', review='FINAL MARK EXCEPTION'), None),
        'exception-approved': (lambda c: (approve(c), c['units'][2]['words'][0].update(text='بَحْرٌ', finalMarkException='a fixed expression')), None),
        'exception-needs-reason': (word(2, 0, text='بَحْرٌ', finalMarkException=' ', review='x'), 'needs a reason'),
        'internal-mark-missing': (word(0, 0, text='كتَابْ'), 'not fully vowelled'),
        'qamari-lam-unmarked': (word(2, 0, text='البَحْرْ'), 'not fully vowelled'),
        'unit-name-tanween': (lambda c: c['units'][2].update(name='بَاءٌ'), 'tanween'),
        'note-unvowelled': (lambda c: c['units'][0]['note'].update(text='لا تبدأ كلمة بألف.'), 'note'),
        'was-not-held': (word(0, 2, review=None), 'not held'),
        'was-equals-text': (word(0, 2, was='بَابْ'), 'was equals text'),
        'two-right-answers': (lambda c: c['quiz'][0].update(options=['كِتَابْ', 'عَصَا'], answer=0), 'exactly one right answer'),
        'answer-not-the-right-one': (lambda c: c['quiz'][0].update(answer=0), 'exactly one right answer'),
        'answer-a-boolean': (lambda c: c['quiz'][0].update(options=['كِتَابْ', 'أَسَدْ'], answer=True), 'exactly one right answer'),
        'option-outside-lesson': (lambda c: c['quiz'][0].update(options=['أَسَدْ', 'كِتَابْ', 'قَلَمْ']), 'not a word of this lesson'),
        'position-twice': (lambda c: c['quiz'][1].update(unit='ba', word='بَابْ', answer='start'), 'exactly one place'),
        'position-wrong': (lambda c: c['quiz'][1].update(answer='start'), 'exactly one place'),
        'quiz-unknown-unit': (lambda c: c['quiz'][1].update(unit='nope'), 'no unit'),
        'quiz-duplicate-id': (lambda c: c['quiz'][1].update(id='q1'), 'unique'),
        'quiz-bad-kind': (lambda c: c['quiz'][1].update(kind='order'), 'kind must be'),
        'unit-duplicate-id': (lambda c: c['units'][1].update(id='alif'), 'unique'),
        'form-not-the-letter': (lambda c: c['units'][2].update(forms=['ت']), 'each form'),
        'final-mark-tanween': (lambda c: c.update(finalMark='tanween'), 'finalMark must be'),
        'lesson-number-a-boolean': (lambda c: c.update(lesson=True), 'lesson is'),
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
    # A misnamed lesson file is refused, not skipped.
    if not stray_files(['lesson-001.json', FIXTURE_NAME, 'lesson-1.json', 'notes.json', 'index.ts']) == ['lesson-1.json', 'notes.json']:
        failed.append('stray-json: a misnamed .json is not refused')
    fx_failed, fx_count = fixture_failures()
    failed += fx_failed
    for f in failed:
        print(f'arabic-lesson selftest: FAIL {f}')
    if not failed:
        print(f'arabic-lesson selftest: {len(cases) + 1} cases, each caught; the shared letter fixture ({fx_count} cases) agrees with letters.ts')
    return 1 if failed else 0


def stray_files(names):
    """Every .json in arabic/ that is neither a lesson file nor the shared fixture."""
    return sorted(f for f in names if f.endswith('.json') and f != FIXTURE_NAME and not LESSON_FILE.fullmatch(f))


def main(argv):
    if argv[:1] == ['selftest']:
        return selftest()
    names = os.listdir(ARABIC) if os.path.isdir(ARABIC) else []
    failed = 0
    for f in stray_files(names):
        print(f'arabic-lesson: {f}: not a lesson file (lesson-NNN.json) and not {FIXTURE_NAME}; a misnamed lesson would skip every check')
        failed += 1
    files = sorted(f for f in names if LESSON_FILE.fullmatch(f))
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
    if not files and not failed:
        print('arabic-lesson: no Arabic lesson files yet')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
