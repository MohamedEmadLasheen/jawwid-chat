#!/usr/bin/env python3
"""Check PD-49 children's Quran content (schema 2) against the verified Quran and the sources registry.

    python3 -I scripts/lessons/check-quran-content.py            # apps/lessons/src/content/quran/ + approvals/
    python3 -I scripts/lessons/check-quran-content.py selftest

Plan: docs/product/pd049-children-quran-experience-plan.md (sections A and F).
The engine applies the same rules in apps/lessons/src/content/quran-content.ts.

A schema-2 file is our own child-level prose, each item citing a PUBLIC-DOMAIN
work from apps/lessons/src/content/sources.json, plus POSITIONS into the
verified text. This FAILS when:
  * the registry is malformed: an unknown role or kind, a duplicate work, an
    edition that is neither null nor a full pin;
  * an id is not `<kind>-NNN`, repeats, or reuses a retired id; text is not NFC
    or holds control characters;
  * a position, a word span or a {{w:A:N[-M]}} token does not exist in the
    verified surah; segments do not cover the ayat in order;
  * an item cites a work in the wrong role (a modern "verdict" work as a
    source, a pointer such as al-Wahidi as the report, ...);
  * an asbab item fails the display rule (al-Muharrar says it is the reason,
    the chain is sound, nothing rejects it): disputed reports are left out;
  * prose carries Uthmani-only marks or four consecutive verse words (typed
    Quran), as in schema 1;
  * a surah has both a schema-1 and a schema-2 file;
  * an approval names a missing item, does not match the item's canonical
    SHA-256, lacks a required review step, or covers an item citing a work
    whose edition is not pinned.
Standard library only; reads files.
"""
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
PIN = os.path.join(ROOT, 'apps', 'lessons', 'quran-pin.json')

_spec = importlib.util.spec_from_file_location('v1', os.path.join(HERE, 'check-lesson-content.py'))
v1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v1)

BANDS = ('3-5', '6-8', '9-12')
KINDS = ('intro', 'tafsir', 'tafsir_x', 'word', 'lesson', 'reflection', 'story', 'theme', 'asbab', 'quiz')
ROLES = ('primary', 'cross-check', 'report', 'pointer', 'verdict')
STEPS = ('check', 'teacher', 'scholar')
CATEGORIES = ('hifz', 'meanings', 'tafsir', 'lessons', 'asbab')
SOUND = ('sahih', 'hasan')
UNSOUND = ('daif', 'mursal', 'mawdu')
SAHIHAYN = ('bukhari', 'muslim')
CHAIN_JUDGES = ('muzaini-muharrar', 'wadii-sahih-musnad', 'ibn-hajar-fath')
# What an item's `source` may be: asbab tell a report; a story retells the surah (a tafsir) or a report.
SOURCE_ROLES = {'asbab': ('report',), 'story': ('primary', 'report')}
EDITION_KEYS = {'printer', 'place', 'year', 'pages', 'why'}
ID = re.compile(r'^([a-z][a-z0-9_]*)-([0-9]{3})$')
SEGMENT_ID = re.compile(r'^seg-[0-9]{3}$')
TOKEN = re.compile(r'\{\{w:(\d+):(\d+)(?:-(\d+))?\}\}')
CONTROL = re.compile('[\x00-\x1f\x7f]')


