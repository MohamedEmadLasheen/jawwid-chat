#!/usr/bin/env python3
"""Check PD-49 children's Quran content (schema 2) against the verified Quran and the sources registry.

    python3 -I scripts/lessons/check-quran-content.py            # apps/lessons/src/content/quran/ + approvals/
    python3 -I scripts/lessons/check-quran-content.py selftest

Plan: docs/product/pd049-children-quran-experience-plan.md (sections A and F).
The engine applies the same rules in apps/lessons/src/content/quran-content.ts;
the two share apps/lessons/src/content/quran-content.cases.json.

A schema-2 file is our own child-level prose, each item citing a PUBLIC-DOMAIN
work from apps/lessons/src/content/sources.json, plus POSITIONS into the
verified text. This FAILS when:
  * the registry is malformed: an unknown role or kind, a duplicate work, an
    edition that is neither null nor a full pin;
  * an id is not `<kind>-NNN`, repeats, or reuses a retired id; text or a
    reference is not NFC or holds control characters;
  * a position or a word span does not exist in the verified surah; segments
    do not cover the ayat in order;
  * a quotation is not the token ﴿{{w:A:N}}﴾ / ﴿{{w:A:N-M}}﴾: unwrapped,
    touching typed text, two in a row with no prose between them (a skipped
    word would read as an altered ayah), or a stray {{, }}, ﴿ or ﴾;
  * an item cites a work in the wrong role (a modern "verdict" work as a
    source, a pointer such as al-Wahidi as the report, ...);
  * an asbab item fails the display rule (al-Muharrar says it is the reason,
    the chain is sound, nothing rejects it): disputed reports are left out;
  * a hifz quiz carries authored prose: its question must be a fixed key, its
    options positions, and it must carry the prompt or word its key names;
  * prose types Quran, checked run by run between quotations on the shared
    rasm skeleton (scripts/lessons/rasm.py, so standard spelling is caught too):
      - four consecutive words of ANY ayah of the Quran, or Uthmani-only marks: refused;
      - a whole 2-3-word ayah of the lesson's own surah: refused;
      - a whole 2-3-word ayah of another surah: a possible quotation -- the item
        must carry "scholarCheck": true, which adds the scholar's step
        (department head's calibration on PD-29's data, 2026-10-29: whole-Quran
        matches shorter than four words are mostly ordinary tafsir phrasing);
  * a surah has both a schema-1 and a schema-2 file;
  * an approval names a missing item, does not match the item's approval hash
    (canonical JSON of {datasetId, lessonKey, item}), lacks a required review
    step, or covers an item citing a work whose edition is not pinned.
Standard library only; reads files.
"""
import copy
import hashlib
import importlib.util
import json
import os
import re
import sys
import unicodedata

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CONTENT = os.path.join(ROOT, 'apps', 'lessons', 'src', 'content')
QURAN = os.path.join(CONTENT, 'quran')
APPROVALS = os.path.join(CONTENT, 'approvals')
SOURCES = os.path.join(CONTENT, 'sources.json')
VECTORS = os.path.join(CONTENT, 'item-hash.vectors.json')
CASES = os.path.join(CONTENT, 'quran-content.cases.json')
MECHANICS = os.path.join(ROOT, 'apps', 'lessons', 'src', 'play', 'mechanics.json')
GAMES_DIR = os.path.join(ROOT, 'apps', 'lessons', 'src', 'play', 'games')
PLAY_APPROVALS = os.path.join(APPROVALS, 'play.json')
RASM_VECTORS = os.path.join(ROOT, 'apps', 'lessons', 'src', 'quran', 'rasm.vectors.json')
PIN = os.path.join(ROOT, 'apps', 'lessons', 'quran-pin.json')

def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


v1 = _load('v1', 'check-lesson-content.py')
# The ONE typed-Quran fold, shared with PD-29 and PD-48 (rasm.py). Positions keep v1.fold.
RASM = _load('rasm', 'rasm.py')
rasm = RASM.rasm

BANDS = ('3-5', '6-8', '9-12')
KINDS = ('intro', 'tafsir', 'tafsir_x', 'word', 'lesson', 'reflection', 'story', 'theme', 'asbab', 'quiz')
ROLES = ('primary', 'cross-check', 'report', 'pointer', 'verdict')
STEPS = ('check', 'teacher', 'scholar')
CATEGORIES = ('hifz', 'meanings', 'tafsir', 'lessons', 'asbab')
# The fixed hifz questions (HIFZ_QUESTIONS in quran-content.ts) and what each must carry.
HIFZ_QUESTIONS = {'hifz.complete': 'prompt', 'hifz.which_ayah': 'word'}
SOUND = ('sahih', 'hasan')
UNSOUND = ('daif', 'mursal', 'mawdu')
SAHIHAYN = ('bukhari', 'muslim')
# Who may grade a chain sound: al-Muzaini, al-Wadi'i, and Ibn Hajar (Fath al-Bari, public domain).
CHAIN_JUDGES = ('muzaini-muharrar', 'wadii-sahih-musnad', 'ibn-hajar-fath')
# What an item's `source` may be: asbab tell a report; a story retells the surah (a tafsir) or a report.
SOURCE_ROLES = {'asbab': ('report',), 'story': ('primary', 'report')}
EDITION_KEYS = {'printer', 'place', 'year', 'pages', 'why'}
ID = re.compile(r'^([a-z][a-z0-9_]*)-([0-9]{3})$')
SEGMENT_ID = re.compile(r'^seg-[0-9]{3}$')
OPEN, CLOSE = '﴿', '﴾'
QUOTE = re.compile('﴿' + r'\{\{w:(\d+):(\d+)(?:-(\d+))?\}\}' + '﴾')
CONTROL = re.compile('[\x00-\x1f\x7f]')


