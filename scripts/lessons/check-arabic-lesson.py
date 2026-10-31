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
UNIT_OPTIONAL = {'mark', 'group', 'madd', 'tanween', 'phraseName'}  # lesson 3: the letter carrying one mark; the picker's group; lesson 7: a madd letter; lesson 8: a tanween
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


HARAKA = {'fatha': chr(0x64E), 'kasra': chr(0x650), 'damma': chr(0x64F), 'sukun': chr(0x652), 'shadda': chr(0x651)}
# Lesson 7 (the madd): each madd letter and the vowel it lengthens.
MADD = {'alif': ('ا', chr(0x64E)), 'ya': ('ي', chr(0x650)), 'waw': ('و', chr(0x64F))}
# Lesson 8: the three tanween.
TANWEEN_OF = {'fath': chr(0x64B), 'damm': chr(0x64C), 'kasr': chr(0x64D)}


def silent_waw(ls, i):
    """The silent waw of أُولَئِكَ / أُولُو / أُولَاتُ: أ, then و, then ل -- written, never read."""
    return i == 1 and ls[:3] == ['أ', 'و', 'ل']


def occurrences(w, unit_letters, mark=None, after=None, tanween=None):
    """With a mark (one haraka's code point), a letter counts only where it CARRIES it (lesson 3);
    the sukun never on the word's last letter, where it is the pausal sukun (lesson 6). With after
    (a vowel), only where the letter is BARE and the letter before carries that vowel, never the
    silent waw (lesson 7). With tanween, the word's end carrying it: the last letter, or for the
    fath the letter before a bare final ا / ى (lesson 8)."""
    ls = letters_of(w)
    if tanween:
        marks = [mk for _, mk in letters_marks(w)]
        k = len(ls) - 1
        if k > 0 and tanween == TANWEEN_OF['fath'] and ls[k] in ('ا', 'ى') and not marks[k]:
            k -= 1
        return [(k, 1)] if k >= 0 and tanween in marks[k] else []
    marks = [mk for _, mk in letters_marks(w)] if mark or after else []
    out = []
    for entry in unit_letters:
        seq = list(entry)
        for i in range(len(ls) - len(seq) + 1):
            if ls[i:i + len(seq)] != seq or (mark and mark not in marks[i]):
                continue
            if mark == HARAKA['sukun'] and i + len(seq) == len(ls):
                continue
            if after and (i == 0 or marks[i] or after not in marks[i - 1] or silent_waw(ls, i)):
                continue
            out.append((i, len(seq)))
    return sorted(out)


def has(w, unit_letters, mark=None, after=None, tanween=None):
    return bool(occurrences(w, unit_letters, mark, after, tanween))


def positions(w, unit_letters, mark=None, after=None, tanween=None):
    n = len(letters_of(w))
    found = {'start' if at == 0 else 'end' if at + length == n else 'middle' for at, length in occurrences(w, unit_letters, mark, after, tanween)}
    return [p for p in POSITIONS if p in found]


def uncounted_madd(w):
    """A madd the rule does not count, though read long: a dagger alif, ى after a fatha, or آ. A madd
    unit's quiz refuses an option carrying one."""
    ls = letters_marks(w)
    return chr(0x670) in w or any(c == 'آ' for c, _ in ls) or any(c == 'ى' and i > 0 and chr(0x64E) in ls[i - 1][1] for i, (c, _) in enumerate(ls))


def sukun_on_madd(w):
    """A sukun written on a madd letter (فِيْلْ): a content error, since a madd letter is written bare.
    With a shadda the letter is a consonant (غَنِيّْ), not a madd."""
    ls = letters_marks(w)
    return any(i > 0 and chr(0x652) in mk and chr(0x651) not in mk and any(c == l and v in ls[i - 1][1] for l, v in MADD.values()) for i, (c, mk) in enumerate(ls))


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


def bare(word):
    """A word's bare letters, a tanween fath's carrier alif or alif maqsura dropped (كِتَابًا = كِتَابْ)."""
    if is_str(word) and len(word) > 1 and word[-1] in ('ا', 'ى') and word[-2] == chr(0x64B):
        word = word[:-1]
    return ''.join(letters_of(word))


def all_carry(text, vowel):
    """Every letter carries this vowel (a lesson-4 drill or word of one stage)."""
    ls = letters_marks(text)
    return bool(ls) and all(vowel in mk for _, mk in ls)


# Words that end in a sukun INSIDE a sentence by nature (not a pausal sukun): particles.
SUKUN_PARTICLES = {unicodedata.normalize('NFC', w) for w in ['مِنْ', 'عَنْ', 'لَمْ', 'قَدْ', 'هَلْ', 'بَلْ', 'أَنْ', 'إِنْ', 'لَنْ', 'كَمْ', 'مَنْ', 'إِذْ', 'لَكِنْ', 'مُنْذْ']}


def phrase_tashkeel(where, text, err, exception=None):
    """A sentence, title or stage name: every word fully vowelled; the case endings stay INSIDE (a word there
    never ends in the pausal sukun, unless it is a sukun particle); only the LAST word takes the pausal sukun."""
    ws = words_of(text) or []
    for k, w in enumerate(ws[:-1]):
        if unmarked(w):
            err(f'{where}: {w!r} is not fully vowelled ({", ".join(unmarked(w))} unmarked)')
            continue
        c, mk = letters_marks(w)[-1]
        if mk != {SUKUN}:
            continue
        # A sukun inside a sentence is right only on a sukun particle (مِنْ لَمْ قَدْ ...) or the feminine
        # تْ of a past verb (طَبَخَتْ أُمِّي) -- and never before a hamzat wasl, where it must take a vowel
        # (طَبَخَتِ الْأُمُّ، مِنَ الْبَيْتِ).
        if w not in SUKUN_PARTICLES and c != chr(0x62A):
            err(f'{where}: {w!r} ends in a pausal sukun inside the sentence (case endings stay inside; only the last word pauses)')
        elif ws[k + 1][0] == chr(0x627):
            err(f'{where}: {w!r} keeps its sukun before the hamzat wasl of {ws[k + 1]!r}; it takes a vowel there')
    if ws:
        tashkeel(where, ws[-1], err, exception)