def canonical_json(value):
    """The same bytes as canonicalJson() in quran-content.ts."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def item_sha256(item):
    return hashlib.sha256(canonical_json(item).encode('utf-8')).hexdigest()


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
        if ed is not None and (not isinstance(ed, dict) or set(ed) != EDITION_KEYS
                               or not all(isinstance(ed[k], str) and ed[k].strip() for k in EDITION_KEYS)):
            errors.append(f'sources: {wid}: edition must be null or exactly {sorted(EDITION_KEYS)}, each non-empty')
        out[wid] = w
    return errors, out


def check(content, verses, dataset_id, works):
    """verses: the surah's verse texts, ayah 1 first. Returns errors (empty = clean)."""
    errors = []
    err = errors.append
    n = len(verses)
    words = [v1.words_of(v) for v in verses]
    prose = []

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

    def text(where, t):
        if not isinstance(t, str) or not t.strip():
            err(f'{where}: must be non-empty text')
            return
        if unicodedata.normalize('NFC', t) != t:
            err(f'{where}: must be NFC')
        if CONTROL.search(t):
            err(f'{where}: holds a control character')
        for m in TOKEN.finditer(t):
            a, f, to = int(m.group(1)), int(m.group(2)), int(m.group(3) or m.group(2))
            span(f'{where} token {m.group(0)}', a, f, to)
        prose.append((where, TOKEN.sub(' ', t)))

    def ayah(where, a):
        if not isinstance(a, int) or isinstance(a, bool) or not 1 <= a <= n:
            err(f'{where}: {a!r} is not an ayah of this surah (1..{n})')
            return False
        return True

    def span(where, a, f, to):
        if not ayah(where, a):
            return
        if not all(isinstance(x, int) and not isinstance(x, bool) for x in (f, to)) or not 1 <= f <= to <= len(words[a - 1]):
            err(f'{where}: words {f!r}..{to!r} are not words of ayah {a}')

    def pair(where, x):
        if not isinstance(x, list) or len(x) != 2 or not all(ayah(where, a) for a in x) or x[1] < x[0]:
            err(f'{where}: ayat must be [from, to] in this surah')

    def cite(where, c, roles, kind):
        if not keys(where, c, ('work', 'ref')):
            return
        w = works.get(c['work'])
        if w is None:
            err(f'{where}: unknown work {c["work"]!r}')
        elif w.get('role') not in roles:
            err(f'{where}: {c["work"]} is a {w.get("role")} work; here it must be {roles}')
        elif w['role'] not in ('pointer', 'verdict') and kind not in w.get('kinds', []):
            err(f'{where}: {c["work"]} is not a source for {kind}')
        if not isinstance(c.get('ref'), str) or not c['ref'].strip() or len(c['ref']) > 120:
            err(f'{where}: ref must be a short reference')

    top = ('schema', 'surah', 'datasetId', 'lessonKey', 'retiredIds', 'segments', 'items')
    if not keys('file', content, top):
        return errors
    if content['schema'] != 2:
        err('schema must be 2')
    if content['datasetId'] != dataset_id:
        err(f'datasetId {content["datasetId"]!r} is not the pinned {dataset_id!r}')
    surah_no = content['surah'] if isinstance(content['surah'], int) else -1
    if content['lessonKey'] != f'quran-{surah_no:03d}':
        err('lessonKey must be quran-NNN for this surah')
    retired = content['retiredIds']
    if not isinstance(retired, list) or not all(isinstance(r, str) and ID.match(r) for r in retired) or len(set(retired)) != len(retired):
        err('retiredIds must be unique <kind>-NNN ids')
        retired = []

    nxt = 1
    themes = []
    for i, s in enumerate(content['segments'] if isinstance(content['segments'], list) else []):
        if not keys(f'segments[{i}]', s, ('id', 'from', 'to'), ('theme',)):
            continue
        if not isinstance(s['id'], str) or not SEGMENT_ID.match(s['id']) or s['from'] != nxt or not isinstance(s['to'], int) or not nxt <= s['to'] <= n:
            err(f'segments[{i}]: segments must cover ayat 1..{n} in order')
        else:
            nxt = s['to'] + 1
        if 'theme' in s:
            themes.append(s['theme'])
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
        if not isinstance(bands, list) or not bands or len(set(bands)) != len(bands) or not all(b in BANDS for b in bands):
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
            ayah(where, it['ayah'])
            if kind == 'tafsir':
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
            if not isinstance(it['order'], int) or isinstance(it['order'], bool) or it['order'] < 1:
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
            for j, o in enumerate(opts):
                ow = f'{where}.options[{j}]'
                if isinstance(o, dict) and 'text' in o:
                    if keys(ow, o, ('text',)):
                        text(ow, o['text'])
                elif isinstance(o, dict) and 'word' in o:
                    if keys(ow, o, ('ayah', 'word', 'to')):
                        span(ow, o['ayah'], o['word'], o['to'])
                elif keys(ow, o, ('ayah',)):
                    ayah(ow, o['ayah'])
            if len({canonical_json(o) for o in opts}) != len(opts):
                err(f'{where}: options must be distinct')
            if not isinstance(it['answer'], int) or isinstance(it['answer'], bool) or not 0 <= it['answer'] < max(len(opts), 1):
                err(f'{where}: answer must index an option')
            if not isinstance(it['basis'], list) or not all(isinstance(b, str) for b in it['basis']):
                err(f'{where}: basis must be a list of item ids')
            elif it['category'] != 'hifz' and not it['basis']:
                err(f'{where}: a quiz beyond hifz names the items it rests on (basis)')
            if 'prompt' in it and keys(f'{where}.prompt', it['prompt'], ('ayah', 'words')):
                p = it['prompt']
                if ayah(f'{where}.prompt', p['ayah']) and (not isinstance(p['words'], int) or not 1 <= p['words'] < len(words[p['ayah'] - 1])):
                    err(f'{where}.prompt: shows the first 1..(count-1) words of an ayah')
            if 'word' in it and keys(f'{where}.word', it['word'], ('ayah', 'word', 'to')):
                span(f'{where}.word', it['word']['ayah'], it['word']['word'], it['word']['to'])
    for it in items:
        if isinstance(it, dict) and it.get('kind') == 'quiz' and isinstance(it.get('basis'), list):
            for b in it['basis']:
                if b not in seen:
                    err(f'item {it.get("id")}: basis {b!r} is not an item of this file')
    kinds_by_id = {it.get('id'): it.get('kind') for it in items if isinstance(it, dict)}
    for t in themes:
        if kinds_by_id.get(t) != 'theme':
            err(f'segments: theme {t!r} is not a theme item')

    # Typed Quran: Uthmani-only marks, or RUN consecutive verse words (a whole
    # shorter ayah), as in schema 1. Tokens were replaced by a space first: a
    # word drawn from the verified text is a position, not typed Quran.
    grams = set()
    for v in verses:
        ws = v1.fold(v).split()
        if len(ws) < 2:
            continue
        k = min(v1.RUN, len(ws))
        grams.update(tuple(ws[i:i + k]) for i in range(len(ws) - k + 1))
    sizes = {len(g) for g in grams}
    for where, t in prose:
        if v1.UTHMANI_ONLY.search(t):
            err(f'{where}: carries Uthmani-only marks (Quran belongs in positions or {{{{w:A:N}}}} tokens, never typed)')
        ws = v1.fold(t).split()
        if any(tuple(ws[i:i + k]) in grams for k in sizes for i in range(len(ws) - k + 1)):
            err(f'{where}: contains {v1.RUN} consecutive words of the surah, or a whole ayah (use a position, not typed Quran)')
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
        if not isinstance(a, dict) or set(a) != {'id', 'itemSha256', 'steps'} or aid in seen:
            err(f'approvals: {aid!r}: must be exactly id, itemSha256, steps, once per item')
            continue
        seen.add(aid)
        it = items.get(aid)
        if it is None:
            err(f'approvals: {aid}: no such item')
            continue
        if a['itemSha256'] != item_sha256(it):
            err(f'approvals: {aid}: stale -- the item changed after it was approved (re-export the approvals)')
        steps = a['steps'] if isinstance(a['steps'], list) else []
        if not all(s in STEPS for s in steps) or len(set(steps)) != len(steps):
            err(f'approvals: {aid}: steps must be distinct, from {STEPS}')
        missing = [s for s in required_steps(it) if s not in steps]
        if missing:
            err(f'approvals: {aid}: missing review step(s) {missing}')
        cited = [it.get(k) for k in ('source', 'crossCheck', 'pointer') if isinstance(it.get(k), dict)]
        cited += [v for v in it.get('verdicts', []) if isinstance(v, dict)]
        unpinned = sorted({c.get('work') for c in cited if not (works.get(c.get('work')) or {}).get('edition')})
        if unpinned:
            err(f'approvals: {aid}: cites {unpinned} with no pinned edition; nothing is approved before its edition is pinned')
    return errors


