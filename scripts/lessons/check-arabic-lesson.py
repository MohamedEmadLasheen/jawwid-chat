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
import importlib.util
import json
import os
import re
import sys
import unicodedata

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('rasm', os.path.join(HERE, 'rasm.py'))
RASM = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(RASM)  # the ONE typed-Quran fold (shared with check-lesson-content and PD-48)
ROOT = os.path.dirname(os.path.dirname(HERE))
ARABIC = os.path.join(ROOT, 'apps', 'lessons', 'src', 'arabic')
FIXTURE_NAME = 'letters.fixture.json'
FIXTURE = os.path.join(ARABIC, FIXTURE_NAME)
LESSON_FILE = re.compile(r'lesson-\d{3}\.json')
KEYS = {'lesson', 'review', 'provenance', 'finalMark', 'retiredIds', 'units', 'quiz'}
UNIT_KEYS = {'id', 'letters', 'name', 'forms', 'note', 'words'}
UNIT_OPTIONAL = {'mark', 'group'}  # lesson 3, the harakat: the letter carrying one mark; the picker's group
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


def is_phrase(t):
    """A unit's name: one written word, or a short phrase of them (أَلِفٌ مَقْصُورَةْ), one space apart."""
    return is_str(t) and all(is_word(w) for w in t.split(' '))


def letters_of(w):
    return [c for c in w if is_letter(c)]


HARAKA = {'fatha': chr(0x64E), 'kasra': chr(0x650), 'damma': chr(0x64F)}


def occurrences(w, unit_letters, mark=None):
    """With a mark (one haraka's code point), a letter counts only where it CARRIES it (lesson 3)."""
    ls = letters_of(w)
    marks = [mk for _, mk in letters_marks(w)] if mark else []
    out = []
    for entry in unit_letters:
        seq = list(entry)
        for i in range(len(ls) - len(seq) + 1):
            if ls[i:i + len(seq)] == seq and (not mark or mark in marks[i]):
                out.append((i, len(seq)))
    return sorted(out)


def has(w, unit_letters, mark=None):
    return bool(occurrences(w, unit_letters, mark))


def positions(w, unit_letters, mark=None):
    n = len(letters_of(w))
    found = {'start' if at == 0 else 'end' if at + length == n else 'middle' for at, length in occurrences(w, unit_letters, mark)}
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


# --- Reading lessons (P0-5c, pd029-p05-reading-lessons-design.md): lessons 4, 5 and 10.
READING_KEYS = {'lesson', 'kind', 'review', 'provenance', 'retiredIds', 'stages', 'quiz'}
STAGE_ID = re.compile(r'^[a-z][a-z0-9_]*$')
PUNCTUATION = set('.،؟!؛')
READING_RUN = 3  # 3+ consecutive Quran words (rasm) refuse a reading text: the PD-49 calibration


def words_of(sentence):
    """A sentence's words: single spaces only, one optional closing punctuation mark; else None."""
    if not is_str(sentence) or not sentence:
        return None
    body = sentence[:-1] if sentence[-1] in PUNCTUATION else sentence
    ws = body.split(' ')
    return ws if ws and all(is_word(w) for w in ws) else None


def all_carry(text, vowel):
    """Every letter carries this vowel (a lesson-4 drill or word of one stage)."""
    ls = letters_marks(text)
    return bool(ls) and all(vowel in mk for _, mk in ls)