def check_reading(lesson, number, quran_grams=None):
    if quran_grams is None:
        raise ValueError('a reading lesson is checked against the verified Quran (quran_grams()); refusing to skip that check')
    errors = []
    err = errors.append
    if not READING_KEYS <= set(lesson) or set(lesson) - READING_KEYS - {'passages', 'names'}:
        return [f'keys must be {sorted(READING_KEYS)} (and passages, names), not {sorted(lesson)}']
    names = lesson.get('names', [])
    if not isinstance(names, list) or not all(is_word(n) for n in names):
        err('names must be a list of the proper names the lesson\'s sentences use (one written word each)')
        names = []
    name_letters = {bare(n) for n in names}  # by letters, so أَحْمَدْ is أَحْمَدُ
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
        if quran_runs(text, quran_grams):
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
        else:
            phrase_tashkeel(f'{where} name', s['name'], err)
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
                # Case endings stay inside the sentence; only its LAST word takes the pausal sukun.
                phrase_tashkeel(iw, t, err, it.get('finalMarkException'))
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
            phrase_tashkeel(f'{pw} title', title['text'], err)
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
            drill_texts = {i['text']: i['kind'] for i in items.values() if i['kind'] != 'sentence'}
            if any(o not in drill_texts for o in opts):
                err(f'{qw}: options must be drills or words of this lesson')
            elif len({drill_texts[o] for o in opts}) != 1:
                err(f'{qw}: options are all drills or all words, never mixed')
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
            drills = {i['text'] for i in items.values() if i['kind'] == 'syllables'}
            for k, o in enumerate(opts):
                if k == q['answer']:
                    continue
                # A wrong option is a word of ANOTHER sentence of this lesson, fully vowelled, never a drill.
                src = [i for i in items.values() if i['kind'] == 'sentence' and i['id'] != q['sentence'] and o in (words_of(i['text']) or [])]
                if not src or o in drills:
                    err(f'{qw}: option {o!r} must be a word of another sentence of this lesson (never a drill)')
                elif unmarked(o):
                    err(f'{qw}: option {o!r} is not fully vowelled')
                # Reviews of #292: a wrong option must not be able to complete the sentence too. It is never
                # a word of the blank's own sentence, never a word in the blank's place in another sentence
                # (a subject for a subject), never a sentence's last word (its pausal form), never the answer
                # in another form (الْوَلَدْ / الْوَلَدُ, كِتَابًا / كِتَابْ), and never another name for a name.
                answer = ws[q['blank']]
                sentences = [words_of(i['text']) or [] for i in items.values() if i['kind'] == 'sentence']
                if o in ws:
                    err(f'{qw}: option {o!r} is a word of the blank\'s own sentence')
                if any(len(x) > q['blank'] and x[q['blank']] == o for x in sentences):
                    err(f'{qw}: option {o!r} sits in the blank\'s place in another sentence, so it could fill it too')
                if any(x and x[-1] == o for x in sentences):
                    err(f'{qw}: option {o!r} is a sentence\'s last word, a pausal form')
                if bare(o) == bare(answer):
                    err(f'{qw}: option {o!r} is the answer\'s word in another form')
                if bare(answer) in name_letters and bare(o) in name_letters:
                    err(f'{qw}: option {o!r} is another name where the blank is a name: it could complete the sentence too')
        else:
            err(f'{qw}: kind must be vowel or missing')

    if approved:
        if not is_str(review.get('by')) or not review['by'].strip():
            err('review: an approved lesson names its reviewer')
        if flagged:
            err(f'review: approved while {len(flagged)} item(s) are still flagged ({", ".join(flagged[:3])}...)')
    return errors


def runs_of(ws, n=READING_RUN):
    """Every n-word run of a word list (READING_RUN by default), its edge words with and without a prefix letter."""
    out = set()
    for i in range(len(ws) - n + 1):
        run = ws[i:i + n]
        for first in RASM.edge_forms(run[0]):
            for last in RASM.edge_forms(run[-1]):
                out.add((first, *run[1:-1], last))
    return out


def quran_runs(text, grams, n=READING_RUN):
    """Whether a reading text carries READING_RUN or more consecutive Quran words (rasm, vocative joined,
    edge prefixes stripped on both sides). grams must be given: a check without them is no check."""
    if grams is None:
        raise ValueError('the typed-Quran check needs the verified Quran (quran_grams()); refusing to skip it')
    return bool(runs_of(RASM.words(text), n) & grams)