def canonical_json(value):
    """The same bytes as canonicalJson() in quran-content.ts."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def canonical_sha256(value):
    return hashlib.sha256(canonical_json(value).encode('utf-8')).hexdigest()


def approval_sha256(dataset_id, lesson_key, item):
    """What an approval binds (approvalSha256 in quran-content.ts): the item, in its dataset and lesson."""
    return canonical_sha256({'datasetId': dataset_id, 'item': item, 'lessonKey': lesson_key})


def required_steps(item):
    kind = item.get('kind')
    if item.get('scholarCheck'):
        return ('check', 'teacher', 'scholar')
    if kind == 'word':
        return ('check', 'teacher', 'scholar') if item.get('aqeedah') else ('check', 'teacher')
    if kind == 'quiz':
        heavy = item.get('category') in ('tafsir', 'asbab', 'lessons') or item.get('aqeedah')
        return ('check', 'teacher', 'scholar') if heavy else ('check', 'teacher')
    return ('check', 'teacher', 'scholar')


def passes_asbab_rule(source, verdicts):
    is_reason = any(v.get('work') == 'muzaini-muharrar' and v.get('reason') == 'is' for v in verdicts)
    rejected = any(v.get('reason') == 'is-not' or v.get('chain') in UNSOUND for v in verdicts)
    sound = source.get('work') in SAHIHAYN or any(v.get('work') in CHAIN_JUDGES and v.get('chain') in SOUND for v in verdicts)
    return is_reason and sound and not rejected


def is_letter(ch):
    return bool(ch) and unicodedata.category(ch)[0] in ('L', 'N')


def is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def quran_index(all_verses, own_verses):
    """What typed prose is matched against, on the rasm skeleton.

    all_verses: every ayah of the Quran (and the Basmala, which the verses carry
    apart); own_verses: the lesson's own surah. Returns (refuse4, own_short, short):
      refuse4    four-word windows of every ayah;
      own_short  whole 2-3-word ayat of the own surah (refused);
      short      whole 2-3-word ayat of other surahs (a possible quotation: held
                 for the scholar).
    One-word ayat are left out everywhere, as in schema 1: the disjointed
    letters fold to ordinary particles (alif-lam-mim to lam-mim, "not") and
    many one-word ayat are surah names, so they would flag ordinary prose.
    """
    refuse4, own_short, short = set(), set(), set()
    for v in all_verses:
        ws = tuple(rasm(v).split())
        if len(ws) >= v1.RUN:
            refuse4.update(ws[i:i + v1.RUN] for i in range(len(ws) - v1.RUN + 1))
        elif len(ws) >= 2:
            short.add(ws)
    for v in own_verses:
        ws = tuple(rasm(v).split())
        if 2 <= len(ws) < v1.RUN:
            own_short.add(ws)
            short.discard(ws)
    return refuse4, own_short, short


def check_sources(reg):
    errors = []
    works = reg.get('works') if isinstance(reg, dict) else None
    if not isinstance(works, list) or not works:
        return ['sources: works must be a non-empty list'], {}
    out = {}
    for w in works:
        wid = w.get('id') if isinstance(w, dict) else None
        if not isinstance(wid, str) or not re.fullmatch(r'[a-z][a-z0-9-]*', wid) or wid in out:
            errors.append(f'sources: bad or repeated work id {wid!r}')
            continue
        if w.get('role') not in ROLES:
            errors.append(f'sources: {wid}: role must be one of {ROLES}')
        if not isinstance(w.get('kinds'), list) or not w['kinds'] or not all(k in KINDS for k in w['kinds']):
            errors.append(f'sources: {wid}: kinds must be a non-empty list of {KINDS}')
        for k in ('title', 'author'):
            if not isinstance(w.get(k), str) or not w[k].strip():
                errors.append(f'sources: {wid}: {k} must be text')
        if not isinstance(w.get('protectedIn'), list):
            errors.append(f'sources: {wid}: protectedIn must be a list')
        ed = w.get('edition')
        if ed is not None and not is_pinned(ed):
            errors.append(f'sources: {wid}: edition must be null or exactly {sorted(EDITION_KEYS)}, each non-empty')
        out[wid] = w
    return errors, out


def is_pinned(ed):
    return isinstance(ed, dict) and set(ed) == EDITION_KEYS and all(isinstance(ed[k], str) and ed[k].strip() for k in EDITION_KEYS)


def check(content, verses, dataset_id, works, index):
    """verses: the surah's verse texts, ayah 1 first; index: quran_index() for this surah. Returns errors."""
    errors = []
    err = errors.append
    n = len(verses)
    words = [v1.words_of(v) for v in verses]
    prose_runs = []

    def keys(where, o, required, optional=()):
        if not isinstance(o, dict):
            err(f'{where}: must be an object')
            return False
        missing = [k for k in required if k not in o]
        unknown = [k for k in o if k not in required and k not in optional]
        if missing or unknown:
            err(f'{where}: missing {missing}, unknown {unknown}')
            return False
        return True

    def plain(where, t):
        """Non-empty NFC text with no control characters."""
        if not isinstance(t, str) or not t.strip():
            err(f'{where}: must be non-empty text')
            return False
        if unicodedata.normalize('NFC', t) != t:
            err(f'{where}: must be NFC')
        if CONTROL.search(t):
            err(f'{where}: holds a control character')
        return True

    def text(where, t):
        """Prose with quotations: each wrapped, touching no letter, prose between two of them."""
        if not plain(where, t):
            return
        last = 0
        prev_quote = False
        for m in QUOTE.finditer(t):
            before = t[last:m.start()]
            if prev_quote and not any(is_letter(c) for c in before):
                err(f'{where}: two quotations need prose between them (a skipped word would read as an altered ayah)')
            if before and is_letter(before[-1]):
                err(f'{where}: a quotation may not touch typed text')
            if before:
                prose_runs.append((where, before))
            a, f, to = int(m.group(1)), int(m.group(2)), int(m.group(3) or m.group(2))
            span(f'{where} quotation {m.group(0)}', a, f, to)
            last = m.end()
            if is_letter(t[last:last + 1]):
                err(f'{where}: a quotation may not touch typed text')
            prev_quote = True
        rest = t[last:]
        if rest:
            prose_runs.append((where, rest))
        stripped = QUOTE.sub('', t)
        if '{{' in stripped or '}}' in stripped or OPEN in stripped or CLOSE in stripped:
            err(f'{where}: a malformed quotation (write {OPEN}{{{{w:A:N}}}}{CLOSE})')

    def ayah(where, a):
        if not is_int(a) or not 1 <= a <= n:
            err(f'{where}: {a!r} is not an ayah of this surah (1..{n})')
            return False
        return True

    def span(where, a, f, to):
        if not ayah(where, a):
            return None
        if not is_int(f) or not is_int(to) or not 1 <= f <= to <= len(words[a - 1]):
            err(f'{where}: words {f!r}..{to!r} are not words of ayah {a}')
            return None
        return ' '.join(words[a - 1][f - 1:to])

    def pair(where, x):
        if not isinstance(x, list) or len(x) != 2 or not all(ayah(where, a) for a in x) or x[1] < x[0]:
            err(f'{where}: ayat must be [from, to] in this surah')

    def cite(where, c, roles, kind):
        if not keys(where, c, ('work', 'ref')):
            return
        w = works.get(c['work']) if isinstance(c['work'], str) else None
        if w is None:
            err(f'{where}: unknown work {c["work"]!r}')
        elif w.get('role') not in roles:
            err(f'{where}: {c["work"]} is a {w.get("role")} work; here it must be {roles}')
        elif w['role'] not in ('pointer', 'verdict') and kind not in w.get('kinds', []):
            err(f'{where}: {c["work"]} is not a source for {kind}')
        if plain(f'{where}.ref', c['ref']) and len(c['ref']) > 120:
            err(f'{where}: ref must be a short reference')

    top = ('schema', 'surah', 'datasetId', 'lessonKey', 'retiredIds', 'segments', 'items')
    if not keys('file', content, top):
        return errors
    if content['schema'] != 2:
        err('schema must be 2')
    if content['datasetId'] != dataset_id:
        err(f'datasetId {content["datasetId"]!r} is not the pinned {dataset_id!r}')
    surah_no = content['surah'] if is_int(content['surah']) else -1
    if content['lessonKey'] != f'quran-{surah_no:03d}':
        err('lessonKey must be quran-NNN for this surah')
    retired = content['retiredIds']
    if not isinstance(retired, list) or not all(isinstance(r, str) and ID.match(r) for r in retired) or len(set(map(str, retired))) != len(retired):
        err('retiredIds must be unique <kind>-NNN ids')
        retired = []

    nxt = 1
    themes = []
    for i, s in enumerate(content['segments'] if isinstance(content['segments'], list) else []):
        if not keys(f'segments[{i}]', s, ('id', 'from', 'to'), ('theme',)):
            continue
        if not isinstance(s['id'], str) or not SEGMENT_ID.match(s['id']) or s['from'] != nxt or not is_int(s['to']) or not nxt <= s['to'] <= n:
            err(f'segments[{i}]: segments must cover ayat 1..{n} in order')
        else:
            nxt = s['to'] + 1
        if 'theme' in s:
            if isinstance(s['theme'], str):
                themes.append(s['theme'])
            else:
                err(f'segments[{i}]: theme must be an item id')
    if nxt != n + 1:
        err(f'segments must cover every ayah 1..{n}')

    seen = set()
    tafsir_ayat = set()
    items = content['items'] if isinstance(content['items'], list) else []
    if not isinstance(content['items'], list):
        err('items must be a list')
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            err(f'items[{i}]: must be an object')
            continue
        iid, kind = it.get('id'), it.get('kind')
        where = f'item {iid}'
        m = ID.match(iid) if isinstance(iid, str) else None
        if not m or kind not in KINDS or m.group(1) != kind:
            err(f'items[{i}]: id {iid!r} must be <kind>-NNN with a known kind ({kind!r})')
            continue
        if iid in seen or iid in retired:
            err(f'{where}: id repeated or retired')
        seen.add(iid)
        bands = it.get('bands')
        if not isinstance(bands, list) or not bands or len(set(map(str, bands))) != len(bands) or not all(b in BANDS for b in bands):
            err(f'{where}: bands must be a non-empty subset of {BANDS}')
        common = ('id', 'kind', 'bands', 'text')
        cited = ('crossCheck', 'ladder', 'aqeedah', 'scholarCheck')
        shapes = {
            'intro': ((*common, 'source'), cited),
            'theme': ((*common, 'source'), cited),
            'tafsir': ((*common, 'source', 'ayah'), cited),
            'tafsir_x': ((*common, 'source', 'ayah'), cited),
            'word': ((*common, 'source', 'ayah', 'word', 'to'), cited),
            'lesson': ((*common, 'source'), (*cited, 'ayat', 'behaviour')),
            'reflection': ((*common, 'source', 'ideas'), cited),
            'story': ((*common, 'source', 'order'), (*cited, 'ayat')),
            'asbab': ((*common, 'source', 'ayat', 'verdicts'), ('pointer', 'aqeedah', 'scholarCheck')),
            'quiz': ((*common, 'category', 'options', 'answer', 'basis'), ('prompt', 'word', 'aqeedah', 'scholarCheck')),
        }
        if not keys(where, it, *shapes[kind]):
            continue
        hifz = kind == 'quiz' and it.get('category') == 'hifz'
        if hifz:
            # A fixed question, never prose (review of #255, P1).
            if it['text'] not in HIFZ_QUESTIONS:
                err(f'{where}: a hifz question is one of the fixed keys {sorted(HIFZ_QUESTIONS)}, never prose')
            elif HIFZ_QUESTIONS[it['text']] not in it:
                err(f'{where}: {it["text"]} needs its {HIFZ_QUESTIONS[it["text"]]}')
        else:
            text(f'{where}.text', it['text'])
        for flag in ('aqeedah', 'scholarCheck'):
            if flag in it and not isinstance(it[flag], bool):
                err(f'{where}: {flag} must be true or false')
        if kind != 'quiz':
            cite(f'{where}.source', it['source'], SOURCE_ROLES.get(kind, ('primary',)), kind)
        if 'crossCheck' in it:
            cite(f'{where}.crossCheck', it['crossCheck'], ('primary', 'cross-check'), kind)
        if 'ladder' in it:
            if not isinstance(it['ladder'], list) or not it['ladder']:
                err(f'{where}: ladder must be a non-empty list')
            else:
                for j, step in enumerate(it['ladder']):
                    text(f'{where}.ladder[{j}]', step)
        if kind in ('tafsir', 'tafsir_x'):
            if ayah(where, it['ayah']) and kind == 'tafsir':
                if it['ayah'] in tafsir_ayat:
                    err(f'{where}: a second tafsir for ayah {it["ayah"]}')
                tafsir_ayat.add(it['ayah'])
        elif kind == 'word':
            span(where, it['ayah'], it['word'], it['to'])
        elif kind == 'lesson':
            if 'ayat' in it:
                pair(where, it['ayat'])
            if it.get('behaviour', 'good') not in ('good', 'bad'):
                err(f'{where}: behaviour must be good or bad')
        elif kind == 'reflection':
            if not isinstance(it['ideas'], list) or not it['ideas']:
                err(f'{where}: ideas must be a non-empty list')
            else:
                for j, idea in enumerate(it['ideas']):
                    text(f'{where}.ideas[{j}]', idea)
        elif kind == 'story':
            if not is_int(it['order']) or it['order'] < 1:
                err(f'{where}: order must be a positive integer')
            if 'ayat' in it:
                pair(where, it['ayat'])
        elif kind == 'asbab':
            if not isinstance(bands, list) or any(b != '9-12' for b in bands):
                err(f'{where}: asbab is for the 9-12 band only')
            pair(where, it['ayat'])
            if 'pointer' in it:
                cite(f'{where}.pointer', it['pointer'], ('pointer',), kind)
            verdicts = it['verdicts'] if isinstance(it['verdicts'], list) else []
            if not verdicts:
                err(f'{where}: verdicts must name the judgements (al-Muharrar at least)')
            for j, v in enumerate(verdicts):
                if keys(f'{where}.verdicts[{j}]', v, ('work', 'ref'), ('reason', 'chain')):
                    cite(f'{where}.verdicts[{j}]', {'work': v['work'], 'ref': v['ref']}, ('verdict',), kind)
                    if v.get('reason', 'is') not in ('is', 'is-not') or v.get('chain', 'sahih') not in SOUND + UNSOUND:
                        err(f'{where}.verdicts[{j}]: reason is is/is-not, chain one of {SOUND + UNSOUND}')
            if isinstance(it['source'], dict) and all(isinstance(v, dict) for v in verdicts) and not passes_asbab_rule(it['source'], verdicts):
                err(f'{where}: fails the asbab display rule (al-Muharrar must say it IS the reason, the chain must be sound, '
                    'and nothing may reject it); a disputed report is left out, not stored')
        elif kind == 'quiz':
            if it['category'] not in CATEGORIES:
                err(f'{where}: category must be one of {CATEGORIES}')
            opts = it['options']
            if not isinstance(opts, list) or not 2 <= len(opts) <= 4:
                err(f'{where}: 2 to 4 options')
                opts = []
            rendered = []
            for j, o in enumerate(opts):
                ow = f'{where}.options[{j}]'
                if isinstance(o, dict) and 'text' in o:
                    if hifz:
                        err(f'{ow}: a hifz option is a position, never text')
                    elif keys(ow, o, ('text',)):
                        text(ow, o['text'])
                        rendered.append(''.join(o['text']) if isinstance(o['text'], str) else None)
                elif isinstance(o, dict) and 'word' in o:
                    if keys(ow, o, ('ayah', 'word', 'to')):
                        rendered.append(span(ow, o['ayah'], o['word'], o['to']))
                elif keys(ow, o, ('ayah',)):
                    rendered.append(verses[o['ayah'] - 1] if ayah(ow, o['ayah']) else None)
            # Distinct as the child sees them (the engine compares the rendered text too).
            shown = [r for r in rendered if r is not None]
            if len(set(shown)) != len(shown):
                err(f'{where}: options must be distinct')
            if not is_int(it['answer']) or not 0 <= it['answer'] < max(len(opts), 1):
                err(f'{where}: answer must index an option')
            if not isinstance(it['basis'], list) or not all(isinstance(b, str) for b in it['basis']):
                err(f'{where}: basis must be a list of item ids')
            elif not hifz and not it['basis']:
                err(f'{where}: a quiz beyond hifz names the items it rests on (basis)')
            if 'prompt' in it and keys(f'{where}.prompt', it['prompt'], ('ayah', 'words')):
                p = it['prompt']
                if ayah(f'{where}.prompt', p['ayah']) and (not is_int(p['words']) or not 1 <= p['words'] < len(words[p['ayah'] - 1])):
                    err(f'{where}.prompt: shows the first 1..(count-1) words of an ayah')
            if 'word' in it and keys(f'{where}.word', it['word'], ('ayah', 'word', 'to')):
                span(f'{where}.word', it['word']['ayah'], it['word']['word'], it['word']['to'])
    for it in items:
        if isinstance(it, dict) and it.get('kind') == 'quiz' and isinstance(it.get('basis'), list):
            for b in it['basis']:
                if b not in seen:
                    err(f'item {it.get("id")}: basis {b!r} is not an item of this file')
    kinds_by_id = {it.get('id'): it.get('kind') for it in items if isinstance(it, dict) and isinstance(it.get('id'), str)}
    for t in themes:
        if kinds_by_id.get(t) != 'theme':
            err(f'segments: theme {t!r} is not a theme item')

    flagged = {it.get('id'): it.get('scholarCheck') is True for it in items if isinstance(it, dict)}
    errors += typed_quran(prose_runs, index, flagged)
    return errors


