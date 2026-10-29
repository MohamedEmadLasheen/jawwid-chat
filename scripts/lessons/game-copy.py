#!/usr/bin/env python3
"""PD-49: the games' Arabic copy, for the Teachers department's review.

    python3 -I scripts/lessons/game-copy.py write      # (re)generate docs/product/pd049-game-copy-review.md
    python3 -I scripts/lessons/game-copy.py check      # fail if the doc misses or misstates any string
    python3 -I scripts/lessons/game-copy.py selftest

The doc is complete by construction: every maximal run of Arabic in the game sources (code, JSX
text, string and template literals -- comments removed) is a row, so text around a {expr} or a
${expr} is listed too; and every game's name from the registry. `check` regenerates it and fails
on any difference, so no string reaches a child without being on the list the teacher signs against.
Standard library only; reads files, runs nothing.
"""
import glob
import json
import os
import re
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'apps', 'lessons', 'src')
DOC = os.path.join(ROOT, 'docs', 'product', 'pd049-game-copy-review.md')
# What a game shows: its files and the shared play code, and the font gate every lesson passes.
SOURCES = ('play/**/*.tsx', 'quran/font.tsx')

ARABIC = chr(0x600) + '-' + chr(0x6FF)
LETTER = re.compile('[' + chr(0x621) + '-' + chr(0x64A) + chr(0x671) + ']')
# A run starts with an Arabic character and goes on through Arabic, spaces and the punctuation copy uses.
RUN = re.compile('[' + ARABIC + '][' + ARABIC + ' !.:' + chr(0x2026) + chr(0x2013) + chr(0xAB) + chr(0xBB) + chr(0x2713) + ']*')
BLOCK = re.compile(r'/\*.*?\*/', re.S)
# An interpolation, {expr} or ${expr}, one level of nested braces deep.
EXPR = re.compile(r'\$?\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}')


def strip_comments(text):
    """Block comments (and JSX {/* */}) become blank lines, so line numbers stay; a // comment is cut where it starts outside a string."""
    text = BLOCK.sub(lambda m: '\n' * m.group(0).count('\n'), text)
    out = []
    for line in text.split('\n'):
        quote = None
        for i, c in enumerate(line):
            if quote:
                if c == quote and line[i - 1] != '\\':
                    quote = None
            elif c in '\'"`':
                quote = c
            elif line.startswith('//', i):
                line = line[:i]
                break
        out.append(line)
    return '\n'.join(out)


def hidden_spans(line):
    """Where on a line the text is for a screen reader only: inside an sr-only span, an aria-label or a label= prop."""
    spans = [(m.end(), line.find('</span>', m.end()) % (len(line) + 1)) for m in re.finditer(r'className="sr-only">', line)]
    spans += [(m.start(), m.end()) for m in re.finditer(r'(?:aria-label|label)=(?:"[^"]*"|\{[^}]*\})', line)]
    return spans


def reader(rel, line, at=None):
    if at is not None and any(a <= at < b for a, b in hidden_spans(line)):
        return 'screen reader'
    if at is None and ('sr-only' in line or 'aria-label' in line or 'label=' in line):
        return 'screen reader'
    if rel.endswith('PlayLesson.tsx') and any(k in line for k in ('تعذّر', 'جارٍ', 'قيد المراجعة', 'لا توجد')):
        return 'everyone (page state)'
    if rel.endswith('font.tsx'):
        return 'everyone (font loading)'
    if rel.endswith('PlayLesson.tsx'):
        return 'grown-up'
    return 'child'


def strings(src=SRC):
    """[(file, line, reader, text)] for every Arabic run in the sources, in file and line order."""
    rows = []
    files = sorted({f for pattern in SOURCES for f in glob.glob(os.path.join(src, pattern), recursive=True)})
    for path in files:
        rel = os.path.relpath(path, src).replace(os.sep, '/')
        if '.test.' in rel:
            continue
        for n, line in enumerate(strip_comments(open(path, encoding='utf-8').read()).split('\n'), 1):
            # Runs joined only by an interpolation (no quote between them) are ONE string: shown as a
            # template, the {expr} as "…" -- so every run is in a row, and a row reads as the child sees it.
            merged = []
            for m in RUN.finditer(line):
                if merged and not re.search('[\'"`<>]', line[merged[-1][1]:m.start()]) and '{' in line[merged[-1][1]:m.start()]:
                    between = EXPR.sub('…', line[merged[-1][1]:m.start()])
                    merged[-1] = [merged[-1][0] + between + m.group(0), m.end(), merged[-1][2]]
                else:
                    merged.append([m.group(0), m.end(), m.start()])
            for text, _, at in merged:
                text = text.strip()
                if LETTER.search(text):
                    rows.append((rel, n, reader(rel, line, at), text))
    return rows


def names(src=SRC):
    reg = json.load(open(os.path.join(src, 'play', 'mechanics.json'), encoding='utf-8'))
    return [(m['id'], m['nameAr']) for m in reg['mechanics']]