def quran_grams():
    """Every READING_RUN-word run of the whole verified Quran, across verse boundaries too (112:1-2)."""
    spec = importlib.util.spec_from_file_location('lesson_content', os.path.join(HERE, 'check-lesson-content.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    grams = set()
    for verses in mod.verified_surahs().values():
        grams |= runs_of([w for v in verses for w in RASM.words(v)])
    return frozenset(grams)


# --- Topic lessons (the Islamic Studies lessons): prose, Quran BY REFERENCE, hadith always held.
ISLAMIC = os.path.join(ROOT, 'apps', 'lessons', 'src', 'islamic')
# fiqh is required: the author decides, for every lesson, whether it teaches fiqh (review of #318).
TOPIC_KEYS = {'lesson', 'kind', 'title', 'review', 'provenance', 'retiredIds', 'sections', 'quiz', 'fiqh'}
TOPIC_RUN = 4  # 4+ consecutive Quran words in prose: typed Quran (the approved plan; whole Quran)
# Owner 2026-10-29: no madhhab names or differences in child-facing content (review of #318). A word is
# folded (no marks, every alef form as ا, ى as ي, ة as ه, no tatweel), stripped of a prefix (و ف ب ك ل),
# the article, a tanween fath's alif and a pronoun suffix, then compared with these stems. Known false
# positives fail CLOSED and a teacher rewords: حنفية is also a tap in Egyptian Arabic (a wudu lesson
# will meet it), مذهب also means gilded, مالكيه "its owners", مالكي "my owner" and شافعي "my
# intercessor". A bare حنيف (Ibrahim was حنيفًا) is NOT a stem, nor is "hanif" in Latin.
MADHHAB = {'حنفي', 'حنفيه', 'احناف', 'حنفيون', 'حنفيين', 'مالكي', 'مالكيه', 'مالكيون', 'مالكيين', 'شافعي', 'شافعيه',
           'شوافع', 'شافعيون', 'شافعيين', 'حنبلي', 'حنابله', 'حنبليون', 'حنبليين', 'مذهب', 'مذاهب'}
# The imams by name, as folded phrases, and the Latin spellings (any case).
MADHHAB_PHRASES = ['ابو حنيفه', 'ابي حنيفه', 'ابا حنيفه', 'مالك بن انس', 'احمد بن حنبل', 'ابن حنبل', 'الامام الشافعي',
                   'الامام مالك', 'الامام احمد']
# Latin is matched on a fold: NFKD with its combining marks dropped, the apostrophe-like letters dropped
# and lower case, so Shāfiʿī, Shafi'i and shafii are one spelling. "shafi" ends at a word boundary so
# the name Shafiq does not match; "malik" alone (a name) does not either, only maliki/malikite.
MADHHAB_LATIN = re.compile(r"\b(hanaf\w*|hanbal\w*|maliki\w*|shafi(?:i|is|ite|ites|iyya)?\b|madh-?hab\w*|abu\s+hanifa\w*|imam\s+(?:malik|ahmad)\b)")
LATIN_QUOTES = dict.fromkeys(map(ord, "'’‘ʿʾ`"))


def fold_latin(text):
    """Latin as the madhhab filter compares it: no diacritics, no apostrophes, lower case."""
    t = ''.join(c for c in unicodedata.normalize('NFKD', text) if not unicodedata.combining(c))
    return t.translate(LATIN_QUOTES).lower()
PRONOUN_SUFFIX = re.compile('(?:هما|هم|هن|ها|كم|كن|نا|ه|ك|ي)$')


def fold_word(w):
    """A word as the madhhab filter compares it: no marks, one alef, ى as ي, ة as ه, no tatweel."""
    w = ''.join(c for c in w if not is_mark(c) and c != chr(0x640))
    return w.translate({0x623: 0x627, 0x625: 0x627, 0x622: 0x627, 0x671: 0x627, 0x649: 0x64A, 0x629: 0x647})


def madhhab_words(text):
    """Every madhhab stem or imam's name the text carries (folded), and any Latin spelling."""
    found = []
    words = [fold_word(w) for w in re.findall('[' + chr(0x621) + '-' + chr(0x652) + chr(0x670) + chr(0x671) + ']+', text)]
    for w in words:
        bases = {w}
        for p in (r'^[وفبكل]', r'^[وفبكل]?ال', r'^[وفبكل]?لل'):
            bases.add(re.sub(p, '', w))
        for b in list(bases):
            if b.endswith('ا') and len(b) > 3:
                bases.add(b[:-1])  # حنفيا (a tanween fath's alif)
            bases.add(PRONOUN_SUFFIX.sub('', b))  # مذهبه، مذهبنا، مذاهبهم
        if bases & MADHHAB:
            found.append(w)
    folded = ' '.join(words)
    found += [p for p in MADHHAB_PHRASES if p in folded]
    found += [m.group(0) for m in MADHHAB_LATIN.finditer(fold_latin(text))]
    return found


def check_topic(lesson, number, quran=None):
    """quran: {'grams': every TOPIC_RUN-word run of the verified Quran, 'counts': {surah: ayah count}}."""
    if quran is None:
        raise ValueError('a topic lesson is checked against the verified Quran (topic_quran()); refusing to skip that check')
    errors = []
    err = errors.append
    if not isinstance(lesson, dict) or set(lesson) != TOPIC_KEYS:
        return [f'keys must be {sorted(TOPIC_KEYS)}, not {sorted(lesson) if isinstance(lesson, dict) else lesson!r}']
    if not isinstance(lesson['fiqh'], bool):
        err('fiqh is true or false (required: does this lesson teach fiqh?)')
    if not is_int(lesson['lesson']) or lesson['lesson'] != number:
        err(f'lesson is {lesson["lesson"]!r}, not {number}')
    review = lesson['review']
    if not isinstance(review, dict) or review.get('status') not in ('pending', 'approved'):
        return errors + ['review.status must be pending or approved']
    approved = review['status'] == 'approved'
    retired = lesson['retiredIds'] if isinstance(lesson['retiredIds'], list) else []
    if not isinstance(lesson['retiredIds'], list) or not all(is_str(r) and WORD_ID.match(r) for r in retired):
        err('retiredIds must be a list of retired ids')
    flagged, ids = [], set()

    def held(where, r):
        if r is not None and (not is_str(r) or not r.strip()):
            err(f'{where}: review must be null or a non-empty note')
        if r:
            flagged.append(where)

    def prose(where, t, standalone=False):
        """standalone: an option, a statement or a title -- a whole string a child reads on its own."""
        if not is_str(t) or not t.strip() or t != unicodedata.normalize('NFC', t):
            err(f'{where}: text must be non-empty NFC')
            return
        for w in madhhab_words(t):
            err(f'{where}: names a madhhab ({w}); child-facing text never does (owner, 2026-10-29)')
        if quran_runs(t, quran['grams'], TOPIC_RUN):
            err(f'{where}: carries {TOPIC_RUN} or more consecutive Quran words: typed Quran is refused; use a {{surah, from, to}} reference')
        # A standalone string that IS a whole short ayah (2-3 words) is typed Quran too: an option
        # «الله الصمد», a title «إنا أعطيناك الكوثر». Only the WHOLE string, never a run inside prose: in
        # rasm everyday phrases are ayat (خلق الإنسان، علم القرآن، ثم نظر، مالك الناس, and قال له الناس since
        # إله folds to له), so prose stays under the TOPIC_RUN rule (the agreed typed-Quran policy). What
        # remains: a 2-3-word ayah inside prose passes (accepted); an option or title that is exactly such
        # a phrase («ثم نظر», «مالك الناس») is refused though meant as everyday Arabic -- it fails closed
        # and a teacher rewords it.
        if standalone and tuple(RASM.words(t)) in quran['ayat']:
            err(f'{where}: is a whole ayah: typed Quran is refused; use a {{surah, from, to}} reference')

    t = lesson['title']
    if not isinstance(t, dict) or set(t) != {'text', 'review'}:
        err('title is {text, review}')
    else:
        prose('title', t['text'], standalone=True)
        held('title', t['review'])
    sids = set()
    for s in lesson['sections'] if isinstance(lesson['sections'], list) else []:
        where = f'section {s.get("id") if isinstance(s, dict) else s!r}'
        if not isinstance(s, dict) or set(s) != {'id', 'title', 'blocks'}:
            err(f'{where}: keys are id, title, blocks')
            continue
        if not is_str(s['id']) or not STAGE_ID.fullmatch(s['id']) or s['id'] in sids:
            err(f'{where}: a section id is a unique lowercase slug')
            continue
        sids.add(s['id'])
        if not isinstance(s['title'], dict) or set(s['title']) != {'text', 'review'}:
            err(f'{where}: title is {{text, review}}')
        else:
            prose(f'{where} title', s['title']['text'], standalone=True)
            held(f'{where} title', s['title']['review'])
        for b in s['blocks'] if isinstance(s['blocks'], list) else []:
            bw = f'{where} block {b.get("id") if isinstance(b, dict) else b!r}'
            if not isinstance(b, dict) or not is_str(b.get('id')) or not WORD_ID.fullmatch(b['id']) or b['id'][:-4] != s['id'] or b['id'] in ids or b['id'] in retired:
                err(f'{bw}: id must be {s["id"]}-NNN, unique and never retired')
                continue
            ids.add(b['id'])
            kind = b.get('kind')
            if kind == 'text' and set(b) == {'id', 'kind', 'text', 'review'}:
                prose(bw, b['text'])
                held(bw, b['review'])
            elif kind == 'quran' and set(b) == {'id', 'kind', 'surah', 'from', 'to', 'review'}:
                n, a, z = b['surah'], b['from'], b['to']
                if not (is_int(n) and is_int(a) and is_int(z)) or n not in quran['counts'] or not 1 <= a <= z <= quran['counts'][n]:
                    err(f'{bw}: {n}:{a}-{z} is not a range of the verified Quran')
                held(bw, b['review'])
            elif kind == 'hadith' and set(b) == {'id', 'kind', 'source', 'text', 'review'}:
                # Every hadith stays held (no verified hadith source yet): even an approved file never shows one.
                if not is_str(b['source']) or not b['source'].strip() or not is_str(b['text']) or not b['text'].strip():
                    err(f'{bw}: a hadith has its source and its text')
                if not is_str(b['review']) or not b['review'].strip():
                    err(f'{bw}: a hadith is always held until a verified hadith source is approved')
            else:
                err(f'{bw}: a block is text {{text}}, quran {{surah, from, to}} or hadith {{source, text}}, with its review')
    qids = set()
    for q in lesson['quiz'] if isinstance(lesson['quiz'], list) else []:
        qw = f'quiz {q.get("id") if isinstance(q, dict) else q!r}'
        if not isinstance(q, dict) or not is_str(q.get('id')) or not q['id'].strip() or q['id'] in qids:
            err(f'{qw}: quiz ids must be non-empty and unique')
            continue
        qids.add(q['id'])
        held(qw, q.get('review'))
        if q.get('kind') == 'choose':
            opts = q.get('options')
            if not isinstance(opts, list) or not 2 <= len(opts) <= 4 or not all(is_str(o) and o.strip() for o in opts) or len(set(opts)) != len(opts):
                err(f'{qw}: 2-4 distinct options')
                continue
            if not is_int(q.get('answer')) or not 0 <= q['answer'] < len(opts):
                err(f'{qw}: the answer is an option index')
            prose(f'{qw} question', q.get('question'))
            for o in opts:
                prose(f'{qw} option', o, standalone=True)
        elif q.get('kind') == 'truefalse':
            prose(f'{qw} statement', q.get('statement'), standalone=True)
            if not isinstance(q.get('answer'), bool):
                err(f'{qw}: the answer is true or false')
        else:
            err(f'{qw}: kind must be choose or truefalse')
    if set(review) - {'status', 'by', 'note', 'scholar'}:
        err('review keys are status, by, note (and scholar)')
    if approved:
        if not is_str(review.get('by')) or not review['by'].strip():
            err('review: an approved lesson names its reviewer')
        if flagged:
            err(f'review: approved while {len(flagged)} item(s) are still flagged ({", ".join(flagged[:3])}...)')
        # A fiqh lesson's method and every step are verified by a qualified scholar too (owner, 2026-10-29).
        if lesson.get('fiqh') is True and (not is_str(review.get('scholar')) or not review['scholar'].strip()):
            err('review: an approved fiqh lesson names the qualified scholar who verified it (review.scholar)')
    return errors


def topic_quran():
    """The verified Quran for topic lessons: its TOPIC_RUN-word runs and each surah's ayah count."""
    spec = importlib.util.spec_from_file_location('lesson_content', os.path.join(HERE, 'check-lesson-content.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    grams, counts, ayat = set(), {}, set()
    for n, verses in mod.verified_surahs().items():
        counts[n] = len(verses)
        grams |= runs_of([w for v in verses for w in RASM.words(v)], TOPIC_RUN)
        ayat |= {tuple(RASM.words(v)) for v in verses if 2 <= len(RASM.words(v)) <= 3}
    return {'grams': frozenset(grams), 'counts': counts, 'ayat': frozenset(ayat)}


def check(lesson, number, quran=None):
    if isinstance(lesson, dict) and lesson.get('kind') == 'reading':
        return check_reading(lesson, number, quran)
    errors = []
    err = errors.append
    if not isinstance(lesson, dict) or not KEYS <= set(lesson) or set(lesson) - KEYS - {'distractors'}:
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

    def word_checks(where, w, u, seen):
        """One word: of unit u, or a lesson-level distractor (u is None)."""
        t = w.get('text') if isinstance(w, dict) else None
        ww = f'{where} word {t!r}'
        if not isinstance(w, dict) or set(w) - (WORD_KEYS | {'finalMarkException'}) or not WORD_KEYS <= set(w):
            err(f'{ww}: keys are id, text, was, review (and finalMarkException)')
            return
        wid = w['id']
        owner = u['id'] if u else 'distractor'
        if not is_str(wid) or not WORD_ID.match(wid) or wid[:-4] != owner:
            err(f'{ww}: id {wid!r} must be {owner}-NNN (PD-48 voice-over binds a clip to it)')
        elif wid in word_ids:
            err(f'{ww}: id {wid!r} is used twice (ids are never reused)')
        elif wid in retired:
            err(f'{ww}: id {wid!r} is retired (a removed word\'s id is never reused)')
        word_ids.add(wid)
        if not is_word(t):
            err(f'{ww}: not one written word (letters and marks, in NFC)')
            return
        if t in seen:
            err(f'{ww}: listed twice')
        seen.add(t)
        vocabulary.add(t)
        if u and not has(t, u['letters'], u['_mark'], u['_after'], u['_tanween']):
            err(f'{ww}: does not contain the unit\'s letter {"/".join(u["letters"])}{" carrying its " + u["mark"] if u["_mark"] else ""}{" as a madd" if u["_after"] else ""}{" ending in its tanween" if u["_tanween"] else ""} (by the one rule: only marks are removed)')
        if sukun_on_madd(t):
            err(f'{ww}: a sukun on a madd letter ({t!r}): a madd letter is written bare')
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
        tanween = None
        if 'tanween' in u:
            # A tanween unit counts the word's END, whatever its letter: no letters, no mark, no madd.
            if not is_str(u['tanween']) or u['tanween'] not in TANWEEN_OF or u['letters'] != [] or 'mark' in u or 'madd' in u:
                err(f'{where}: tanween must be fath, damm or kasr, with no letters, mark or madd')
                continue
            tanween = TANWEEN_OF[u['tanween']]
        elif not isinstance(u['letters'], list) or not u['letters'] or not all(is_str(l) and l and all(is_letter(c) for c in l) for l in u['letters']):
            err(f'{where}: letters must be a list of letters (one, or a pair such as لا)')
            continue
        mark = None
        if 'mark' in u:
            if not is_str(u['mark']) or u['mark'] not in HARAKA or not all(len(l) == 1 for l in u['letters']):
                err(f'{where}: mark must be fatha, kasra, damma, sukun or shadda, on single letters')
                continue
            mark = HARAKA[u['mark']]
        after = None
        if 'madd' in u:
            if not is_str(u['madd']) or u['madd'] not in MADD or 'mark' in u or u['letters'] != [MADD[u['madd']][0]]:
                err(f'{where}: madd must be alif, ya or waw, the unit\'s one letter, and never with a mark')
                continue
            after = MADD[u['madd']][1]
        if 'group' in u and (not is_str(u['group']) or not 0 < len(u['group']) <= 8):
            err(f'{where}: group must be a short non-empty name (the letter)')
        u = {**u, '_mark': mark, '_after': after, '_tanween': tanween}
        units[u['id']] = u
        if 'phraseName' in u and (u['phraseName'] is not True or not mark):
            err(f'{where}: phraseName is true, on a marked unit only (lesson 6\'s one sukun unit)')
        if mark and u.get('phraseName') is not True:
            # A marked unit's name is its syllable: one of its letters with that mark (بَ), not a word.
            # (A unit flagged phraseName -- lesson 6's one sukun unit -- is named like any unit.)
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
        if not isinstance(u['forms'], list) or not u['forms'] or not all(is_str(f) and f and all(c == chr(0x640) or c == mark or c == after or c == tanween or any(c in l for l in u['letters']) for c in f) for f in u['forms']):
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
            word_checks(where, w, u, seen)

    # Lesson-level distractors (lesson 6, one unit): words that are only ever WRONG quiz options. They are
    # checked as words (tashkeel, ids, review) and join the vocabulary, but belong to no unit.
    distractors = lesson.get('distractors', [])
    if not isinstance(distractors, list):
        err('distractors must be a list')
        distractors = []
    unit_words = set(vocabulary)  # every word that belongs to a unit
    seen = set()
    for w in distractors:
        t = w.get('text') if isinstance(w, dict) else None
        if t in unit_words:
            err(f'distractors word {t!r}: is also a unit word (a distractor is only ever a wrong option)')
        for uu in units.values():
            if is_str(t) and has(t, uu['letters'], uu['_mark'], uu['_after'], uu['_tanween']):
                err(f'distractors word {t!r}: carries unit {uu["id"]!r}\'s feature, so it could be a right answer')
        word_checks('distractors', w, None, seen)

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
            right = [i for i, o in enumerate(opts) if has(o, unit['letters'], unit['_mark'], unit['_after'], unit['_tanween'])]
            if not is_int(q.get('answer')) or right != [q['answer']]:
                err(f'{where}: must have exactly one right answer, the answer (an index); by the one rule the right ones are {right}')
            elif opts[q['answer']] not in unit_words:
                err(f'{where}: the answer {opts[q["answer"]]!r} must be a unit\'s word, never a distractor')
            if unit['_after']:
                # A wrong option must not secretly have a madd the rule cannot see (هٰذَا، عَلَى، آ).
                for o in opts:
                    if uncounted_madd(o):
                        err(f'{where}: option {o!r} has a madd the madd rule does not count (dagger alif, ى after a fatha, or آ)')
        elif q.get('kind') == 'position':
            word = q.get('word')
            if not is_str(word) or word not in unit_words:
                err(f'{where}: {word!r} is not a unit\'s word of this lesson (never a distractor)')
                continue
            at = positions(word, unit['letters'], unit['_mark'], unit['_after'], unit['_tanween'])
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
    for c in fx['tanweenCases']:
        t = TANWEEN_OF[c['tanween']]
        if has(c['word'], [], None, None, t) != c['has'] or positions(c['word'], [], None, None, t) != c['positions']:
            out.append(f'fixture {c["word"]} / tanween {c["tanween"]}: got {has(c["word"], [], None, None, t)}, {positions(c["word"], [], None, None, t)}')
    for c in fx['maddChecks']:
        if sukun_on_madd(c['word']) != c['sukunOnMadd'] or uncounted_madd(c['word']) != c['uncountedMadd']:
            out.append(f'fixture {c["word"]}: sukun_on_madd {sukun_on_madd(c["word"])}, uncounted_madd {uncounted_madd(c["word"])}')
    for c in fx['maddCases']:
        letter, after = MADD[c['madd']]
        if has(c['word'], [letter], None, after) != c['has'] or positions(c['word'], [letter], None, after) != c['positions']:
            out.append(f'fixture {c["word"]} / madd {c["madd"]}: got {has(c["word"], [letter], None, after)}, {positions(c["word"], [letter], None, after)}')
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
    return out, len(fx['cases']) + len(fx['markedCases']) + len(fx['maddCases']) + len(fx['tanweenCases']) + len(fx['maddChecks']) + len(fx['marks']) + len(fx['letters']) + len(fx['words'])


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
        'harakat-bad-mark': (lambda c: c['units'][0].update(mark='hamza'), 'mark must be'),
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
                     {'id': 'q2', 'kind': 'missing', 'sentence': 'sentences-002', 'blank': 0, 'options': ['نَامَتِ', 'الْوَلَدُ'], 'answer': 0, 'review': None}],
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
        'reading-missing-option-not-in-another-sentence': (lambda c: c['quiz'][1].update(options=['الْقِطَّةُ', 'الْبَيْتُ']), 'another sentence', None),
        'reading-missing-option-from-its-own-sentence': (lambda c: c['quiz'][1].update(options=['الْقِطَّةُ', 'نَامَتِ']), 'another sentence', None),
        'reading-vowel-options-mixed': (lambda c: c['stages'][1]['items'].append({'id': 'kasra-002', 'kind': 'word', 'text': 'كِتِبِ', 'was': None, 'review': None})
                                        or c['quiz'][0].update(options=['كِتِبِ', 'بَتَ']), 'never mixed', None),
        'reading-pausal-sukun-inside': (lambda c: c['stages'][2]['items'][1].update(text='نَامَ الْوَلَدْ مُبَكِّرًا.'), 'inside the sentence', None),
        'reading-sukun-particle-inside-is-fine': (lambda c: c['stages'][2]['items'][1].update(text='نَامَتِ الْقِطَّةُ مِنْ تَعَبْ.'), None, None),
        'reading-feminine-ta-sakina-is-fine': (lambda c: c['stages'][2]['items'][1].update(text='نَامَتْ قِطَّتِي الصَّغِيرَةْ.') or c['quiz'].pop(), None, None),
        'reading-sukun-before-a-wasl': (lambda c: c['stages'][2]['items'][1].update(text='نَامَتْ الْقِطَّةُ الصَّغِيرَةْ.'), 'hamzat wasl', None),
        # The real #292 regression: the SUBJECT blanked and another sentence's subject offered -- it fits too.
        'reading-missing-subject-from-another-sentence': (lambda c: c['quiz'][1].update(blank=1, options=['الْقِطَّةُ', 'الْوَلَدُ'], answer=0), "the blank's place", None),
        'reading-missing-option-pausal': (lambda c: c['quiz'][1].update(options=['نَامَتِ', 'تُفَّاحًا']), 'last word', None),
        'reading-missing-option-own-sentence': (lambda c: c['stages'][2]['items'][1].update(text='نَامَتِ الْقِطَّةُ الْوَلَدُ الصَّغِيرَةْ.'), 'own sentence', None),
        'reading-missing-option-same-word': (lambda c: c['stages'][2]['items'][0].update(text='أَكَلَ الْوَلَدُ كِتَابًا', finalMarkException='the tanween fath')
                                             or c['stages'][2]['items'][1].update(text='نَامَتِ كِتَابْ الصَّغِيرَةْ.')
                                             or c['quiz'][1].update(sentence='sentences-001', blank=2, options=['كِتَابًا', 'كِتَابْ'], answer=0), 'another form', None),
        'reading-missing-option-another-name': (lambda c: c.update(names=['نَامَتْ', 'الْوَلَدْ']), 'another name', None),
        'reading-title-not-vowelled': (lambda c: c['passages'][0]['title'].update(text='القطة'), 'not fully vowelled', None),
        'reading-stage-name-not-pausal': (lambda c: c['stages'][2].update(name='جُمَلٌ'), 'not the pausal sukun', None),
    }
    for name, (mutate, expected, grams) in rcases.items():
        c = reading()
        mutate(c)
        errors = check(c, 5, frozenset() if grams is None else grams)
        ok = (not errors) if expected is None else any(expected in e for e in errors)
        if not ok:
            failed.append(f'{name}: expected {expected or "no errors"}, got {errors}')
    # Lessons 6 and 7: a sukun unit (never the last letter) and a madd unit (bare after its vowel).
    def sukun_madd():
        return {
            'lesson': 6, 'review': {'status': 'pending', 'by': None, 'note': ''}, 'provenance': {}, 'finalMark': 'sukun', 'retiredIds': [],
            'units': [
                {'id': 'jim_sukun', 'letters': ['ج'], 'mark': 'sukun', 'group': 'ج', 'name': 'جْ', 'forms': ['جْ'], 'note': None,
                 'words': [{'id': 'jim_sukun-001', 'text': 'نَجْمْ', 'was': None, 'review': None}]},
                {'id': 'madd_alif', 'letters': ['ا'], 'madd': 'alif', 'name': 'أَلِفْ', 'forms': ['ـَا'], 'note': None,
                 'words': [{'id': 'madd_alif-001', 'text': 'بَابْ', 'was': None, 'review': None}]},
            ],
            'quiz': [{'id': 'q1', 'kind': 'contains', 'unit': 'jim_sukun', 'options': ['نَجْمْ', 'بَابْ'], 'answer': 0, 'review': None},
                     {'id': 'q2', 'kind': 'contains', 'unit': 'madd_alif', 'options': ['نَجْمْ', 'بَابْ'], 'answer': 1, 'review': None}],
        }
    scases = {
        'sukun-madd-clean': (lambda c: None, None),
        'sukun-only-on-the-last-letter': (lambda c: c['units'][0]['words'].append({'id': 'jim_sukun-002', 'text': 'مَوْجْ', 'was': None, 'review': None}), 'carrying its sukun'),
        'madd-ya-under-sukun-is-no-madd': (lambda c: c['units'][1].update(letters=['ي'], madd='ya', forms=['ـِي'], words=[{'id': 'madd_alif-001', 'text': 'بَيْتْ', 'was': None, 'review': None}]), 'as a madd'),
        'madd-wrong-letter': (lambda c: c['units'][1].update(madd='waw'), 'madd must be'),
        'madd-with-a-mark': (lambda c: c['units'][1].update(mark='fatha'), 'madd must be'),
        'madd-unknown': (lambda c: c['units'][1].update(madd='hamza'), 'madd must be'),
        'madd-not-a-string': (lambda c: c['units'][1].update(madd=['alif']), 'madd must be'),
        'mark-not-a-string': (lambda c: c['units'][0].update(mark=['sukun']), 'mark must be'),
        'madd-option-with-an-uncounted-madd': (lambda c: (c['units'][0]['words'].append({'id': 'jim_sukun-002', 'text': 'عَلَى', 'was': None, 'review': None}),
                                                          c['quiz'][1].update(options=['عَلَى', 'بَابْ'])), 'does not count'),
        'sukun-on-a-madd-letter': (lambda c: c['units'][1]['words'].append({'id': 'madd_alif-002', 'text': 'فَاْسْ', 'was': None, 'review': None}), 'written bare'),
        'silent-waw-is-no-madd': (lambda c: c['units'][1].update(letters=['و'], madd='waw', forms=['ـُو'], words=[{'id': 'madd_alif-001', 'text': 'أُولَئِكَ', 'was': None, 'review': None}]), 'as a madd'),
        'shadda-unit-clean': (lambda c: c['units'][0].update(id='dal_shadda', letters=['د'], mark='shadda', group='د', name='دّ', forms=['دّ'],
                                                             words=[{'id': 'dal_shadda-001', 'text': 'جَدَّةْ', 'was': None, 'review': None}]) or c['quiz'][0].update(unit='dal_shadda', options=['جَدَّةْ', 'بَابْ']) or c['quiz'][1].update(options=['جَدَّةْ', 'بَابْ']), None),
        'tanween-unit-clean': (lambda c: c['units'].append({'id': 'tanween_damm', 'letters': [], 'tanween': 'damm', 'name': 'تَنْوِينْ', 'forms': ['ـٌ'], 'note': None,
                                                            'words': [{'id': 'tanween_damm-001', 'text': 'كِتَابٌ', 'was': None, 'review': 'FINAL MARK EXCEPTION', 'finalMarkException': "the lesson's tanween"}]}), None),
        'one-sukun-unit-with-distractors': (lambda c: c.update(
            units=[{'id': 'sukun', 'phraseName': True, 'letters': ['ء', 'أ', 'إ', 'ؤ', 'ئ', 'ا', 'ب', 'ت', 'ة', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي', 'ى'], 'mark': 'sukun', 'name': 'سُكُونْ', 'forms': ['ـْ'], 'note': None,
                    'words': [{'id': 'sukun-001', 'text': 'نَجْمْ', 'was': None, 'review': None}, {'id': 'sukun-002', 'text': 'بَحْرْ', 'was': None, 'review': None}]}],
            distractors=[{'id': 'distractor-001', 'text': 'كَتَبَ', 'was': None, 'review': 'FINAL MARK EXCEPTION', 'finalMarkException': "the lesson's vowel on the last letter"},
                         {'id': 'distractor-002', 'text': 'قَلَمْ', 'was': None, 'review': None}],
            quiz=[{'id': 'q1', 'kind': 'contains', 'unit': 'sukun', 'options': ['قَلَمْ', 'نَجْمْ', 'كَتَبَ'], 'answer': 1, 'review': None}]), None),
        'distractor-wrong-id': (lambda c: c.update(distractors=[{'id': 'jim_sukun-009', 'text': 'قَلَمْ', 'was': None, 'review': None}]), 'must be distractor-NNN'),
        'distractor-carrying-the-mark': (lambda c: c.update(distractors=[{'id': 'distractor-001', 'text': 'حَجْمْ', 'was': None, 'review': None}])
                                         or c['quiz'][0].update(options=['نَجْمْ', 'حَجْمْ']), 'exactly one right answer'),
        'unknown-lesson-key': (lambda c: c.update(extras=[]), 'keys must be'),
        'distractor-is-a-unit-word': (lambda c: c.update(distractors=[{'id': 'distractor-001', 'text': 'نَجْمْ', 'was': None, 'review': None}]), 'also a unit word'),
        'distractor-carrying-a-feature': (lambda c: c.update(distractors=[{'id': 'distractor-001', 'text': 'حَجْمْ', 'was': None, 'review': None}]), 'feature'),
        'distractor-as-a-wrong-option-is-fine': (lambda c: c.update(distractors=[{'id': 'distractor-001', 'text': 'قَلَمْ', 'was': None, 'review': None}])
                                   or c['quiz'][1].update(options=['قَلَمْ', 'نَجْمْ'], answer=1, unit='jim_sukun') or c['quiz'][0].update(options=['بَابْ', 'قَلَمْ'], answer=0, unit='madd_alif'), None),
        'phrase-name-without-the-flag': (lambda c: c['units'][0].update(name='جِيمٌ سَاكِنَةْ'), 'must be the syllable'),
        'phrase-name-flag-not-true': (lambda c: c['units'][0].update(phraseName='yes'), 'phraseName is true'),
        'phrase-name-flag-unmarked': (lambda c: c['units'][1].update(phraseName=True), 'phraseName is true'),
        'tanween-with-letters': (lambda c: c['units'].append({'id': 'tanween_damm', 'letters': ['ب'], 'tanween': 'damm', 'name': 'تَنْوِينْ', 'forms': ['ـٌ'], 'note': None,
                                                              'words': []}), 'tanween must be'),
    }
    for name, (mutate, expected) in scases.items():
        c = sukun_madd()
        mutate(c)
        errors = check(c, 6)
        ok = (not errors) if expected is None else any(expected in e for e in errors)
        if not ok:
            failed.append(f'{name}: expected {expected or "no errors"}, got {errors}')
    # Real Quran, typed in standard spelling (review of #290), as code points: each must be REFUSED by the
    # reading check against the verified text; an ordinary sentence must pass.
    U = lambda *c: ''.join(map(chr, c))
    real = [
        ('the vocative, 31:17', U(0x64a, 0x64e, 0x627, 0x20, 0x628, 0x64f, 0x646, 0x64e, 0x64a, 0x64e, 0x651, 0x20, 0x623, 0x64e, 0x642, 0x650, 0x645, 0x650, 0x20, 0x627, 0x644, 0x635, 0x64e, 0x651, 0x644, 0x64e, 0x627, 0x629, 0x64e)),
        ('the vocative, 2:21', U(0x64a, 0x64e, 0x627, 0x20, 0x623, 0x64e, 0x64a, 0x64f, 0x651, 0x647, 0x64e, 0x627, 0x20, 0x627, 0x644, 0x64e, 0x651, 0x630, 0x650, 0x64a, 0x646, 0x64e, 0x20, 0x622, 0x645, 0x64e, 0x646, 0x64f, 0x648, 0x627)),
        ('the vocative, 7:59', U(0x64a, 0x64e, 0x627, 0x20, 0x642, 0x64e, 0x648, 0x652, 0x645, 0x650, 0x20, 0x627, 0x639, 0x652, 0x628, 0x64f, 0x62f, 0x64f, 0x648, 0x627, 0x20, 0x627, 0x644, 0x644, 0x64e, 0x651, 0x647, 0x64e)),
        ('a prefix on the edge, 20:114', U(0x648, 0x64e, 0x631, 0x64e, 0x628, 0x650, 0x651, 0x20, 0x632, 0x650, 0x62f, 0x652, 0x646, 0x650, 0x64a, 0x20, 0x639, 0x650, 0x644, 0x652, 0x645, 0x64b, 0x627)),
        ('across 112:1-2', U(0x623, 0x64e, 0x62d, 0x64e, 0x62f, 0x64c, 0x20, 0x627, 0x644, 0x644, 0x64e, 0x651, 0x647, 0x64f, 0x20, 0x627, 0x644, 0x635, 0x64e, 0x651, 0x645, 0x64e, 0x62f, 0x64f)),
    ]
    ordinary = U(0x623, 0x64e, 0x643, 0x64e, 0x644, 0x64e, 0x20, 0x627, 0x644, 0x652, 0x648, 0x64e, 0x644, 0x64e, 0x62f, 0x64f, 0x20, 0x62a, 0x64f, 0x641, 0x64e, 0x651, 0x627, 0x62d, 0x64b, 0x627)
    grams = quran_grams()
    for name, t in real:
        if not quran_runs(t, grams):
            failed.append(f'quran-{name}: typed Quran in standard spelling was not refused')
    if quran_runs(ordinary, grams):
        failed.append('quran-ordinary: an ordinary sentence was taken for Quran')
    try:
        check({'kind': 'reading'}, 5)
        failed.append('quran-no-grams: a reading check without the Quran did not refuse to run')
    except ValueError:
        pass
    # Topic lessons (Islamic Studies): prose, Quran by reference, hadith always held.
    def topic():
        return {
            'lesson': 8, 'kind': 'topic', 'fiqh': False, 'title': {'text': 'نبينا محمد', 'review': None},
            'review': {'status': 'pending', 'by': None, 'note': ''}, 'provenance': {}, 'retiredIds': [],
            'sections': [{'id': 'intro', 'title': {'text': 'من هو نبينا؟', 'review': None}, 'blocks': [
                {'id': 'intro-001', 'kind': 'text', 'text': 'نبينا محمد نحبه ونطيعه.', 'review': None},
                {'id': 'intro-002', 'kind': 'quran', 'surah': 85, 'from': 1, 'to': 2, 'review': None},
                {'id': 'intro-003', 'kind': 'hadith', 'source': 'a collection, number 1', 'text': 'نص', 'review': 'HADITH: held'}]}],
            'quiz': [{'id': 'q1', 'kind': 'choose', 'question': 'أين ولد النبي؟', 'options': ['مكة', 'المدينة'], 'answer': 0, 'review': None},
                     {'id': 'q2', 'kind': 'truefalse', 'statement': 'نحب نبينا', 'answer': True, 'review': None}],
        }
    toy_topic_quran = {'grams': runs_of(RASM.words('قُلْ هُوَ اللَّهُ أَحَدٌ'), TOPIC_RUN), 'counts': {85: 3},
                       'ayat': {tuple(RASM.words('اللَّهُ الصَّمَدُ')), tuple(RASM.words('خَلَقَ الْإِنسَانَ')),
                                tuple(RASM.words('مَلِكِ النَّاسِ'))}}
    tcases = {
        'topic-clean': (lambda c: None, None),
        'topic-hadith-shown': (lambda c: c['sections'][0]['blocks'][2].update(review=None), 'always held'),
        'topic-ref-out-of-range': (lambda c: c['sections'][0]['blocks'][1].update(to=4), 'not a range of the verified Quran'),
        'topic-ref-no-surah': (lambda c: c['sections'][0]['blocks'][1].update(surah=86), 'not a range of the verified Quran'),
        'topic-typed-quran': (lambda c: c['sections'][0]['blocks'][0].update(text='قال تعالى: قل هو الله أحد'), 'typed Quran'),
        'topic-madhhab-name': (lambda c: c['sections'][0]['blocks'][0].update(text='في المذهب الحنفي نفعل كذا'), 'names a madhhab'),
        'topic-unknown-block': (lambda c: c['sections'][0]['blocks'][0].update(kind='ayah'), 'a block is'),
        'topic-truefalse-not-bool': (lambda c: c['quiz'][1].update(answer='yes'), 'true or false'),
        'topic-approved-with-flags': (lambda c: c['sections'][0]['blocks'][0].update(review='a teacher checks it') or c['review'].update(status='approved', by='Teachers department'), 'still flagged'),
        'topic-approved-hadith-stays-held': (lambda c: c['review'].update(status='approved', by='Teachers department'), None),
        'topic-madhhab-word-alone': (lambda c: c['sections'][0]['blocks'][0].update(text='هذا عند الشافعية'), 'names a madhhab'),
        'topic-shafi-is-not-a-madhhab': (lambda c: c['sections'][0]['blocks'][0].update(text='النبي هو الشافع المشفع'), None),
        'topic-madhhab-alif-maqsura': (lambda c: c['sections'][0]['blocks'][0].update(text='على الرأي الحنفى'), 'names a madhhab'),
        'topic-madhhab-ta-as-ha': (lambda c: c['sections'][0]['blocks'][0].update(text='قالت حنفيه كذا'), 'names a madhhab'),
        'topic-madhhab-tanween-alif': (lambda c: c['sections'][0]['blocks'][0].update(text='كان حنفيًا'), 'names a madhhab'),
        'topic-madhhab-pronoun': (lambda c: c['sections'][0]['blocks'][0].update(text='هذا مذهبنا'), 'names a madhhab'),
        'topic-madhhab-plural': (lambda c: c['sections'][0]['blocks'][0].update(text='قال الشوافع'), 'names a madhhab'),
        'topic-madhhab-imam': (lambda c: c['sections'][0]['blocks'][0].update(text='قال أبو حنيفة'), 'names a madhhab'),
        'topic-madhhab-imam-2': (lambda c: c['sections'][0]['blocks'][0].update(text='روى أحمد بن حنبل'), 'names a madhhab'),
        'topic-madhhab-latin': (lambda c: c['sections'][0]['blocks'][0].update(text='the Shafi\'i view'), 'names a madhhab'),
        'topic-madhhab-in-an-option': (lambda c: c['quiz'][0].update(options=['مكة', 'المالكية']), 'names a madhhab'),
        'topic-madhhab-in-a-title': (lambda c: c['sections'][0]['title'].update(text='المذهب الحنبلي'), 'names a madhhab'),
        'topic-short-ayah-in-prose-passes': (lambda c: c['sections'][0]['blocks'][0].update(text='نقول: الله الصمد'), None),
        'topic-everyday-prose-passes': (lambda c: c['sections'][0]['blocks'][0].update(text='خلق الإنسان من طين، ونحب الناس'), None),
        'topic-whole-ayah-option': (lambda c: c['quiz'][0].update(options=['مكة', 'الله الصمد']), 'whole ayah'),
        'topic-whole-ayah-statement': (lambda c: c['quiz'][1].update(statement='خلق الإنسان'), 'whole ayah'),
        'topic-whole-ayah-title': (lambda c: c['title'].update(text='الله الصمد'), 'whole ayah'),
        'topic-whole-ayah-section-title': (lambda c: c['sections'][0]['title'].update(text='خَلَقَ الْإِنْسَانَ'), 'whole ayah'),
        'topic-whole-ayah-option-everyday': (lambda c: c['quiz'][0].update(options=['مكة', 'ملك الناس']), 'whole ayah'),
        'topic-ayah-question-not-standalone': (lambda c: c['quiz'][0].update(question='الله الصمد'), None),
        'topic-madhhab-imam-accusative': (lambda c: c['sections'][0]['blocks'][0].update(text='رأينا أبا حنيفة'), 'names a madhhab'),
        'topic-madhhab-imam-ahmad': (lambda c: c['sections'][0]['blocks'][0].update(text='قال الإمام أحمد'), 'names a madhhab'),
        'topic-madhhab-latin-abu-hanifa': (lambda c: c['sections'][0]['blocks'][0].update(text='as Abu Hanifa said'), 'names a madhhab'),
        'topic-madhhab-latin-imam-malik': (lambda c: c['sections'][0]['blocks'][0].update(text='Imam Malik said'), 'names a madhhab'),
        'topic-madhhab-latin-diacritics': (lambda c: c['sections'][0]['blocks'][0].update(text='the Shāfiʿī school'), 'names a madhhab'),
        'topic-madhhab-latin-shafiq-passes': (lambda c: c['sections'][0]['blocks'][0].update(text='my friend Shafiq'), None),
        'topic-madhhab-latin-hanif-passes': (lambda c: c['sections'][0]['blocks'][0].update(text='Ibrahim was hanif'), None),
        'topic-hanif-passes': (lambda c: c['sections'][0]['blocks'][0].update(text='كان إبراهيم حنيفًا'), None),
        'topic-fiqh-missing': (lambda c: c.pop('fiqh'), 'keys must be'),
        'topic-fiqh-not-bool': (lambda c: c.update(fiqh='no'), 'fiqh is true or false'),
        'topic-typed-quran-in-an-option': (lambda c: c['quiz'][0].update(options=['مكة', 'قل هو الله أحد']), 'typed Quran'),
        'topic-ref-from-greater-than-to': (lambda c: c['sections'][0]['blocks'][1].update(**{'from': 3, 'to': 2}), 'not a range'),
        'topic-ref-from-zero': (lambda c: c['sections'][0]['blocks'][1].update(**{'from': 0}), 'not a range'),
        'topic-choose-answer-out-of-range': (lambda c: c['quiz'][0].update(answer=2), 'option index'),
        'topic-choose-duplicate-options': (lambda c: c['quiz'][0].update(options=['مكة', 'مكة']), 'distinct options'),
        'topic-empty-quiz-id': (lambda c: c['quiz'][0].update(id=''), 'non-empty'),
        'topic-section-id-newline': (lambda c: c['sections'][0].update(id='intro\n'), 'lowercase slug'),
        'topic-fiqh-without-scholar': (lambda c: c.update(fiqh=True) or c['review'].update(status='approved', by='Teachers department'), 'qualified scholar'),
        'topic-fiqh-with-scholar': (lambda c: c.update(fiqh=True) or c['review'].update(status='approved', by='Teachers department', scholar='a qualified scholar'), None),
    }
    for name, (mutate, expected) in tcases.items():
        c = topic()
        mutate(c)
        errors = check_topic(c, 8, toy_topic_quran)
        ok = (not errors) if expected is None else any(expected in e for e in errors)
        if not ok:
            failed.append(f'{name}: expected {expected or "no errors"}, got {errors}')
    try:
        check_topic(topic(), 8)
        failed.append('topic-no-quran: a topic check without the Quran did not refuse to run')
    except ValueError:
        pass
    # A misnamed lesson file is refused, not skipped.
    if not stray_files(['lesson-001.json', FIXTURE_NAME, 'lesson-1.json', 'notes.json', 'index.ts']) == ['lesson-1.json', 'notes.json']:
        failed.append('stray-json: a misnamed .json is not refused')
    fx_failed, fx_count = fixture_failures()
    failed += fx_failed
    for f in failed:
        print(f'arabic-lesson selftest: FAIL {f}')
    if not failed:
        print(f'arabic-lesson selftest: {len(cases) + len(hcases) + len(scases) + len(rcases) + len(real) + len(tcases) + 4} cases, each caught; the shared letter fixture ({fx_count} cases) agrees with letters.ts')
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
    # The Islamic Studies lessons (topic lessons), in their own folder.
    inames = os.listdir(ISLAMIC) if os.path.isdir(ISLAMIC) else []
    for f in sorted(x for x in inames if x.endswith('.json') and not LESSON_FILE.fullmatch(x)):
        print(f'arabic-lesson: islamic/{f}: not a lesson file (lesson-NNN.json); a misnamed lesson would skip every check')
        failed += 1
    tfiles = sorted(x for x in inames if LESSON_FILE.fullmatch(x))
    tquran = topic_quran() if tfiles else None
    for f in tfiles:
        lesson = json.load(open(os.path.join(ISLAMIC, f), encoding='utf-8'))
        errors = check_topic(lesson, int(f[7:10]), tquran) if isinstance(lesson, dict) and lesson.get('kind') == 'topic' else ['kind must be "topic"']
        for e in errors:
            print(f'arabic-lesson: islamic/{f}: {e}')
        if errors:
            failed += 1
        else:
            held = sum(1 for s in lesson['sections'] for b in s['blocks'] if b['review']) + sum(1 for q in lesson['quiz'] if q['review'])
            print(f'arabic-lesson: islamic/{f}: topic lesson, every Quran reference in the verified text, no typed Quran, every hadith held, '
                  f'no madhhab name; review {lesson["review"]["status"]}, {held} item(s) held for a teacher')
    if not files and not failed:
        print('arabic-lesson: no Arabic lesson files yet')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
