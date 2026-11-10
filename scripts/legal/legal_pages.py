#!/usr/bin/env python3
"""The public legal pages (LR-04, Option A): render, check, and list what to publish.

    python3 -I scripts/legal/legal_pages.py build   # render docs/legal/*-{ar,en}.md into apps/admin-web/legal-web/
    python3 -I scripts/legal/legal_pages.py check   # the CI guard (guards.sh web-env)

docs/release/legal-pages-hosting.md §3.2 and docs/legal/public-hosting-requirements.md R-1..R-13.

THE SWITCH. docs/legal/publication.json `"publish"`:
  false  (today) `build` is SKIPPED with a message and writes nothing. apps/admin-web/legal-web/ holds
         only .gitkeep, the Admin Web image deletes it and the empty directory, and nginx answers 404 at
         /legal/ and below (never the Admin Web app, never a placeholder page). `check` FAILS if any
         page is in legal-web/ while the switch is off.
  true   `build` renders every listed document in Arabic and English, but only if EVERY page passes:
         front matter `status: "Published"`, a real version and effective date, and no `{{`, TO CONFIRM, legal review, مراجعة قانونية, Drafting note, DRAFT or internal ID (LD-7, PD-48,
         ...) in the source or on the rendered page (R-11); the version and date are on the page (R-5);
         the PD-48 paragraph is byte-identical where it belongs (R-13). One failure refuses the whole
         build and nothing is written. `check` re-renders and fails on any difference from the
         committed pages (R-7), and on a marker in any file under legal-web/.
         VERSIONED PAGES ARE IMMUTABLE. <lang>/<slug>/<version>/index.html is what the terms gate
         recorded (chat.publish_legal_version p_content_sha256_*). `build` records its SHA-256 in
         docs/legal/published-versions.json (commit it with the pages) and REFUSES to rewrite a
         versioned page that is recorded or already committed: a changed source, label or link target
         needs a new version. `check` fails on any versioned page that is unrecorded, differs from its
         recorded hash, or is missing (R-12).
Either way `check` also asserts the nginx template and the Dockerfile still serve /legal/ fail-closed.

Deterministic: no clock, no environment, sorted output; the same sources give the same bytes, so the
SHA-256 printed by scripts/legal/publication-manifest.py is the hash of the bytes nginx serves.

Standard library only (no new dependency): the sources use a small Markdown subset (headings,
paragraphs, `-`/`1.` lists, pipe tables, blockquotes, **bold**, *italic*, `code`, links, bare https
URLs and e-mail addresses). Anything outside it that could change meaning (code fences, nested lists,
tight or separated by a blank line) is refused rather than guessed. All text is HTML-escaped; the
pages carry no script, no inline style, no third-party resource (R-9) and work under
`default-src 'none'; style-src 'self'`.
"""
import datetime
import hashlib
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_PATH = 'docs/legal/publication.json'
NGINX_TEMPLATE = 'apps/admin-web/infra-nginx/default.conf.template'
DOCKERFILE = 'apps/admin-web/Dockerfile'
# The SHA-256 of every versioned page ever built (<lang>/<slug>/<version>/index.html). Written by
# `build`, committed with the pages, never edited by hand. A versioned page is the text the terms
# gate recorded (chat.publish_legal_version p_content_sha256_*), so once it exists it never changes.
LEDGER_PATH = 'docs/legal/published-versions.json'
LEDGER_KEY = re.compile(r'(ar|en)/[a-z0-9-]+(/[a-z0-9-]+)*/v?[0-9][0-9A-Za-z.-]{0,62}/index\.html')
LANGS = ('ar', 'en')
DIRECTION = {'ar': 'rtl', 'en': 'ltr'}
OTHER = {'ar': 'en', 'en': 'ar'}

# The owner's version name becomes a URL path segment (…/terms/1.0) and chat.legal_document_version
# .version (1..64 characters, trimmed, no control characters). Starting with a digit (or v+digit)
# keeps it apart from the sub-documents' slugs (terms/teachers, terms/staff).
VERSION_RE = re.compile(r'v?[0-9][0-9A-Za-z.-]{0,62}')
DATE_RE = re.compile(r'[0-9]{4}-[0-9]{2}-[0-9]{2}')
SLUG_RE = re.compile(r'[a-z0-9-]+(/[a-z0-9-]+)*')

# R-11 (public-hosting-requirements.md §3 and §5). Checked on the source AND on the rendered page.
MARKERS = [
    (re.compile(r'\{\{'), 'a {{PLACEHOLDER}}'),
    (re.compile(r'TO CONFIRM', re.I), 'a [TO CONFIRM] marker'),
    (re.compile(r'legal review', re.I), 'a [legal review] marker'),
    (re.compile(r'مراجعة قانونية'), 'a [مراجعة قانونية] marker'),
    (re.compile(r'drafting note', re.I), 'a drafting note'),
    (re.compile(r'\bDRAFT\b'), 'DRAFT'),
]
# §5: "no internal ID (regex \b(LD|L|DEV-CONFIRM|PD|H|P|MG|AP|GP)-?\s?#?\d)". Checked on the page's
# visible text, so a version or a URL inside an attribute cannot trip it.
INTERNAL_ID = re.compile(r'\b(LD|L|DEV-CONFIRM|PD|H|P|MG|AP|GP)-?\s?#?\d')