def typed_quran(prose_runs, index, flagged):
    """Typed Quran, run by run between quotations, on the rasm skeleton (see quran_index)."""
    errors = []
    err = errors.append
    refuse4, own_short, short = index
    for where, t in prose_runs:
        if v1.UTHMANI_ONLY.search(t):
            err(f'{where}: carries Uthmani-only marks (Quran belongs in positions or quotations, never typed)')
        ws = tuple(rasm(t).split())

        def has(table, sizes):
            return any(ws[i:i + k] in table for k in sizes for i in range(len(ws) - k + 1))
        if has(refuse4, (v1.RUN,)):
            err(f'{where}: contains {v1.RUN} consecutive words of an ayah (use a quotation, not typed Quran)')
        elif has(own_short, (2, 3)):
            err(f'{where}: contains a whole ayah of this surah (use a quotation, not typed Quran)')
        elif has(short, (2, 3)):
            item_id = where.split(' ')[1].split('.')[0] if where.startswith('item ') else None
            if not flagged.get(item_id):
                err(f'{where}: a possible quotation (a whole short ayah) -- set "scholarCheck": true so the scholar reviews it, '
                    'or quote it as a position')
    return errors


def _u(*cps):
    return ''.join(chr(c) for c in cps)


# Calibration fixtures on the real text (department head, 2026-10-29), as code points so no
# Arabic is typed into this rule: standard spellings, each folded by rasm() to meet the Uthmani.
DHALIKA_AL_KITAB = ' '.join([_u(0x630, 0x644, 0x643), _u(0x627, 0x644, 0x643, 0x62A, 0x627, 0x628), _u(0x644, 0x627), _u(0x631, 0x64A, 0x628)])  # 2:2
HADHA_MA_WAADA = ' '.join([_u(0x647, 0x630, 0x627), _u(0x645, 0x627), _u(0x648, 0x639, 0x62F), _u(0x627, 0x644, 0x631, 0x62D, 0x645, 0x646)])  # 36:52
KHALAQA_AL_INSAN = ' '.join([_u(0x62E, 0x644, 0x642), _u(0x627, 0x644, 0x625, 0x646, 0x633, 0x627, 0x646)])  # 55:3, a whole two-word ayah
ORDINARY = ' '.join([_u(0x633, 0x648, 0x631, 0x629), _u(0x627, 0x644, 0x625, 0x62E, 0x644, 0x627, 0x635), _u(0x62A, 0x639, 0x644, 0x645, 0x646, 0x627),
                     _u(0x623, 0x646), _u(0x627, 0x644, 0x644, 0x647), _u(0x648, 0x627, 0x62D, 0x62F)])  # "surat al-Ikhlas teaches us that Allah is one"