def check_vectors(vectors):
    errors = []
    for i, v in enumerate(vectors):
        got = item_sha256(v['item'])
        if got != v['sha256']:
            errors.append(f'item-hash vectors[{i}]: {got} != {v["sha256"]}')
    return errors


def selftest():
    verses = ['ألف باء تاء ثاء', 'جيم حاء خاء', 'دال ذال راء زاي سين', 'شين صاد', 'قاف']
    pinned = {'printer': 'p', 'place': 'q', 'year': '1300', 'pages': 'vol/page', 'why': 'no modern apparatus'}
    reg = {'works': [
        {'id': 'saadi', 'title': 't', 'author': 'a', 'role': 'primary', 'kinds': ['intro', 'tafsir', 'tafsir_x', 'word', 'lesson', 'reflection', 'story', 'theme'], 'protectedIn': [], 'edition': None},
        {'id': 'baghawi', 'title': 't', 'author': 'a', 'role': 'cross-check', 'kinds': ['tafsir', 'word'], 'protectedIn': [], 'edition': pinned},
        {'id': 'bukhari', 'title': 't', 'author': 'a', 'role': 'report', 'kinds': ['asbab', 'story'], 'protectedIn': [], 'edition': pinned},
        {'id': 'tirmidhi', 'title': 't', 'author': 'a', 'role': 'report', 'kinds': ['asbab'], 'protectedIn': [], 'edition': pinned},
        {'id': 'wahidi-asbab', 'title': 't', 'author': 'a', 'role': 'pointer', 'kinds': ['asbab'], 'protectedIn': [], 'edition': pinned},
        {'id': 'muzaini-muharrar', 'title': 't', 'author': 'a', 'role': 'verdict', 'kinds': ['asbab'], 'protectedIn': [], 'edition': pinned},
        {'id': 'wadii-sahih-musnad', 'title': 't', 'author': 'a', 'role': 'verdict', 'kinds': ['asbab'], 'protectedIn': [], 'edition': pinned},
    ]}
    reg_errors, works = check_sources(reg)
    assert not reg_errors, reg_errors

    def base():
        return {
            'schema': 2, 'surah': 999, 'datasetId': 'test-1', 'lessonKey': 'quran-999', 'retiredIds': ['lesson-009'],
            'segments': [{'id': 'seg-001', 'from': 1, 'to': 3, 'theme': 'theme-001'}, {'id': 'seg-002', 'from': 4, 'to': 5}],
            'items': [
                {'id': 'intro-001', 'kind': 'intro', 'bands': ['3-5'], 'text': 'مقدمة', 'source': {'work': 'saadi', 'ref': '999'}},
                {'id': 'theme-001', 'kind': 'theme', 'bands': ['9-12'], 'text': 'موضوع', 'source': {'work': 'saadi', 'ref': '999:1-3'}},
                {'id': 'tafsir-001', 'kind': 'tafsir', 'bands': ['6-8', '9-12'], 'text': 'شرح {{w:1:2}} هنا', 'ayah': 1,
                 'source': {'work': 'saadi', 'ref': '999:1'}, 'crossCheck': {'work': 'baghawi', 'ref': '999:1'}, 'ladder': ['معنى', 'شرح']},
                {'id': 'word-001', 'kind': 'word', 'bands': ['6-8'], 'text': 'معنى', 'ayah': 3, 'word': 2, 'to': 3, 'source': {'work': 'saadi', 'ref': '999:3'}},
                {'id': 'lesson-001', 'kind': 'lesson', 'bands': ['3-5'], 'text': 'درس', 'behaviour': 'good', 'ayat': [1, 2], 'source': {'work': 'saadi', 'ref': '999'}},
                {'id': 'reflection-001', 'kind': 'reflection', 'bands': ['9-12'], 'text': 'سؤال', 'ideas': ['فكرة'], 'source': {'work': 'saadi', 'ref': '999'}},
                {'id': 'story-001', 'kind': 'story', 'bands': ['6-8'], 'text': 'حكاية', 'order': 1, 'source': {'work': 'bukhari', 'ref': '1'}},
                {'id': 'asbab-001', 'kind': 'asbab', 'bands': ['9-12'], 'text': 'سبب', 'ayat': [1, 2], 'source': {'work': 'bukhari', 'ref': '4971'},
                 'pointer': {'work': 'wahidi-asbab', 'ref': 'p. 1'},
                 'verdicts': [{'work': 'muzaini-muharrar', 'ref': '2/1', 'reason': 'is', 'chain': 'sahih'}]},
                {'id': 'quiz-001', 'kind': 'quiz', 'bands': ['6-8'], 'text': 'ما معنى', 'category': 'meanings', 'word': {'ayah': 3, 'word': 2, 'to': 3},
                 'options': [{'text': 'معنى'}, {'text': 'غيره'}], 'answer': 0, 'basis': ['word-001']},
                {'id': 'quiz-002', 'kind': 'quiz', 'bands': ['9-12'], 'text': 'أكمل', 'category': 'hifz', 'prompt': {'ayah': 2, 'words': 2},
                 'options': [{'ayah': 2, 'word': 3, 'to': 3}, {'ayah': 1}], 'answer': 0, 'basis': []},
            ],
        }

    def set_(path, value):
        def m(c):
            *head, last = path
            for k in head:
                c = c[k]
            c[last] = value
        return m

    def item(i, key, value):
        return set_(['items', i, key], value)

    cases = {
        'clean': (lambda c: None, None),
        'bad-id': (item(2, 'id', 'tafsir-1'), 'must be <kind>-NNN'),
        'id-kind-mismatch': (item(2, 'id', 'word-009'), 'must be <kind>-NNN'),
        'repeated-id': (lambda c: c['items'].append(dict(c['items'][3])), 'repeated'),
        'retired-id': (item(4, 'id', 'lesson-009'), 'repeated or retired'),
        'not-nfc': (item(0, 'text', 'ا' + chr(0x654)), 'NFC'),
        'control-char': (item(0, 'text', 'مقدمة\n'), 'control'),
        'ayah-out-of-range': (item(2, 'ayah', 6), 'not an ayah'),
        'span-out-of-range': (item(3, 'to', 6), 'not words of ayah'),
        'span-reversed': (item(3, 'word', 4), 'not words of ayah'),
        'token-out-of-range': (item(2, 'text', 'شرح {{w:4:3}}'), 'not words of ayah'),
        'second-tafsir': (lambda c: c['items'].append({**c['items'][2], 'id': 'tafsir-002'}), 'second tafsir'),
        'segments-gap': (set_(['segments', 1, 'from'], 5), 'cover'),
        'segments-short': (set_(['segments', 1, 'to'], 4), 'every ayah'),
        'theme-not-theme': (set_(['segments', 0, 'theme'], 'intro-001'), 'not a theme item'),
        'unknown-work': (item(0, 'source', {'work': 'muyassar', 'ref': '1'}), 'unknown work'),
        'verdict-as-source': (item(0, 'source', {'work': 'muzaini-muharrar', 'ref': '1'}), 'verdict work'),
        'pointer-as-report': (item(7, 'source', {'work': 'wahidi-asbab', 'ref': '1'}), 'pointer work'),
        'cross-check-as-primary': (item(0, 'source', {'work': 'baghawi', 'ref': '1'}), 'cross-check work'),
        'verdict-with-text': (set_(['items', 7, 'verdicts', 0, 'quote'], 'نص'), 'unknown'),
        'asbab-not-the-reason': (set_(['items', 7, 'verdicts', 0, 'reason'], 'is-not'), 'display rule'),
        'asbab-weak': (lambda c: c['items'][7]['verdicts'].append({'work': 'wadii-sahih-musnad', 'ref': '1', 'chain': 'mursal'}), 'display rule'),
        'asbab-no-muharrar': (set_(['items', 7, 'verdicts'], [{'work': 'wadii-sahih-musnad', 'ref': '1', 'chain': 'sahih'}]), 'display rule'),
        'asbab-unsound-outside-sahihayn': (lambda c: (c['items'][7].update(source={'work': 'tirmidhi', 'ref': '1'}),
                                                       c['items'][7]['verdicts'][0].pop('chain')), 'display rule'),
        'asbab-sound-by-judge': (item(7, 'source', {'work': 'tirmidhi', 'ref': '1'}), None),
        'asbab-young-band': (item(7, 'bands', ['6-8', '9-12']), '9-12 band only'),
        'bad-band': (item(0, 'bands', ['2-3']), 'bands'),
        'extra-field': (item(0, 'quote', 'x'), 'unknown'),
        'typed-quran': (item(2, 'text', 'كما قال دال ذال راء زاي'), 'consecutive words'),
        'typed-quran-in-idea': (set_(['items', 5, 'ideas'], ['جيم حاء خاء']), 'whole ayah'),
        'token-is-not-typed': (item(2, 'text', 'شرح {{w:3:1-4}} هنا'), None),
        'uthmani-marks': (item(0, 'text', 'نص ' + chr(0x671) + 'لله'), 'Uthmani-only'),
        'quiz-no-basis': (item(8, 'basis', []), 'names the items'),
        'quiz-basis-missing': (item(8, 'basis', ['word-777']), 'not an item'),
        'quiz-answer': (item(8, 'answer', 2), 'answer must index'),
        'quiz-duplicate-options': (item(8, 'options', [{'text': 'أ'}, {'text': 'أ'}]), 'distinct'),
        'quiz-prompt-whole': (set_(['items', 9, 'prompt', 'words'], 3), 'first 1..(count-1)'),
        'wrong-dataset': (set_(['datasetId'], 'other'), 'not the pinned'),
        'wrong-lesson-key': (set_(['lessonKey'], 'quran-001'), 'lessonKey'),
        'float': (item(2, 'ayah', 1.0), 'not an ayah'),
    }
    failed = []
    for name, (mutate, expected) in cases.items():
        c = base()
        mutate(c)
        errors = check(c, verses, 'test-1', works)
        ok = (not errors) if expected is None else any(expected in e for e in errors)
        if not ok:
            failed.append(f'{name}: expected {expected or "no errors"}, got {errors}')

    # Approvals.
    c = base()
    items = {it['id']: it for it in c['items']}

    def appr(*entries):
        return {'surah': 999, 'lessonKey': 'quran-999', 'approvals': list(entries)}

    def a(iid, steps=('check', 'teacher', 'scholar'), sha=None):
        return {'id': iid, 'itemSha256': sha or item_sha256(items[iid]), 'steps': list(steps)}

    appr_cases = {
        'asbab-pinned-full': (appr(a('asbab-001')), None),
        'hifz-quiz-two-steps': (appr(a('quiz-002', ('check', 'teacher'))), None),
        'unpinned-edition': (appr(a('tafsir-001')), 'no pinned edition'),
        'stale': (appr(a('asbab-001', sha='0' * 64)), 'stale'),
        'missing-scholar': (appr(a('asbab-001', ('check', 'teacher'))), 'missing review step'),
        'no-such-item': (appr({'id': 'tafsir-404', 'itemSha256': '0' * 64, 'steps': ['check']}), 'no such item'),
        'twice': (appr(a('asbab-001'), a('asbab-001')), 'once per item'),
        'bad-step': (appr(a('quiz-002', ('check', 'teacher', 'owner'))), 'steps must be'),
        'wrong-surah': ({'surah': 998, 'lessonKey': 'quran-999', 'approvals': []}, 'must match'),
    }
    for name, (ap, expected) in appr_cases.items():
        errors = check_approvals(ap, c, works)
        ok = (not errors) if expected is None else any(expected in e for e in errors)
        if not ok:
            failed.append(f'approvals {name}: expected {expected or "no errors"}, got {errors}')

    # The registry.
    bad = {'works': [dict(reg['works'][0], edition={'printer': 'p'})]}
    if not any('edition must be' in e for e in check_sources(bad)[0]):
        failed.append('sources: a partial edition pin was accepted')
    dup = {'works': [reg['works'][0], reg['works'][0]]}
    if not any('repeated' in e for e in check_sources(dup)[0]):
        failed.append('sources: a repeated work was accepted')

    # The shared hash vectors (quran-content.test.ts checks the same file).
    failed += check_vectors(json.load(open(VECTORS, encoding='utf-8')))

    for f in failed:
        print(f'quran-content selftest: FAIL {f}')
    if not failed:
        print(f'quran-content selftest: {len(cases)} content cases and {len(appr_cases)} approval cases, each caught; '
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
    for f in files:
        number = int(f[6:9])
        content = json.load(open(os.path.join(QURAN, f), encoding='utf-8'))
        errors = []
        if os.path.exists(os.path.join(CONTENT, f)):
            errors.append('this surah also has a schema-1 file (content/' + f + '); a surah has one or the other')
        errors += check(content, surahs[number], dataset_id, works) if content.get('surah') == number else [f'surah is {content.get("surah")!r}, not {number}']
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