CSS = """\
:root{color-scheme:light dark;--bg:#f8f8f8;--fg:#1a2226;--muted:#5f6e74;--accent:#1b7f93;--border:#cbd2d4}
@media (prefers-color-scheme:dark){:root{--bg:#0f1416;--fg:#e9edef;--muted:#879398;--accent:#229bb2;--border:#34444a}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:1rem/1.7 system-ui,-apple-system,"Segoe UI","Noto Sans Arabic","Noto Naskh Arabic","Geeza Pro",Tahoma,Arial,sans-serif;overflow-wrap:anywhere}
header.site,main{max-width:46rem;margin:0 auto;padding:1rem}
header.site nav{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:.75rem}
a{color:var(--accent)}
a:focus-visible,.table-wrap:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
h1{font-size:1.6rem;line-height:1.3}
h2{font-size:1.3rem;line-height:1.4;margin-top:2rem}
h3,h4,h5,h6{font-size:1.1rem;line-height:1.4}
blockquote{margin:1rem 0;padding:.25rem 1rem;border-inline-start:4px solid var(--accent)}
ul,ol{padding-inline-start:1.5rem}
hr{border:0;border-top:1px solid var(--border);margin:2rem 0}
.table-wrap{overflow-x:auto;margin:1rem 0}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--border);padding:.5rem;text-align:start;vertical-align:top}
code{font-family:ui-monospace,Menlo,Consolas,monospace}
"""


class Refused(Exception):
    """A page that must not be published. The whole build stops; nothing is written."""


# ------------------------------------------------------------------------- config and sources

def load_config(root):
    with open(os.path.join(root, CONFIG_PATH), encoding='utf-8') as f:
        cfg = json.load(f)
    if not isinstance(cfg.get('publish'), bool):
        raise Refused(f'{CONFIG_PATH}: "publish" must be true or false')
    return cfg


def parse_front_matter(text, path):
    if not text.startswith('---\n'):
        raise Refused(f'{path}: no front matter')
    end = text.find('\n---\n', 4)
    if end < 0:
        raise Refused(f'{path}: the front matter is not closed')
    fm = {}
    for line in text[4:end].split('\n'):
        if not line.strip():
            continue
        m = re.fullmatch(r'([a-z_]+):\s*(.*?)\s*', line)
        if not m:
            raise Refused(f'{path}: front matter line not understood: {line!r}')
        value = m.group(2)
        if len(value) >= 2 and value[0] == value[-1] == '"':
            value = value[1:-1].replace('\\"', '"')
        fm[m.group(1)] = value
    return fm, text[end + len('\n---\n'):]


def find_markers(text):
    return [label for rx, label in MARKERS if rx.search(text)]


def pd048_paragraphs(root, cfg):
    """The approved PD-48 paragraph per language: the blockquote under '## English' / '## Arabic'."""
    path = os.path.join(root, cfg['pd048_source'])
    with open(path, encoding='utf-8') as f:
        lines = f.read().split('\n')
    out = {}
    for lang, heading in (('en', '## English'), ('ar', '## Arabic')):
        try:
            i = lines.index(heading) + 1
        except ValueError:
            raise Refused(f'{cfg["pd048_source"]}: no "{heading}" section')
        while i < len(lines) and not lines[i].startswith('>'):
            i += 1
        block = []
        while i < len(lines) and lines[i].startswith('>'):
            block.append(lines[i])
            i += 1
        if not block:
            raise Refused(f'{cfg["pd048_source"]}: no paragraph under "{heading}"')
        out[lang] = '\n'.join(block)
    return out