CALIBRATION = [
    # (name, prose, lesson surah, scholarCheck, expected: 'refused' | 'held' | 'ok')
    ('the standard Basmala', RASM.BASMALA, 112, False, 'refused'),
    ('Al-Ikhlas 1, in its own lesson', RASM.IKHLAS_1, 112, False, 'refused'),
    ('Al-Ikhlas 2 (two words), in its own lesson', RASM.IKHLAS_2, 112, False, 'refused'),
    ('Al-Ikhlas 2 in another lesson: held for the scholar', RASM.IKHLAS_2, 113, False, 'held'),
    ('Al-Ikhlas 2 in another lesson, flagged for the scholar', RASM.IKHLAS_2, 113, True, 'ok'),
    ('dhalika al-kitabu la rayba (2:2)', DHALIKA_AL_KITAB, 112, False, 'refused'),
    ('hadha ma wa\'ada al-rahman (36:52)', HADHA_MA_WAADA, 112, True, 'refused'),
    ('khalaqa al-insan (55:3) in a tafsir line: held, not refused', KHALAQA_AL_INSAN, 112, False, 'held'),
    ('khalaqa al-insan in its own lesson', KHALAQA_AL_INSAN, 55, False, 'refused'),
    ('ordinary prose about the surah', ORDINARY, 112, False, 'ok'),
]


