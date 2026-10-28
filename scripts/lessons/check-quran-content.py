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
  * prose carries Uthmani-only marks or four consecutive words of ANY ayah of
    the Quran (typed Quran), checked run by run between quotations;
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
PIN = os.path.join(ROOT, 'apps', 'lessons', 'quran-pin.json')

_spec = importlib.util.spec_from_file_location('v1', os.path.join(HERE, 'check-lesson-content.py'))
v1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v1)

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


def quran_grams(all_verses):
    """RUN-word windows of every ayah of the Quran (a whole shorter ayah; never a one-word ayah, which reads as a name)."""
    grams = set()
    for v in all_verses:
        ws = v1.fold(v).split()
        if len(ws) < 2:
            continue
        k = min(v1.RUN, len(ws))
        grams.update(tuple(ws[i:i + k]) for i in range(len(ws) - k + 1))
    return grams


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


def check(content, verses, dataset_id, works, grams):
    """verses: the surah's verse texts, ayah 1 first; grams: quran_grams() of the whole Quran. Returns errors."""
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
        cited = ('crossCheck', 'ladder', 'aqeedah')
        shapes = {
            'intro': ((*common, 'source'), cited),
            'theme': ((*common, 'source'), cited),
            'tafsir': ((*common, 'source', 'ayah'), cited),
            'tafsir_x': ((*common, 'source', 'ayah'), cited),
            'word': ((*common, 'source', 'ayah', 'word', 'to'), cited),
            'lesson': ((*common, 'source'), (*cited, 'ayat', 'behaviour')),
            'reflection': ((*common, 'source', 'ideas'), cited),
            'story': ((*common, 'source', 'order'), (*cited, 'ayat')),
            'asbab': ((*common, 'source', 'ayat', 'verdicts'), ('pointer', 'aqeedah')),
            'quiz': ((*common, 'category', 'options', 'answer', 'basis'), ('prompt', 'word', 'aqeedah')),
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
        if 'aqeedah' in it and not isinstance(it['aqeedah'], bool):
            err(f'{where}: aqeedah must be true or false')
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

    # Typed Quran, run by run between quotations: Uthmani-only marks, or RUN
    # consecutive words of any ayah of the whole Quran (a whole shorter ayah).
    sizes = {len(g) for g in grams}
    for where, t in prose_runs:
        if v1.UTHMANI_ONLY.search(t):
            err(f'{where}: carries Uthmani-only marks (Quran belongs in positions or quotations, never typed)')
        ws = v1.fold(t).split()
        if any(tuple(ws[i:i + k]) in grams for k in sizes for i in range(len(ws) - k + 1)):
            err(f'{where}: contains {v1.RUN} consecutive words of an ayah, or a whole ayah (use a quotation, not typed Quran)')
    return errors


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
    grams = quran_grams(verses)

    def base():
        return json.loads(json.dumps(shared['base']).replace('{{pin}}', 'test-1'))

    failed = []
    for case in shared['cases']:
        c = apply_case(base(), case)
        errors = check(c, verses, 'test-1', works, grams)
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

    # The shared hash vectors (quran-content.test.ts checks the same file).
    failed += check_vectors(json.load(open(VECTORS, encoding='utf-8')))

    for f in failed:
        print(f'quran-content selftest: FAIL {f}')
    if not failed:
        print(f'quran-content selftest: {len(shared["cases"])} shared content cases and {len(appr_cases)} approval cases, each as expected; '
              'the registry and the hash vectors checked')
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
    for f in approvals:
        if f not in files:
            print(f'quran-content: approvals/{f}: no content file for it')
            failed += 1
    surahs = v1.verified_surahs() if files else {}
    grams = quran_grams([v for s in sorted(surahs) for v in surahs[s]]) if files else set()
    for f in files:
        number = int(f[6:9])
        content = json.load(open(os.path.join(QURAN, f), encoding='utf-8'))
        errors = []
        if os.path.exists(os.path.join(CONTENT, f)):
            errors.append('this surah also has a schema-1 file (content/' + f + '); a surah has one or the other')
        errors += check(content, surahs[number], dataset_id, works, grams) if content.get('surah') == number else [f'surah is {content.get("surah")!r}, not {number}']
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