def load_documents(root, cfg):
    """Every listed document, both languages, validated for publication. Raises Refused."""
    src_dir = cfg['source_dir']
    docs, slugs, problems = [], set(), []
    pd048 = None
    for entry in cfg['documents']:
        slug = entry['slug']
        if not SLUG_RE.fullmatch(slug) or slug in slugs:
            raise Refused(f'{CONFIG_PATH}: bad or duplicate slug {slug!r}')
        slugs.add(slug)
        doc = {'entry': entry, 'slug': slug, 'lang': {}}
        for lang in LANGS:
            name = f'{entry["source"]}-{lang}.md'
            rel = f'{src_dir}/{name}'
            with open(os.path.join(root, rel), encoding='utf-8') as f:
                text = f.read()
            if '\x00' in text or '\r' in text:
                raise Refused(f'{rel}: NUL or carriage return in the source')
            fm, body = parse_front_matter(text, rel)
            found = find_markers(text)
            if found:
                problems.append(f'{rel}: still contains ' + ', '.join(found))
            if fm.get('status') != 'Published':
                problems.append(f'{rel}: front matter status is {fm.get("status")!r}, not "Published"')
            if fm.get('language') != lang:
                problems.append(f'{rel}: front matter language is {fm.get("language")!r}')
            if fm.get('counterpart') != f'{entry["source"]}-{OTHER[lang]}.md':
                problems.append(f'{rel}: front matter counterpart is {fm.get("counterpart")!r}')
            if not fm.get('title'):
                problems.append(f'{rel}: no title')
            if not VERSION_RE.fullmatch(fm.get('version', '')):
                problems.append(f'{rel}: version {fm.get("version")!r} is not a publishable version name')
            date = fm.get('effective_date', '')
            try:
                if not DATE_RE.fullmatch(date):
                    raise ValueError
                datetime.date.fromisoformat(date)
            except ValueError:
                problems.append(f'{rel}: effective_date {date!r} is not a YYYY-MM-DD date')
            if entry.get('gate_key') and fm.get('document_key') != entry['gate_key']:
                problems.append(f'{rel}: document_key {fm.get("document_key")!r} is not the gate key '
                                f'{entry["gate_key"]!r} (chat.legal_document_version)')
            if entry.get('pd048'):
                if pd048 is None:
                    pd048 = pd048_paragraphs(root, cfg)
                if pd048[lang] not in body:
                    problems.append(f'{rel}: the PD-48 paragraph is missing or changed (R-13)')
            doc['lang'][lang] = {'name': name, 'rel': rel, 'fm': fm, 'body': body}
        a, e = doc['lang']['ar']['fm'], doc['lang']['en']['fm']
        for key in ('version', 'effective_date', 'document_key'):
            if a.get(key) != e.get(key):
                problems.append(f'{entry["source"]}: Arabic and English differ in {key}')
        docs.append(doc)
    if problems:
        raise Refused('\n'.join(problems))
    return docs


# ------------------------------------------------------------------------- Markdown subset

def esc(s):
    return html.escape(s, quote=True)


EMAIL = r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'
INLINE_TOKEN = re.compile(
    r'`([^`\n]+)`'                         # 1 code
    r'|\[([^\]\n]+)\]\(([^)\s]+)\)'        # 2 label, 3 href
    r'|(https://[^\s<>()\[\]"\'`]+)'       # 4 bare URL
    r'|(?<![\w.%+-])(' + EMAIL + r')')     # 5 bare e-mail
TRAILING_PUNCT = '.,;:!?،؛'


def emphasis(s):
    s = re.sub(r'\*\*(?=\S)(.+?)(?<=\S)\*\*', r'<strong>\1</strong>', s, flags=re.S)
    return re.sub(r'(?<![*\w])\*(?=\S)(.+?)(?<=\S)\*(?![*\w])', r'<em>\1</em>', s, flags=re.S)


def resolve_link(href, ctx):
    if re.fullmatch(r'#[A-Za-z0-9_-]+', href):
        return href
    m = re.fullmatch(r'([A-Za-z0-9_.-]+\.md)(#[A-Za-z0-9_-]+)?', href)
    if m:
        if m.group(1) not in ctx['links']:
            raise Refused(f'{ctx["rel"]}: links to {href}, which is not a published document')
        return ctx['links'][m.group(1)] + (m.group(2) or '')
    if re.fullmatch(r'https://[^\s<>"\'`]+', href) or re.fullmatch(r'mailto:' + EMAIL, href):
        return href
    raise Refused(f'{ctx["rel"]}: link {href!r} is neither a published document, https nor mailto')


def anchor(href, label_html):
    rel = ' rel="noopener noreferrer"' if href.startswith('https://') else ''
    return f'<a href="{esc(href)}"{rel}>{label_html}</a>'


def inline(text, ctx):
    slots = []

    def stash(s):
        slots.append(s)
        return f'\x00{len(slots) - 1}\x00'

    def token(m):
        if m.group(1) is not None:
            return stash(f'<code>{esc(m.group(1))}</code>')
        if m.group(2) is not None:
            return stash(anchor(resolve_link(m.group(3), ctx), emphasis(esc(m.group(2)))))
        if m.group(4) is not None:
            url, trail = m.group(4), ''
            while url and url[-1] in TRAILING_PUNCT:
                url, trail = url[:-1], url[-1] + trail
            return stash(anchor(url, esc(url))) + trail
        return stash(anchor('mailto:' + m.group(5), esc(m.group(5))))

    s = emphasis(esc(INLINE_TOKEN.sub(token, text)))
    return re.sub('\x00([0-9]+)\x00', lambda m: slots[int(m.group(1))], s)


HEADING = re.compile(r'(#{1,6})\s+(.*?)\s*#*\s*')
RULE = re.compile(r'(-{3,}|\*{3,}|_{3,})\s*')
UL = re.compile(r'[-*+]\s+(.*)')
OL = re.compile(r'([0-9]{1,9})[.)]\s+(.*)')
TABLE_SEP = re.compile(r'\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*')


def is_table(lines, i):
    return lines[i].startswith('|') and i + 1 < len(lines) and TABLE_SEP.fullmatch(lines[i + 1]) is not None