def calibration_selftest(surahs):
    """surahs: {n: [verse texts]} of the verified Quran. Returns failures."""
    every = [v for n in sorted(surahs) for v in surahs[n]]
    failed = []
    for name, prose, lesson, flag, expected in CALIBRATION:
        errors = typed_quran([('item tafsir-001.text', 'شرح: ' + prose)], quran_index(every, surahs[lesson]), {'tafsir-001': flag})
        got = 'ok' if not errors else ('held' if all('possible quotation' in e for e in errors) else 'refused')
        if got != expected:
            failed.append(f'calibration {name}: expected {expected}, got {got} {errors}')
    return failed


def check_approvals(appr, content, works):
    errors = []
    err = errors.append
    if not isinstance(appr, dict) or set(appr) != {'surah', 'lessonKey', 'approvals'}:
        return ['approvals: keys must be exactly surah, lessonKey, approvals']
    if appr['surah'] != content.get('surah') or appr['lessonKey'] != content.get('lessonKey'):
        err('approvals: surah and lessonKey must match the content file')
    items = {it.get('id'): it for it in content.get('items', []) if isinstance(it, dict)}
    seen = set()
    for a in appr['approvals'] if isinstance(appr['approvals'], list) else []:
        aid = a.get('id') if isinstance(a, dict) else None
        if not isinstance(a, dict) or set(a) != {'id', 'approvalSha256', 'steps'} or not isinstance(aid, str) or aid in seen:
            err(f'approvals: {aid!r}: must be exactly id, approvalSha256, steps, once per item')
            continue
        seen.add(aid)
        it = items.get(aid)
        if it is None:
            err(f'approvals: {aid}: no such item')
            continue
        if a['approvalSha256'] != approval_sha256(content.get('datasetId'), content.get('lessonKey'), it):
            err(f'approvals: {aid}: stale -- the item, its dataset or its lesson changed after it was approved (re-export the approvals)')
        steps = a['steps'] if isinstance(a['steps'], list) else []
        if not all(s in STEPS for s in steps) or len(set(steps)) != len(steps):
            err(f'approvals: {aid}: steps must be distinct, from {STEPS}')
        missing = [s for s in required_steps(it) if s not in steps]
        if missing:
            err(f'approvals: {aid}: missing review step(s) {missing}')
        cited = [it.get(k) for k in ('source', 'crossCheck', 'pointer') if isinstance(it.get(k), dict)]
        cited += [v for v in it.get('verdicts', []) if isinstance(v, dict)]
        unpinned = sorted({str(c.get('work')) for c in cited if not is_pinned((works.get(c.get('work')) or {}).get('edition'))})
        if unpinned:
            err(f'approvals: {aid}: cites {unpinned} with no pinned edition; nothing is approved before its edition is pinned')
    return errors