def check_reading(lesson, number, quran_grams=None):
    errors = []
    err = errors.append
    if not READING_KEYS <= set(lesson) or set(lesson) - READING_KEYS - {'passages'}:
        return [f'keys must be {sorted(READING_KEYS)} (and passages), not {sorted(lesson)}']
    if not is_int(lesson['lesson']) or lesson['lesson'] != number:
        err(f'lesson is {lesson["lesson"]!r}, not {number}')
    review = lesson['review']
    if not isinstance(review, dict) or review.get('status') not in ('pending', 'approved'):
        return errors + ['review.status must be pending or approved']
    approved = review['status'] == 'approved'
    retired = lesson['retiredIds'] if isinstance(lesson['retiredIds'], list) else []
    if not isinstance(lesson['retiredIds'], list) or not all(is_str(r) and WORD_ID.match(r) for r in retired):
        err('retiredIds must be a list of retired item ids')
    flagged, ids, items, stages, texts = [], set(), {}, {}, []

    def held(where, r):
        if r is not None and (not is_str(r) or not r.strip()):
            err(f'{where}: review must be null or a non-empty note')
        if r:
            flagged.append(where)

    def no_quran(where, text):
        if quran_grams is None:
            return
        ws = RASM.rasm(text).split()
        if any(tuple(ws[i:i + READING_RUN]) in quran_grams for i in range(len(ws) - READING_RUN + 1)):
            err(f'{where}: carries {READING_RUN} or more consecutive Quran words: refused (a child\'s reading text never carries altered Quran)')

    for s in lesson['stages'] if isinstance(lesson['stages'], list) else []:
        where = f'stage {s.get("id")!r}' if isinstance(s, dict) else 'a stage'
        if not isinstance(s, dict) or not {'id', 'name', 'items'} <= set(s) or set(s) - {'id', 'name', 'items', 'vowel'}:
            err(f'{where}: keys are id, name, items (and vowel)')
            continue
        if not is_str(s['id']) or not STAGE_ID.match(s['id']) or s['id'] in stages or s['id'] == 'passage':
            err(f'{where}: a stage id is a unique lowercase slug')
            continue
        vowel = None
        if 'vowel' in s:
            if not is_str(s['vowel']) or s['vowel'] not in ('fatha', 'kasra', 'damma'):
                err(f'{where}: vowel must be fatha, kasra or damma')
            else:
                vowel = HARAKA[s['vowel']]
        stages[s['id']] = {**s, '_vowel': vowel}
        if words_of(s['name']) is None:
            err(f'{where}: name {s["name"]!r} is not words')
        for it in s['items'] if isinstance(s['items'], list) else []:
            iw = f'{where} item {it.get("id") if isinstance(it, dict) else it!r}'
            if not isinstance(it, dict) or set(it) - {'id', 'kind', 'text', 'was', 'review', 'finalMarkException'} or not {'id', 'kind', 'text', 'was', 'review'} <= set(it):
                err(f'{iw}: keys are id, kind, text, was, review (and finalMarkException)')
                continue
            if not is_str(it['id']) or not WORD_ID.match(it['id']) or it['id'][:-4] != s['id'] or it['id'] in ids or it['id'] in retired:
                err(f'{iw}: id must be {s["id"]}-NNN, unique and never retired')
            ids.add(it['id'])
            t = it['text']
            if not is_str(t) or t != unicodedata.normalize('NFC', t):
                err(f'{iw}: text must be NFC')
                continue
            held(iw, it['review'])
            if it['was'] is not None and (not is_str(it['was']) or it['was'] == t or not it['review']):
                err(f'{iw}: was is the old text, different, and only on a held item')
            if it['kind'] in ('syllables', 'word'):
                if not is_word(t):
                    err(f'{iw}: {t!r} is not one written word')
                    continue
                if unmarked(t):
                    err(f'{iw}: {t!r} is not fully vowelled ({", ".join(unmarked(t))} unmarked)')
                if vowel and not all_carry(t, vowel):
                    err(f'{iw}: {t!r} breaks the stage\'s vowel ({s["vowel"]} on every letter)')
            elif it['kind'] == 'sentence':
                ws = words_of(t)
                if not ws or len(ws) < 2:
                    err(f'{iw}: a sentence is two or more single-spaced words (one closing mark allowed)')
                    continue
                for w in ws[:-1]:
                    if unmarked(w):
                        err(f'{iw}: {w!r} is not fully vowelled ({", ".join(unmarked(w))} unmarked)')
                # Case endings stay inside the sentence; only its LAST word takes the pausal sukun.
                tashkeel(iw, ws[-1], err, it.get('finalMarkException'))
                if 'finalMarkException' in it and not it['review'] and not approved:
                    err(f'{iw}: a finalMarkException stays held until the file is approved')
            else:
                err(f'{iw}: kind must be syllables, word or sentence')
                continue
            no_quran(iw, t)
            items[it['id']] = {**it, '_stage': s['id']}

    passages = lesson.get('passages', [])
    pids = set()
    for p in passages if isinstance(passages, list) else []:
        pw = f'passage {p.get("id") if isinstance(p, dict) else p!r}'
        if not isinstance(p, dict) or set(p) != {'id', 'title', 'sentences'}:
            err(f'{pw}: keys are id, title, sentences')
            continue
        if not is_str(p['id']) or not WORD_ID.match(p['id']) or p['id'][:-4] != 'passage' or p['id'] in pids or p['id'] in ids:
            err(f'{pw}: id must be passage-NNN, unique')
        pids.add(p['id'])
        title = p['title']
        if not isinstance(title, dict) or set(title) != {'text', 'review'} or words_of(title.get('text')) is None:
            err(f'{pw}: title is {{text, review}}, words')
        else:
            held(f'{pw} title', title['review'])
            no_quran(f'{pw} title', title['text'])
        sl = p['sentences']
        if not isinstance(sl, list) or not sl or len(set(sl)) != len(sl) or not all(items.get(x, {}).get('kind') == 'sentence' for x in sl):
            err(f'{pw}: sentences are distinct sentence item ids')
        else:
            no_quran(pw, ' '.join(items[x]['text'] for x in sl))  # across sentence boundaries too

    qids = set()
    for q in lesson['quiz'] if isinstance(lesson['quiz'], list) else []:
        qw = f'quiz {q.get("id") if isinstance(q, dict) else q!r}'
        if not isinstance(q, dict) or not is_str(q.get('id')) or q['id'] in qids:
            err(f'{qw}: quiz ids must be unique')
            continue
        qids.add(q['id'])
        held(qw, q.get('review'))
        opts = q.get('options')
        if not isinstance(opts, list) or not 2 <= len(opts) <= 4 or not all(is_str(o) for o in opts) or len(set(opts)) != len(opts) or not is_int(q.get('answer')):
            err(f'{qw}: 2-4 distinct options and an answer index')
            continue
        if q.get('kind') == 'vowel':
            st = stages.get(q.get('stage'))
            if not st or not st['_vowel']:
                err(f'{qw}: stage must be a vowel stage')
                continue
            drill_texts = {i['text'] for i in items.values() if i['kind'] != 'sentence'}
            if any(o not in drill_texts for o in opts):
                err(f'{qw}: options must be drills or words of this lesson')
            right = [i for i, o in enumerate(opts) if all_carry(o, st['_vowel'])]
            if right != [q['answer']]:
                err(f'{qw}: must have exactly one right answer, the answer; by the stage vowel the right ones are {right}')
            elif not any(i['_stage'] == q['stage'] and i['text'] == opts[q['answer']] for i in items.values()):
                err(f'{qw}: the answer must be the stage\'s own item')
        elif q.get('kind') == 'missing':
            it = items.get(q.get('sentence'))
            ws = words_of(it['text']) if it and it['kind'] == 'sentence' else None
            if not ws or not is_int(q.get('blank')) or not 0 <= q['blank'] < len(ws):
                err(f'{qw}: sentence and blank must name a sentence item and one of its words')
                continue
            right = [i for i, o in enumerate(opts) if o == ws[q['blank']]]
            if right != [q['answer']] or not all(is_word(o) for o in opts):
                err(f'{qw}: exactly one option must complete the sentence verbatim; the right ones are {right}')
        else:
            err(f'{qw}: kind must be vowel or missing')

    if approved:
        if not is_str(review.get('by')) or not review['by'].strip():
            err('review: an approved lesson names its reviewer')
        if flagged:
            err(f'review: approved while {len(flagged)} item(s) are still flagged ({", ".join(flagged[:3])}...)')
    return errors