def nested_item(line):
    """An indented list item: a nested list (refused), never a continuation of the line above."""
    return line[:1] in (' ', '\t') and (UL.fullmatch(line.strip()) or OL.fullmatch(line.strip())) is not None


def starts_block(lines, i):
    line = lines[i]
    return (not line.strip() or nested_item(line) or HEADING.fullmatch(line) is not None
            or RULE.fullmatch(line) is not None
            or line.startswith('>') or UL.fullmatch(line) is not None or OL.fullmatch(line) is not None
            or is_table(lines, i) or line.startswith('```') or line.startswith('~~~'))


def table_cells(line):
    s = line.strip()
    if s.startswith('|'):
        s = s[1:]
    if s.endswith('|'):
        s = s[:-1]
    if '\\|' in s:
        raise Refused('an escaped | in a table cell is not supported')
    return [c.strip() for c in s.split('|')]


def blocks(lines, ctx):
    out, i, n = [], 0, len(lines)
    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith('```') or line.startswith('~~~'):
            raise Refused(f'{ctx["rel"]}: code fences are not supported on a published page')
        if nested_item(line):
            raise Refused(f'{ctx["rel"]}: nested lists are not supported on a published page')
        m = HEADING.fullmatch(line)
        if m:
            level = len(m.group(1))
            out.append(f'<h{level}>{inline(m.group(2), ctx)}</h{level}>')
            i += 1
            continue
        if RULE.fullmatch(line):
            out.append('<hr>')
            i += 1
            continue
        if line.startswith('>'):
            inner = []
            while i < n and lines[i].startswith('>'):
                inner.append(re.sub(r'^> ?', '', lines[i]))
                i += 1
            out.append('<blockquote>\n' + '\n'.join(blocks(inner, ctx)) + '\n</blockquote>')
            continue
        if is_table(lines, i):
            head = table_cells(lines[i])
            i += 2
            rows = []
            while i < n and lines[i].startswith('|'):
                cells = table_cells(lines[i])
                if len(cells) > len(head):
                    raise Refused(f'{ctx["rel"]}: a table row has more cells than its header')
                rows.append(cells + [''] * (len(head) - len(cells)))
                i += 1
            parts = ['<div class="table-wrap" tabindex="0"><table>', '<thead><tr>'
                     + ''.join(f'<th scope="col">{inline(c, ctx)}</th>' for c in head) + '</tr></thead>', '<tbody>']
            parts += ['<tr>' + ''.join(f'<td>{inline(c, ctx)}</td>' for c in r) + '</tr>' for r in rows]
            parts.append('</tbody></table></div>')
            out.append('\n'.join(parts))
            continue
        list_rx = UL if UL.fullmatch(line) else OL if OL.fullmatch(line) else None
        if list_rx is not None:
            items, start = [], None
            while i < n:
                m = list_rx.fullmatch(lines[i])
                if not m:
                    break
                if list_rx is OL and start is None:
                    start = int(m.group(1))
                text = [m.group(m.lastindex)]
                i += 1
                while i < n and lines[i].strip() and not starts_block(lines, i):
                    text.append(lines[i].strip())
                    i += 1
                # Tight ("  - sub" right under the item) or after a blank line: both refused.
                j = i
                while j < n and not lines[j].strip():
                    j += 1
                if j < n and nested_item(lines[j]):
                    raise Refused(f'{ctx["rel"]}: nested lists are not supported on a published page')
                items.append(inline(' '.join(text), ctx))
                if j < n and list_rx.fullmatch(lines[j]):
                    i = j
            if list_rx is UL:
                tag = '<ul>'
            else:
                tag = '<ol>' if start == 1 else f'<ol start="{start}">'
            close = '</ul>' if list_rx is UL else '</ol>'
            out.append(tag + '\n' + '\n'.join(f'<li>{t}</li>' for t in items) + '\n' + close)
            continue
        para = [line.strip()]
        i += 1
        while i < n and not starts_block(lines, i):
            para.append(lines[i].strip())
            i += 1
        out.append('<p>' + inline('\n'.join(para), ctx) + '</p>')
    return out


def markdown(body, ctx):
    return '\n'.join(blocks(body.strip('\n').split('\n'), ctx))


# ------------------------------------------------------------------------- pages

def page(lang, title, nav_links, main_html, alternate=None):
    other = OTHER[lang]
    head_alt = (f'<link rel="alternate" hreflang="{other}" href="{esc(alternate)}">\n'
                if alternate else '')
    nav = ' '.join(nav_links)
    return (
        '<!DOCTYPE html>\n'
        f'<html lang="{lang}" dir="{DIRECTION[lang]}">\n'
        '<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f'<title>{esc(title)}</title>\n'
        '<link rel="stylesheet" href="/legal/legal.css">\n'
        f'{head_alt}'
        '</head>\n'
        '<body>\n'
        f'<header class="site"><nav>{nav}</nav></header>\n'
        f'<main>\n{main_html}\n</main>\n'
        '</body>\n'
        '</html>\n'
    ).encode('utf-8')