MECHANIC_KEYS = {'id', 'version', 'nameAr', 'skill', 'bands', 'tiers', 'needsAudio', 'respect', 'code', 'codeSha256'}
SKILLS = ('listening', 'recitation', 'recognition', 'structure')
TIERS = ('L1', 'L2', 'L3', 'L4', 'L5')


def code_sha256(code, games_dir=GAMES_DIR):
    """SHA-256 of a game's file, a NUL byte, then common.tsx: the code a mechanic's signature covers."""
    with open(os.path.join(games_dir, code), 'rb') as f:
        game = f.read()
    with open(os.path.join(games_dir, 'common.tsx'), 'rb') as f:
        common = f.read()
    return hashlib.sha256(game + b'\0' + common).hexdigest()


def check_mechanics(reg, games_dir=GAMES_DIR):
    """The game mechanics registry (apps/lessons/src/play/mechanics.json; mechanics.ts applies the same).
    Each record names its game's file and carries the code's hash, so signing a mechanic signs its code:
    change the game (or common.tsx) and the hash, the record and so the approval no longer match."""
    errors = []
    items = reg.get('mechanics') if isinstance(reg, dict) else None
    if not isinstance(items, list):
        return ['mechanics: must be a list'], {}
    out = {}
    for m in items:
        mid = m.get('id') if isinstance(m, dict) else None
        if not isinstance(m, dict) or set(m) != MECHANIC_KEYS or not isinstance(mid, str) or not re.fullmatch(r'[a-z][a-z0-9_]{1,62}', mid) or mid in out:
            errors.append(f'mechanics: {mid!r}: exactly {sorted(MECHANIC_KEYS)}, a unique snake_case id')
            continue
        if not is_int(m['version']) or m['version'] < 1 or not isinstance(m['nameAr'], str) or not m['nameAr'].strip():
            errors.append(f'mechanics: {mid}: version and nameAr')
        if m['skill'] not in SKILLS or not isinstance(m['needsAudio'], bool):
            errors.append(f'mechanics: {mid}: skill one of {SKILLS}, needsAudio true or false')
        if not isinstance(m['bands'], list) or not m['bands'] or not all(b in BANDS for b in m['bands']):
            errors.append(f'mechanics: {mid}: bands')
        if not isinstance(m['tiers'], list) or not m['tiers'] or not all(t in TIERS for t in m['tiers']):
            errors.append(f'mechanics: {mid}: tiers')
        if not isinstance(m['respect'], list) or not m['respect'] or not all(isinstance(r, str) and r.strip() for r in m['respect']):
            errors.append(f'mechanics: {mid}: the respect rules (plan C.4) the scholar signs')
        code = m['code']
        if not isinstance(code, str) or not re.fullmatch(r'[A-Z][A-Za-z0-9]*\.tsx', code) or not os.path.isfile(os.path.join(games_dir, code)):
            errors.append(f'mechanics: {mid}: code must name its game file in play/games/')
        elif m['codeSha256'] != code_sha256(code, games_dir):
            errors.append(f'mechanics: {mid}: codeSha256 is not the code of {code} + common.tsx (the game changed: re-hash, and it is re-signed)')
        out[mid] = m
    return errors, out


def check_play_approvals(appr, mechanics, dataset_id):
    """A mechanic is signed by a teacher and the scholar, for its record as it is now."""
    errors = []
    if not isinstance(appr, dict) or set(appr) != {'scope', 'approvals'} or appr['scope'] != 'play' or not isinstance(appr['approvals'], list):
        return ['play approvals: exactly {"scope": "play", "approvals": [...]}']
    seen = set()
    for a in appr['approvals']:
        aid = a.get('id') if isinstance(a, dict) else None
        if not isinstance(a, dict) or set(a) != {'id', 'approvalSha256', 'steps'} or not isinstance(aid, str) or aid in seen:
            errors.append(f'play approvals: {aid!r}: exactly id, approvalSha256, steps, once per mechanic')
            continue
        seen.add(aid)
        m = mechanics.get(aid)
        if m is None:
            errors.append(f'play approvals: {aid}: no such mechanic')
            continue
        if a['approvalSha256'] != approval_sha256(dataset_id, 'play', m):
            errors.append(f'play approvals: {aid}: stale -- the mechanic changed after it was signed')
        if not isinstance(a['steps'], list) or 'teacher' not in a['steps'] or 'scholar' not in a['steps']:
            errors.append(f'play approvals: {aid}: a mechanic needs the teacher and the scholar')
    return errors