def quran_grams():
    """Every READING_RUN-word run of the whole verified Quran, as rasm skeletons."""
    spec = importlib.util.spec_from_file_location('lesson_content', os.path.join(HERE, 'check-lesson-content.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    grams = set()
    for verses in mod.verified_surahs().values():
        for v in verses:
            ws = RASM.rasm(v).split()
            grams.update(tuple(ws[i:i + READING_RUN]) for i in range(len(ws) - READING_RUN + 1))
    return grams


def check(lesson, number, quran=None):
    if isinstance(lesson, dict) and lesson.get('kind') == 'reading':
        return check_reading(lesson, number, quran)
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
        if not isinstance(u, dict) or not UNIT_KEYS <= set(u) or set(u) - UNIT_KEYS - UNIT_OPTIONAL:
            err(f'{where}: keys must be {sorted(UNIT_KEYS)} (and {sorted(UNIT_OPTIONAL)})')
            continue
        if not is_str(u['id']) or not UNIT_ID.match(u['id']):
            err(f'{where}: a unit id is a lowercase slug without hyphens (ba, lam_alif)')
            continue
        if u['id'] in units:
            err(f'{where}: unit ids are unique')
        if not isinstance(u['letters'], list) or not u['letters'] or not all(is_str(l) and l and all(is_letter(c) for c in l) for l in u['letters']):
            err(f'{where}: letters must be a list of letters (one, or a pair such as لا)')
            continue
        mark = None
        if 'mark' in u:
            if u['mark'] not in HARAKA or not all(len(l) == 1 for l in u['letters']):
                err(f'{where}: mark must be fatha, kasra or damma, on single letters')
                continue
            mark = HARAKA[u['mark']]
        if 'group' in u and (not is_str(u['group']) or not 0 < len(u['group']) <= 8):
            err(f'{where}: group must be a short non-empty name (the letter)')
        u = {**u, '_mark': mark}
        units[u['id']] = u
        if mark:
            # A marked unit's name is its syllable: one of its letters with that mark (بَ), not a word.
            if u['name'] not in [l + mark for l in u['letters']]:
                err(f'{where}: name {u["name"]!r} must be the syllable, one of its letters with its {u["mark"]}')
        elif not is_phrase(u['name']):
            err(f'{where}: name {u["name"]!r} is not one written word or a phrase of them')
        else:
            # Every word fully vowelled; only the LAST takes the pausal sukun (the first of
            # أَلِفٌ مَقْصُورَةْ keeps its case ending, as Arabic is read in pause).
            *inner, last = u['name'].split(' ')
            for w in inner:
                gaps = unmarked(w)
                if gaps:
                    err(f'{where} name: {w!r} is not fully vowelled ({", ".join(gaps)} unmarked)')
            tashkeel(f'{where} name', last, err)
        if not isinstance(u['forms'], list) or not u['forms'] or not all(is_str(f) and f and all(c == chr(0x640) or c == mark or any(c in l for l in u['letters']) for c in f) for f in u['forms']):
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
            if not has(t, u['letters'], u['_mark']):
                err(f'{ww}: does not contain the unit\'s letter {"/".join(u["letters"])}{" carrying its " + u["mark"] if u["_mark"] else ""} (by the one rule: only marks are removed)')
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
            right = [i for i, o in enumerate(opts) if has(o, unit['letters'], unit['_mark'])]
            if not is_int(q.get('answer')) or right != [q['answer']]:
                err(f'{where}: must have exactly one right answer, the answer (an index); by the one rule the right ones are {right}')
        elif q.get('kind') == 'position':
            word = q.get('word')
            if not is_str(word) or word not in vocabulary:
                err(f'{where}: {word!r} is not a word of this lesson')
                continue
            at = positions(word, unit['letters'], unit['_mark'])
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
    for c in fx['markedCases']:
        mark = HARAKA[c['mark']]
        if has(c['word'], c['letters'], mark) != c['has'] or positions(c['word'], c['letters'], mark) != c['positions']:
            out.append(f'fixture {c["word"]} / {"".join(c["letters"])} with {c["mark"]}: got {has(c["word"], c["letters"], mark)}, {positions(c["word"], c["letters"], mark)}')
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
    return out, len(fx['cases']) + len(fx['markedCases']) + len(fx['marks']) + len(fx['letters']) + len(fx['words'])


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
        'unit-name-phrase': (lambda c: c['units'][2].update(name='أَلِفٌ مَقْصُورَةْ'), None),
        'unit-name-phrase-last-word-tanween': (lambda c: c['units'][2].update(name='أَلِفٌ مَقْصُورَةٌ'), 'tanween'),
        'unit-name-phrase-inner-unvowelled': (lambda c: c['units'][2].update(name='الف مَقْصُورَةْ'), 'not fully vowelled'),
        'unit-name-double-space': (lambda c: c['units'][2].update(name='أَلِفٌ  مَقْصُورَةْ'), 'not one written word'),
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
    # Lesson 3 (the harakat): units are a letter CARRYING one mark.
    def harakat():
        return {
            'lesson': 3, 'review': {'status': 'pending', 'by': None, 'note': ''}, 'provenance': {}, 'finalMark': 'sukun', 'retiredIds': [],
            'units': [
                {'id': 'ba_fatha', 'letters': ['ب'], 'mark': 'fatha', 'group': 'ب', 'name': 'بَ', 'forms': ['بَ'], 'note': None,
                 'words': [{'id': 'ba_fatha-001', 'text': 'بَابْ', 'was': None, 'review': None},
                           {'id': 'ba_fatha-002', 'text': 'كَتَبَ', 'was': None, 'review': 'FINAL MARK EXCEPTION',
                            'finalMarkException': "the lesson's vowel on the last letter"}]},
                {'id': 'ba_kasra', 'letters': ['ب'], 'mark': 'kasra', 'group': 'ب', 'name': 'بِ', 'forms': ['بِ'], 'note': None,
                 'words': [{'id': 'ba_kasra-001', 'text': 'بِنْتْ', 'was': None, 'review': None}]},
            ],
            'quiz': [{'id': 'q1', 'kind': 'contains', 'unit': 'ba_fatha', 'options': ['بَابْ', 'بِنْتْ'], 'answer': 0, 'review': None},
                     {'id': 'q2', 'kind': 'position', 'unit': 'ba_kasra', 'word': 'بِنْتْ', 'answer': 'start', 'review': None}],
        }
    hcases = {
        'harakat-clean': (lambda c: None, None),
        'harakat-word-without-the-mark': (lambda c: c['units'][0]['words'].append({'id': 'ba_fatha-003', 'text': 'بِنْتْ', 'was': None, 'review': None}), 'carrying its fatha'),
        'harakat-name-not-the-syllable': (lambda c: c['units'][0].update(name='بِ'), 'must be the syllable'),
        'harakat-bad-mark': (lambda c: c['units'][0].update(mark='sukun'), 'mark must be'),
        'harakat-mark-on-a-pair': (lambda c: c['units'][0].update(letters=['لا']), 'mark must be'),
        'harakat-two-right-answers': (lambda c: c['quiz'][0].update(options=['بَابْ', 'كَتَبَ']), 'exactly one right answer'),
        'harakat-empty-group': (lambda c: c['units'][0].update(group=''), 'group must be'),
        'harakat-unknown-key': (lambda c: c['units'][0].update(colour='red'), 'keys must be'),
    }
    for name, (mutate, expected) in hcases.items():
        c = harakat()
        mutate(c)
        errors = check(c, 3)
        ok = (not errors) if expected is None else any(expected in e for e in errors)
        if not ok:
            failed.append(f'{name}: expected {expected or "no errors"}, got {errors}')
    # Reading lessons (P0-5c): drills in their stage's vowel, sentences, passages, two quiz kinds.
    def reading():
        return {
            'lesson': 5, 'kind': 'reading', 'review': {'status': 'pending', 'by': None, 'note': ''}, 'provenance': {}, 'retiredIds': [],
            'stages': [
                {'id': 'fatha', 'name': 'الْفَتْحَةْ', 'vowel': 'fatha', 'items': [
                    {'id': 'fatha-001', 'kind': 'syllables', 'text': 'بَتَ', 'was': None, 'review': None},
                    {'id': 'fatha-002', 'kind': 'word', 'text': 'كَتَبَ', 'was': None, 'review': None}]},
                {'id': 'kasra', 'name': 'الْكَسْرَةْ', 'vowel': 'kasra', 'items': [{'id': 'kasra-001', 'kind': 'syllables', 'text': 'بِتِ', 'was': None, 'review': None}]},
                {'id': 'sentences', 'name': 'جُمَلْ', 'items': [
                    {'id': 'sentences-001', 'kind': 'sentence', 'text': 'أَكَلَ الْوَلَدُ تُفَّاحًا', 'was': None, 'review': 'TANWEEN KEPT',
                     'finalMarkException': 'the tanween fath of the last word'},
                    {'id': 'sentences-002', 'kind': 'sentence', 'text': 'نَامَتِ الْقِطَّةُ الصَّغِيرَةْ.', 'was': None, 'review': None}]},
            ],
            'passages': [{'id': 'passage-001', 'title': {'text': 'الْقِطَّةْ', 'review': None}, 'sentences': ['sentences-002']}],
            'quiz': [{'id': 'q1', 'kind': 'vowel', 'stage': 'fatha', 'options': ['بِتِ', 'بَتَ'], 'answer': 1, 'review': None},
                     {'id': 'q2', 'kind': 'missing', 'sentence': 'sentences-002', 'blank': 1, 'options': ['الْقِطَّةُ', 'الْوَلَدُ'], 'answer': 0, 'review': None}],
        }
    toy_quran = {tuple(RASM.rasm('نَامَتِ الْقِطَّةُ الصَّغِيرَةُ').split())}
    rcases = {
        'reading-clean': (lambda c: None, None, None),
        'reading-breaks-the-stage-vowel': (lambda c: c['stages'][0]['items'][0].update(text='بَتِ'), "breaks the stage's vowel", None),
        'reading-unvowelled-drill': (lambda c: c['stages'][0]['items'][0].update(text='بَت'), 'not fully vowelled', None),
        'reading-inner-word-unvowelled': (lambda c: c['stages'][2]['items'][1].update(text='نامت الْقِطَّةُ الصَّغِيرَةْ.'), 'not fully vowelled', None),
        'reading-last-word-not-pausal': (lambda c: c['stages'][2]['items'][1].update(text='نَامَتِ الْقِطَّةُ الصَّغِيرَةُ.'), 'not the pausal sukun', None),
        'reading-double-space': (lambda c: c['stages'][2]['items'][1].update(text='نَامَتِ  الْقِطَّةْ'), 'single-spaced', None),
        'reading-two-right-vowel-answers': (lambda c: c['quiz'][0].update(options=['بَتَ', 'كَتَبَ']), 'exactly one right answer', None),
        'reading-missing-wrong-answer': (lambda c: c['quiz'][1].update(answer=1), 'complete the sentence', None),
        'reading-passage-of-a-drill': (lambda c: c['passages'][0].update(sentences=['fatha-001']), 'sentence item ids', None),
        'reading-exception-not-held': (lambda c: c['stages'][2]['items'][0].update(review=None), 'stays held', None),
        'reading-typed-quran': (lambda c: None, 'consecutive Quran words', toy_quran),
        'reading-unknown-kind': (lambda c: c['stages'][0]['items'][0].update(kind='letter'), 'kind must be', None),
    }
    for name, (mutate, expected, grams) in rcases.items():
        c = reading()
        mutate(c)
        errors = check(c, 5, grams)
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
        print(f'arabic-lesson selftest: {len(cases) + len(hcases) + len(rcases) + 1} cases, each caught; the shared letter fixture ({fx_count} cases) agrees with letters.ts')
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
    lessons = {f: json.load(open(os.path.join(ARABIC, f), encoding='utf-8')) for f in files}
    grams = quran_grams() if any(isinstance(x, dict) and x.get('kind') == 'reading' for x in lessons.values()) else None
    for f in files:
        lesson = lessons[f]
        errors = check(lesson, int(f[7:10]), grams)
        for e in errors:
            print(f'arabic-lesson: {f}: {e}')
        if errors:
            failed += 1
        elif lesson.get('kind') == 'reading':
            held = sum(1 for s in lesson['stages'] for i in s['items'] if i['review']) + sum(1 for q in lesson['quiz'] if q['review'])
            print(f'arabic-lesson: {f}: reading lesson, every drill in its stage\'s vowel, full tashkeel, no Quran run; '
                  f'review {lesson["review"]["status"]}, {held} item(s) held for a teacher')
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