def lang_link(href, lang, label):
    return f'<a href="{esc(href)}" lang="{lang}" hreflang="{lang}">{esc(label)}</a>'


def visible_text(page_bytes):
    text = re.sub(r'<[^>]*>', ' ', page_bytes.decode('utf-8'))
    return html.unescape(text)


def page_problems(rel, data):
    """R-11 and the CSP on one output file. Empty list = publishable."""
    text = data.decode('utf-8')
    problems = [f'{rel}: contains {label}' for label in find_markers(text)]
    if rel.endswith('.html'):
        if INTERNAL_ID.search(visible_text(data)):
            problems.append(f'{rel}: shows an internal ID ({INTERNAL_ID.search(visible_text(data)).group(0)!r})')
        tags = re.findall(r'<[^>]*>', text.lower())
        if any(re.match(r'</?(script|style)\b', t) or re.search(r'\s(on[a-z]+|style)\s*=', t) for t in tags):
            problems.append(f'{rel}: script, event handler or inline style (the /legal/ CSP forbids them)')
        if any(re.match(r'<(iframe|img|form|object|embed)\b', t) for t in tags):
            problems.append(f'{rel}: iframe, image or form on a legal page')
    return problems


def url_path(lang, slug, version=None):
    return f'/legal/{lang}/{slug}' + (f'/{version}' if version else '')


def render_site(root, cfg):
    """Every output file (relative path -> bytes). Raises Refused; never writes."""
    docs = load_documents(root, cfg)
    labels = cfg['labels']
    links = {}
    for doc in docs:
        for lang in LANGS:
            links[doc['lang'][lang]['name']] = url_path(lang, doc['slug'])
    files = {'legal.css': CSS.encode('utf-8')}
    for doc in docs:
        versioned = bool(doc['entry'].get('gate_key'))
        for lang in LANGS:
            other = OTHER[lang]
            src = doc['lang'][lang]
            fm = src['fm']
            body = markdown(src['body'], {'links': links, 'rel': src['rel']})
            title = f'{fm["title"]} · {labels[lang]["site"]}'
            variants = [None] + ([fm['version']] if versioned else [])
            for version in variants:
                alt = url_path(other, doc['slug'], version)
                nav = [f'<a href="/legal/{lang}/">{esc(labels[lang]["all_documents"])}</a>',
                       lang_link(alt, other, labels[lang]['other_language'])]
                data = page(lang, title, nav, body, alt)
                text = visible_text(data)
                for key in ('version', 'effective_date'):
                    # As a whole token: version "1" inside "2026-12-01" does not count.
                    if not re.search(rf'(?<![\w.-]){re.escape(fm[key])}(?![\w-]|\.\w)', text):
                        raise Refused(f'{src["rel"]}: the page does not show its {key} {fm[key]!r} (R-5)')
                rel = url_path(lang, doc['slug'], version)[len('/legal/'):] + '/index.html'
                if rel in files:
                    raise Refused(f'two pages would be written to {rel}')
                files[rel] = data
    for lang in LANGS:
        other = OTHER[lang]
        items = '\n'.join(
            f'<li><a href="{url_path(lang, d["slug"])}">{esc(d["lang"][lang]["fm"]["title"])}</a></li>'
            for d in docs if d['entry'].get('nav'))
        nav = [lang_link(f'/legal/{other}/', other, labels[lang]['other_language'])]
        files[f'{lang}/index.html'] = page(
            lang, f'{labels[lang]["index_title"]} · {labels[lang]["site"]}', nav,
            f'<h1>{esc(labels[lang]["index_title"])}</h1>\n<ul>\n{items}\n</ul>', f'/legal/{other}/')
    root_links = '\n'.join(
        f'<li>{lang_link(f"/legal/{lang}/", lang, labels[lang]["index_title"])}</li>' for lang in LANGS)
    files['index.html'] = page('ar', f'{labels["ar"]["index_title"]} · {labels["ar"]["site"]}', [],
                               f'<h1>{esc(labels["ar"]["index_title"])}</h1>\n<ul>\n{root_links}\n</ul>')
    problems = []
    for rel in sorted(files):
        problems += page_problems(rel, files[rel])
        # nginx: `try_files $uri $uri/index.html =404` answers 403 for a directory without an index.
        parts = rel.split('/')[:-1]
        for k in range(len(parts) + 1):
            idx = '/'.join(parts[:k] + ['index.html'])
            if idx not in files:
                problems.append(f'{"/".join(parts[:k]) or "(root)"}/ has no index.html')
    if problems:
        raise Refused('\n'.join(sorted(set(problems))))
    return files


# ------------------------------------------------------------------------- commands

def output_files(root, cfg):
    """Files under legal-web/ on disk (relative path -> bytes), .gitkeep excluded."""
    base = os.path.join(root, cfg['output_dir'])
    out = {}
    for d, dirs, names in os.walk(base):
        dirs.sort()
        for name in sorted(names):
            path = os.path.join(d, name)
            rel = os.path.relpath(path, base).replace(os.sep, '/')
            if rel == '.gitkeep':
                continue
            with open(path, 'rb') as f:
                out[rel] = f.read()
    return out