def check_vectors(vectors):
    errors = []
    for i, v in enumerate(vectors):
        got = canonical_sha256(v['item'])
        if got != v['sha256']:
            errors.append(f'item-hash vectors[{i}]: {got} != {v["sha256"]}')
    return errors


def apply_case(content, case):
    """The shared case operations (quran-content.test.ts applies the same)."""
    if case['op'] == 'none':
        return content
    at = content
    for p in case['path'][:-1]:
        at = at[p]
    last = case['path'][-1]
    if case['op'] == 'set':
        at[last] = copy.deepcopy(case['value'])
    elif case['op'] == 'delete':
        del at[last]
    elif case['op'] == 'append':
        at[last].append(copy.deepcopy(case['value']))
    return content


def selftest():
    shared = json.load(open(CASES, encoding='utf-8'))
    verses = shared['verses']
    pinned = {'printer': 'p', 'place': 'q', 'year': '1300', 'pages': 'vol/page', 'why': 'no modern apparatus'}

    def w(wid, role, kinds, edition=pinned):
        return {'id': wid, 'title': 't', 'author': 'a', 'role': role, 'kinds': kinds, 'protectedIn': [], 'edition': edition}
    reg = {'works': [
        w('saadi', 'primary', ['intro', 'tafsir', 'tafsir_x', 'word', 'lesson', 'reflection', 'story', 'theme'], None),
        w('sijistani-nuzha', 'primary', ['word']),
        w('baghawi', 'cross-check', ['tafsir', 'word']),
        w('bukhari', 'report', ['asbab', 'story']),
        w('tirmidhi', 'report', ['asbab']),
        w('wahidi-asbab', 'pointer', ['asbab']),
        w('muzaini-muharrar', 'verdict', ['asbab']),
        w('wadii-sahih-musnad', 'verdict', ['asbab']),
    ]}
    reg_errors, works = check_sources(reg)
    assert not reg_errors, reg_errors
    index = quran_index(verses, verses)

    def base():
        return json.loads(json.dumps(shared['base']).replace('{{pin}}', 'test-1'))

    failed = []
    for case in shared['cases']:
        c = apply_case(base(), case)
        errors = check(c, verses, 'test-1', works, index)
        ok = not errors if case['expect'] == 'ok' else bool(errors)
        if not ok:
            failed.append(f'{case["name"]}: expected {case["expect"]}, got {errors}')

    # Approvals.
    c = base()
    items = {it['id']: it for it in c['items']}

    def appr(*entries):
        return {'surah': 112, 'lessonKey': 'quran-112', 'approvals': list(entries)}

    def a(iid, steps=('check', 'teacher', 'scholar'), sha=None):
        return {'id': iid, 'approvalSha256': sha or approval_sha256('test-1', 'quran-112', items[iid]), 'steps': list(steps)}

    appr_cases = {
        'asbab-pinned-full': (appr(a('asbab-001')), None),
        'word-two-steps': (appr(a('word-001', ('check', 'teacher'))), None),
        'hifz-quiz-two-steps': (appr(a('quiz-002', ('check', 'teacher'))), None),
        'unpinned-edition': (appr(a('tafsir-001')), 'no pinned edition'),
        'stale': (appr(a('asbab-001', sha='0' * 64)), 'stale'),
        'copied-from-another-lesson': (appr(a('asbab-001', sha=approval_sha256('test-1', 'quran-113', items['asbab-001']))), 'stale'),
        'other-dataset': (appr(a('asbab-001', sha=approval_sha256('test-2', 'quran-112', items['asbab-001']))), 'stale'),
        'missing-scholar': (appr(a('asbab-001', ('check', 'teacher'))), 'missing review step'),
        'no-such-item': (appr({'id': 'tafsir-404', 'approvalSha256': '0' * 64, 'steps': ['check']}), 'no such item'),
        'twice': (appr(a('asbab-001'), a('asbab-001')), 'once per item'),
        'null-entry': (appr(None), 'once per item'),
        'bad-step': (appr(a('quiz-002', ('check', 'teacher', 'owner'))), 'steps must be'),
        'wrong-surah': ({'surah': 113, 'lessonKey': 'quran-112', 'approvals': []}, 'must match'),
    }
    for name, (ap, expected) in appr_cases.items():
        errors = check_approvals(ap, c, works)
        ok = (not errors) if expected is None else any(expected in e for e in errors)
        if not ok:
            failed.append(f'approvals {name}: expected {expected or "no errors"}, got {errors}')

    # The registry.
    for name, bad, expected in (
        ('partial edition', {'works': [dict(reg['works'][0], edition={'printer': 'p'})]}, 'edition must be'),
        ('truthy edition', {'works': [dict(reg['works'][0], edition=True)]}, 'edition must be'),
        ('repeated work', {'works': [reg['works'][0], reg['works'][0]]}, 'repeated'),
    ):
        if not any(expected in e for e in check_sources(bad)[0]):
            failed.append(f'sources: {name} was accepted')

    # The game mechanics and their signatures.
    mech_errors, mechanics = check_mechanics(json.load(open(MECHANICS, encoding='utf-8')))
    failed += mech_errors
    m0 = next(iter(mechanics.values()))
    play_cases = {
        'signed': ({'scope': 'play', 'approvals': [{'id': m0['id'], 'approvalSha256': approval_sha256('test-1', 'play', m0), 'steps': ['teacher', 'scholar']}]}, None),
        'teacher-only': ({'scope': 'play', 'approvals': [{'id': m0['id'], 'approvalSha256': approval_sha256('test-1', 'play', m0), 'steps': ['teacher']}]}, 'the scholar'),
        'stale': ({'scope': 'play', 'approvals': [{'id': m0['id'], 'approvalSha256': approval_sha256('test-1', 'play', dict(m0, version=9)), 'steps': ['teacher', 'scholar']}]}, 'stale'),
        'unknown': ({'scope': 'play', 'approvals': [{'id': 'nope_game', 'approvalSha256': '0' * 64, 'steps': ['teacher', 'scholar']}]}, 'no such mechanic'),
    }
    for name, (ap, expected) in play_cases.items():
        errors = check_play_approvals(ap, mechanics, 'test-1')
        ok = (not errors) if expected is None else any(expected in e for e in errors)
        if not ok:
            failed.append(f'play approvals {name}: expected {expected or "no errors"}, got {errors}')
    if check_mechanics({'mechanics': [dict(m0, extra=1)]})[0] == []:
        failed.append('mechanics: an extra field was accepted')
    for name, bad, expected in (
        ('duplicate id', [m0, dict(m0)], 'unique'),
        ('changed code', [dict(m0, codeSha256='0' * 64)], 'codeSha256'),
        ('no such file', [dict(m0, code='Nope.tsx')], 'code must name'),
        ('common.tsx', [dict(m0, code='common.tsx')], 'code must name'),
    ):
        if not any(expected in e for e in check_mechanics({'mechanics': bad})[0]):
            failed.append(f'mechanics: {name} was accepted')

    # The shared hash vectors (quran-content.test.ts checks the same file).
    failed += check_vectors(json.load(open(VECTORS, encoding='utf-8')))

    # The typed-Quran calibration, on the real verified text, and rasm()'s own fixtures.
    surahs = v1.verified_surahs()
    failed += calibration_selftest(surahs)
    if RASM.selftest(surahs) != 0:
        failed.append('rasm.py selftest')
    # The TypeScript port's vectors (apps/lessons/src/quran/rasm.vectors.json) are rasm.py's own.
    for v in json.load(open(RASM_VECTORS, encoding='utf-8'))['vectors']:
        if RASM.rasm(v['input']) != v['skeleton']:
            failed.append(f'rasm.vectors.json {v["name"]}: stale (regenerate it from rasm.py)')

    for f in failed:
        print(f'quran-content selftest: FAIL {f}')
    if not failed:
        print(f'quran-content selftest: {len(shared["cases"])} shared content cases, {len(appr_cases)} approval cases and '
              f'{len(CALIBRATION)} typed-Quran calibration cases on the verified text, each as expected; the registry and the hash vectors checked')
    return 1 if failed else 0