def render(src=SRC):
    cell = lambda t: t.replace('|', '\\|')
    doc = [
        "# PD-49 games: the Arabic copy, for the Teachers department's review",
        '',
        'GENERATED by `scripts/lessons/game-copy.py write` from `apps/lessons/src` (the game sources and the font gate); `check` fails CI when this file and the code differ. The verses are not here: they are the verified text, never edited.',
        '',
        "**How a string is held until approved.** Every string here is in a game's file or in the shared play code, and the signed code covers both (`check-quran-content.py` `SHARED_CODE`). A game reaches a child only after a teacher **and** the scholar sign its mechanic. So the teacher's signature **is** the approval of its copy, and an edited string unsigns every game that shows it.",
        '',
        '## Rules the copy follows',
        "- **Plain Modern Standard Arabic, in short sentences.** The child's instructions use the first person plural (لنستمع… / نردّد… / لنختر…). That is natural in a game played with a grown-up, and gender-neutral.",
        '- **One action, one verb:**',
        '  - لمس is only for touching in 3–5, always with البطاقة as its object;',
        '  - اختار is for picking an answer;',
        '  - استمع is for the recitation.',
        '- **Respect.**',
        '  - The card lights up, never the ayah.',
        '  - «الكبير» is never used for a grown-up on a Quran screen (it is a Divine Name): «أحد الكبار» / «الكبار».',
        '  - An ayah is never named after a shape («الآية التي في الدائرة», never «آية الدائرة»).',
        "- **The grown-up's controls are nouns:** إعادة، تخطّي، إيقاف، متابعة، تكبير الخط.",
        '- **Numbers are Arabic-Indic digits.** Counts agree with their noun: آية واحدة، آيتين؛ آيات when the count mod 100 is 3–10; آية otherwise.',
        '- **Praise is unvowelled** (أحسنت), so it reads for a boy or a girl.',
        "- **3–5 is being rebuilt as a pre-reader mode** (spoken clips, no text for the child). Its strings below are interim.",
        '',
        '## Status',
        "**Awaiting the Teachers department's review.** Mark each line ✓ or give a correction.",
        '',
        '## The games\' names (first person plural; for the Teachers department to confirm)',
        '',
        '| Mechanic | Name | Review |',
        '|---|---|---|',
    ]
    doc += [f'| `{mid}` | {cell(name)} | |' for mid, name in names(src)]
    doc += ['', '## Every string', '', '| # | File : line | Who reads it | Text | Review |', '|---|---|---|---|---|']
    doc += [f'| {i} | `{f}:{n}` | {who} | {cell(t)} | |' for i, (f, n, who, t) in enumerate(strings(src), 1)]
    return '\n'.join(doc) + '\n'


def selftest():
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, 'play', 'games'))
        json.dump({'mechanics': [{'id': 'x', 'nameAr': 'نجرّب'}]}, open(os.path.join(d, 'play', 'mechanics.json'), 'w', encoding='utf-8'))
        open(os.path.join(d, 'play', 'games', 'G.tsx'), 'w', encoding='utf-8').write(
            "// تعليق لا يُعرض\n"
            "/* ولا هذا */\n"
            "const a = `لنكمل الآية ${n} من السورة`;\n"
            "<p>لنرتّب كلمات الآية {arabic(n)}</p>\n"
            "{/* ولا تعليق JSX */}\n"
            "<span className=\"sr-only\">بداية آية: </span>\n"
            "🔊 لنستمع<span className=\"sr-only\"> إلى الآية</span>\n")
        got = [(n, who, t) for _, n, who, t in strings(d)]
        want = [(3, 'child', 'لنكمل الآية … من السورة'), (4, 'child', 'لنرتّب كلمات الآية'), (6, 'screen reader', 'بداية آية:'), (7, 'child', 'لنستمع'), (7, 'screen reader', 'إلى الآية')]
        doc = render(d)
        ok = got == want and '| `x` | نجرّب | |' in doc and 'تعليق' not in doc
    print(f"game-copy selftest: {'the runs around {expr} and ${expr} are found, comments are not, the names are listed' if ok else 'FAIL ' + repr(got)}")
    return 0 if ok else 1


def main(argv):
    mode = argv[0] if argv else 'check'
    if mode == 'selftest':
        return selftest()
    text = render()
    if mode == 'write':
        open(DOC, 'w', encoding='utf-8').write(text)
        print(f'game-copy: wrote {os.path.relpath(DOC, ROOT)} ({len(strings())} strings, {len(names())} names)')
        return 0
    have = open(DOC, encoding='utf-8').read() if os.path.exists(DOC) else ''
    if have != text:
        missing = [line for line in text.split('\n') if line.startswith('| ') and line not in have.split('\n')]
        for line in missing[:20]:
            print(f'game-copy: the review doc lacks: {line}')
        print('game-copy: docs/product/pd049-game-copy-review.md is not the code\'s copy; run scripts/lessons/game-copy.py write')
        return 1
    print(f'game-copy: the review doc lists every one of the {len(strings())} strings and {len(names())} names in the game sources')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