def skipped_message(cfg):
    return (f'legal pages: SKIPPED. Publication is switched off ({CONFIG_PATH} "publish": false), so '
            f'nothing is rendered and Admin Web answers 404 at /legal/. Turn it on only after the '
            f'owner\'s confirmed values are applied and counsel has reviewed the text '
            f'(docs/legal/apply-confirmed-values.md).')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def load_ledger(root):
    """The published versioned pages (relative path -> SHA-256). Absent = nothing published yet."""
    try:
        with open(os.path.join(root, LEDGER_PATH), encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    pages = data.get('pages') if isinstance(data, dict) else None
    if not isinstance(pages, dict) or not all(
            isinstance(k, str) and LEDGER_KEY.fullmatch(k) and isinstance(v, str)
            and re.fullmatch(r'[0-9a-f]{64}', v) for k, v in pages.items()):
        raise Refused(f'{LEDGER_PATH}: not understood (expected {{"pages": {{"<lang>/<slug>/<version>/'
                      'index.html": "<sha256>"}})')
    return pages


def write_ledger(root, pages):
    data = {
        '_comment': 'Written by scripts/legal/legal_pages.py build; never edit by hand. The SHA-256 of '
                    'every versioned legal page ever published (LR-02d, R-12). Such a page never '
                    'changes and is never removed: a change to its text needs a new version.',
        'pages': dict(sorted(pages.items())),
    }
    with open(os.path.join(root, LEDGER_PATH), 'w', encoding='utf-8') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def immutability_problems(root, cfg, files, ledger):
    """`build` must never rewrite a versioned page that is already published or committed."""
    versioned = versioned_pages(cfg)
    base = os.path.join(root, cfg['output_dir'])
    problems = []
    for rel in sorted(files):
        if not versioned.fullmatch(rel):
            continue
        if rel in ledger:
            if ledger[rel] != sha256(files[rel]):
                problems.append(f'{rel}: already published (SHA-256 {ledger[rel]} in {LEDGER_PATH}) '
                                'and would change. Its source, a label or a linked page changed '
                                'without a version bump: give the document a new version')
            continue
        try:
            with open(os.path.join(base, *rel.split('/')), 'rb') as f:
                committed = f.read()
        except FileNotFoundError:
            continue
        if committed != files[rel]:
            problems.append(f'{rel}: already committed with other bytes and not in {LEDGER_PATH}; '
                            'a versioned page is never rewritten: give the document a new version')
    return problems


def ledger_problems(root, cfg, on_disk):
    """`check`: every committed versioned page is recorded, unchanged, and still there (R-12)."""
    ledger = load_ledger(root)
    versioned = versioned_pages(cfg)
    out_dir = cfg['output_dir']
    problems = []
    for rel, digest in sorted(ledger.items()):
        if rel not in on_disk:
            problems.append(f'{out_dir}/{rel}: published, but missing (R-12: a published version is '
                            'never removed)')
        elif sha256(on_disk[rel]) != digest:
            problems.append(f'{out_dir}/{rel}: changed after publication (its SHA-256 is not the one in '
                            f'{LEDGER_PATH}); publish a new version instead')
    for rel in sorted(on_disk):
        if versioned.fullmatch(rel) and rel not in ledger:
            problems.append(f'{out_dir}/{rel}: not recorded in {LEDGER_PATH}; run '
                            'scripts/legal/legal_pages.py build and commit the ledger')
    return problems


def build(root=ROOT):
    cfg = load_config(root)
    if not cfg['publish']:
        print(skipped_message(cfg))
        return 0
    try:
        files = render_site(root, cfg)
        ledger = load_ledger(root)
        problems = immutability_problems(root, cfg, files, ledger)
        if problems:
            raise Refused('\n'.join(problems))
    except Refused as e:
        print('legal pages: REFUSED. Nothing was written:\n' + str(e))
        return 1
    base = os.path.join(root, cfg['output_dir'])
    written = 0
    for rel in sorted(files):
        path = os.path.join(base, *rel.split('/'))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            with open(path, 'rb') as f:
                if f.read() == files[rel]:
                    continue
        except FileNotFoundError:
            pass
        with open(path, 'wb') as f:
            f.write(files[rel])
        written += 1
    versioned = versioned_pages(cfg)
    recorded = dict(ledger)
    recorded.update({rel: sha256(data) for rel, data in files.items() if versioned.fullmatch(rel)})
    if recorded != ledger or not os.path.isfile(os.path.join(root, LEDGER_PATH)):
        write_ledger(root, recorded)
    print(f'legal pages: {len(files)} files rendered into {cfg["output_dir"]}/ ({written} changed)')
    return 0


def block_of(text, opener):
    """The body of the `opener {` block in a comment-stripped nginx config, or None."""
    i = text.find(opener)
    if i < 0:
        return None
    j = text.index('{', i) + 1
    depth = 1
    k = j
    while depth and k < len(text):
        depth += {'{': 1, '}': -1}.get(text[k], 0)
        k += 1
    return text[j:k - 1]


def serving_problems(root):
    """The nginx template and the Dockerfile still serve /legal/ fail-closed."""
    problems = []
    with open(os.path.join(root, NGINX_TEMPLATE), encoding='utf-8') as f:
        raw = f.read()
    conf = re.sub(r'\$\{[A-Z_]+\}', 'X', '\n'.join(l.split('#', 1)[0] for l in raw.split('\n')))
    redirect = block_of(conf, 'location = /legal {')
    if redirect is None or 'return 301 /legal/;' not in redirect:
        problems.append(f'{NGINX_TEMPLATE}: no `location = /legal` redirect to /legal/ (a bare /legal would '
                        'serve the Admin Web app)')
    loc = block_of(conf, 'location /legal/ {')
    if loc is None or re.sub(r'\s+', ' ', loc).strip() != 'try_files $uri $uri/index.html =404;':
        problems.append(f'{NGINX_TEMPLATE}: `location /legal/` must be exactly `try_files $uri '
                        '$uri/index.html =404;` (a missing page is a 404, never the Admin Web app)')
    m = re.search(r'map \$uri \$jawwid_csp \{(.*?)\n\}', conf, re.S)
    csp = re.search(r'~\^/legal\(/\|\$\)\s+"([^"]*)";', m.group(1)) if m else None
    if not csp:
        problems.append(f'{NGINX_TEMPLATE}: no /legal entry in the $jawwid_csp map')
    else:
        policy = csp.group(1)
        for need in ("default-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'"):
            if need not in policy:
                problems.append(f'{NGINX_TEMPLATE}: the /legal CSP lacks {need}')
        for bad in ('unsafe-inline', 'unsafe-eval', 'script-src', '*', 'https:'):
            if bad in policy:
                problems.append(f'{NGINX_TEMPLATE}: the /legal CSP must not contain {bad}')
    m = re.search(r'map \$uri \$jawwid_cache_control \{(.*?)\n\}', conf, re.S)
    if not m or not re.search(r'~\^/legal\(/\|\$\)\s+"no-cache";', m.group(1)):
        problems.append(f'{NGINX_TEMPLATE}: no /legal "no-cache" entry in the $jawwid_cache_control map')
    for lm in re.finditer(r'\blocation\b[^{]*\{', conf):
        body = block_of(conf[lm.start():], lm.group(0))
        if body is not None and 'add_header' in body:
            problems.append(f'{NGINX_TEMPLATE}: add_header inside `{lm.group(0).strip()}` strips the '
                            'server-level CSP, HSTS and nosniff')
    with open(os.path.join(root, DOCKERFILE), encoding='utf-8') as f:
        docker = f.read()
    if 'COPY legal-web/ /usr/share/nginx/html/legal/' not in docker:
        problems.append(f'{DOCKERFILE}: does not copy legal-web/ to /usr/share/nginx/html/legal/')
    for need in ("grep -rlF", "-e '{{'", "-e 'TO CONFIRM'", "-e 'legal review'", 'rmdir'):
        if need not in docker:
            problems.append(f'{DOCKERFILE}: the image no longer refuses marked pages ({need} missing)')
    return problems


def check(root=ROOT):
    cfg = load_config(root)
    problems = serving_problems(root)
    if not os.path.isfile(os.path.join(root, cfg['output_dir'], '.gitkeep')):
        problems.append(f'{cfg["output_dir"]}/.gitkeep is missing (the Dockerfile COPY needs the directory)')
    on_disk = output_files(root, cfg)
    if not cfg['publish']:
        for rel in sorted(on_disk):
            problems.append(f'{cfg["output_dir"]}/{rel}: publication is off, so nothing may be served')
        state = 'publication is off; nothing is served at /legal/ (404)'
    else:
        try:
            files = render_site(root, cfg)
        except Refused as e:
            files = None
            problems.append('publication is on, but the sources are refused:\n' + str(e))
        if files is not None:
            for rel in sorted(files):
                if rel not in on_disk:
                    problems.append(f'{cfg["output_dir"]}/{rel}: missing; run scripts/legal/legal_pages.py build')
                elif on_disk[rel] != files[rel]:
                    problems.append(f'{cfg["output_dir"]}/{rel}: differs from its source (R-7); '
                                    'run scripts/legal/legal_pages.py build')
            versioned = versioned_pages(cfg)
            for rel in sorted(set(on_disk) - set(files)):
                if not versioned.fullmatch(rel):
                    problems.append(f'{cfg["output_dir"]}/{rel}: not produced by the generator')
        try:
            problems += ledger_problems(root, cfg, on_disk)
        except Refused as e:
            problems.append(str(e))
        for rel in sorted(on_disk):
            problems += [f'{cfg["output_dir"]}/{p}' for p in page_problems(rel, on_disk[rel])]
        state = ('publication is on; every committed page is what its source renders, and every '
                 'versioned page is byte-identical to its recorded publication')
    if problems:
        print('legal pages: FAIL\n' + '\n'.join(problems))
        return 1
    print(f'legal pages: {state}; nginx and the Dockerfile serve /legal/ fail-closed')
    return 0


def versioned_pages(cfg):
    """The versioned pages of the acceptance documents, …/<slug>/<version>/index.html: the current
    version and every earlier one (R-12: they stay published, byte for byte; see LEDGER_PATH)."""
    slugs = '|'.join(re.escape(e['slug']) for e in cfg['documents'] if e.get('gate_key')) or '(?!)'
    return re.compile(rf'(ar|en)/({slugs})/{VERSION_RE.pattern}/index\.html')


def manifest(root=ROOT, as_json=False):
    """Print, per document and language, what chat.publish_legal_version needs. Writes nothing."""
    cfg = load_config(root)
    if not cfg['publish']:
        print(skipped_message(cfg))
        print('publication manifest: nothing is published, so there is nothing to record.')
        return 1
    try:
        files = render_site(root, cfg)
        docs = load_documents(root, cfg)
    except Refused as e:
        print('publication manifest: REFUSED:\n' + str(e))
        return 1
    on_disk = output_files(root, cfg)
    stale = [rel for rel in sorted(files) if on_disk.get(rel) != files[rel]]
    if stale:
        print('publication manifest: REFUSED. The committed pages differ from their sources; run '
              'scripts/legal/legal_pages.py build and commit first:\n' + '\n'.join(stale))
        return 1
    try:
        unrecorded = ledger_problems(root, cfg, on_disk)
    except Refused as e:
        unrecorded = [str(e)]
    if unrecorded:
        print('publication manifest: REFUSED. The versioned pages do not match '
              f'{LEDGER_PATH}:\n' + '\n'.join(unrecorded))
        return 1
    base = cfg['base_url'].rstrip('/')
    rows, gate = [], []
    for doc in docs:
        entry = doc['entry']
        per_lang = {}
        for lang in LANGS:
            fm = doc['lang'][lang]['fm']
            row = {'source': doc['lang'][lang]['rel'], 'document_key': fm['document_key'],
                   'language': lang, 'version': fm['version'], 'effective_date': fm['effective_date']}
            for kind, version in (('current', None), ('versioned', fm['version'] if entry.get('gate_key') else None)):
                if kind == 'versioned' and version is None:
                    continue
                path = url_path(lang, doc['slug'], version)
                rel = path[len('/legal/'):] + '/index.html'
                row[f'{kind}_url'] = base + path[len('/legal'):]
                row[f'{kind}_sha256'] = hashlib.sha256(files[rel]).hexdigest()
            rows.append(row)
            per_lang[lang] = row
        if entry.get('gate_key'):
            gate.append({
                'p_document_key': entry['gate_key'],
                'p_version': per_lang['ar']['version'],
                'p_url_ar': per_lang['ar']['versioned_url'],
                'p_url_en': per_lang['en']['versioned_url'],
                'p_content_sha256_ar': per_lang['ar']['versioned_sha256'],
                'p_content_sha256_en': per_lang['en']['versioned_sha256'],
                'effective_date': per_lang['ar']['effective_date'],
            })
    for g in gate:
        for k in ('p_url_ar', 'p_url_en'):
            if len(g[k]) > 2048 or not re.fullmatch(r'https://\S+', g[k]):
                print(f'publication manifest: REFUSED. {g[k]!r} would fail chat.legal_document_version')
                return 1
    if as_json:
        print(json.dumps({'pages': rows, 'publish_legal_version': gate}, ensure_ascii=False, indent=2,
                         sort_keys=True))
        return 0
    print('Public legal pages: version, URL and SHA-256 of the exact bytes served (print only; '
          'nothing is written to any database).')
    for r in rows:
        print(f'\n{r["source"]}  [{r["document_key"]}, {r["language"]}]  version {r["version"]}, '
              f'effective {r["effective_date"]}')
        print(f'  {r["current_url"]}  sha256 {r["current_sha256"]}')
        if 'versioned_url' in r:
            print(f'  {r["versioned_url"]}  sha256 {r["versioned_sha256"]}')
    print('\nInputs for chat.publish_legal_version (the owner\'s release process runs it; '
          'p_requires_reacceptance and the time of p_effective_at are the owner\'s decision):')
    for g in gate:
        print()
        for k in ('p_document_key', 'p_version', 'p_url_ar', 'p_url_en', 'p_content_sha256_ar',
                  'p_content_sha256_en', 'effective_date'):
            print(f'  {k} = {g[k]}')
    return 0


def main(argv):
    if len(argv) != 1 or argv[0] not in ('build', 'check'):
        print(__doc__.split('\n\n')[0], file=sys.stderr)
        return 64
    try:
        return build() if argv[0] == 'build' else check()
    except (OSError, ValueError, KeyError, Refused) as e:
        print(f'legal pages: FAIL ({type(e).__name__}: {e})')
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