def main(argv):
    if argv[:1] == ['selftest']:
        return selftest()
    dataset_id = json.load(open(PIN, encoding='utf-8'))['datasetId']
    reg_errors, works = check_sources(json.load(open(SOURCES, encoding='utf-8')))
    for e in reg_errors:
        print(f'quran-content: {e}')
    failed = 1 if reg_errors else 0
    files = sorted(f for f in os.listdir(QURAN) if re.fullmatch(r'surah-\d{3}\.json', f)) if os.path.isdir(QURAN) else []
    approvals = sorted(f for f in os.listdir(APPROVALS) if re.fullmatch(r'surah-\d{3}\.json', f)) if os.path.isdir(APPROVALS) else []
    mech_errors, mechanics = check_mechanics(json.load(open(MECHANICS, encoding='utf-8'))) if os.path.exists(MECHANICS) else ([], {})
    play_errors = mech_errors + (check_play_approvals(json.load(open(PLAY_APPROVALS, encoding='utf-8')), mechanics, dataset_id)
                                 if os.path.exists(PLAY_APPROVALS) else [])
    for e in play_errors:
        print(f'quran-content: {e}')
    if play_errors:
        failed += 1
    elif mechanics:
        print(f'quran-content: {len(mechanics)} game mechanic(s) well formed; '
              f'{len(json.load(open(PLAY_APPROVALS, encoding="utf-8"))["approvals"]) if os.path.exists(PLAY_APPROVALS) else 0} signed')
    for f in approvals:
        if f not in files:
            print(f'quran-content: approvals/{f}: no content file for it')
            failed += 1
    surahs = v1.verified_surahs() if files else {}
    every = [v for s in sorted(surahs) for v in surahs[s]]
    for f in files:
        number = int(f[6:9])
        content = json.load(open(os.path.join(QURAN, f), encoding='utf-8'))
        errors = []
        if os.path.exists(os.path.join(CONTENT, f)):
            errors.append('this surah also has a schema-1 file (content/' + f + '); a surah has one or the other')
        errors += check(content, surahs[number], dataset_id, works, quran_index(every, surahs[number])) if content.get('surah') == number else [f'surah is {content.get("surah")!r}, not {number}']
        appr = None
        if f in approvals:
            appr = json.load(open(os.path.join(APPROVALS, f), encoding='utf-8'))
            errors += check_approvals(appr, content, works)
        for e in errors:
            print(f'quran-content: {f}: {e}')
        if errors:
            failed += 1
        else:
            total = len(content['items'])
            ok = len(appr['approvals']) if appr else 0
            print(f'quran-content: {f}: every position resolves, no typed Quran, every citation in its role; {ok}/{total} item(s) approved')
    if not files:
        print('quran-content: no schema-2 content yet; the sources registry is well formed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
