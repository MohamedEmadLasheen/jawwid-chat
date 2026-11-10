#!/usr/bin/env python3
"""Tests for scripts/legal/legal_pages.py and publication-manifest.py (LR-04).

    python3 -I scripts/legal/test_legal_pages.py

Run by `bash scripts/qa/guards.sh web-env`. Each test builds a throwaway repository root in a temp
directory: the fixture documents in scripts/legal/fixtures/, a generator config, and copies of the
REAL nginx template and Dockerfile, so the serving checks are proven against what ships.
Standard library only; nothing outside the temp directory is written.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import shutil
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
FIXTURES = os.path.join(HERE, 'fixtures')


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


lp = _load('legal_pages', 'legal_pages.py')

CONFIG = {
    'publish': True,
    'base_url': 'https://admin.example.test/legal',
    'source_dir': 'docs/legal',
    'output_dir': 'apps/admin-web/legal-web',
    'pd048_source': 'docs/legal/pd048-sample.md',
    'labels': {
        'ar': {'site': 'أكاديمية جَوِّد', 'index_title': 'الوثائق القانونية',
               'other_language': 'English', 'all_documents': 'كل الوثائق'},
        'en': {'site': 'Jawwid Academy', 'index_title': 'Legal documents',
               'other_language': 'العربية', 'all_documents': 'All documents'},
    },
    'documents': [
        {'source': 'sample-terms', 'slug': 'terms', 'nav': True, 'pd048': True, 'gate_key': 'terms_family'},
        {'source': 'sample-support', 'slug': 'support', 'nav': True},
    ],
}


def run(fn, *args, **kwargs):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        rc = fn(*args, **kwargs)
    return rc, out.getvalue()


class Site(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='legal-pages-test-')
        self.addCleanup(shutil.rmtree, self.root)
        src = os.path.join(self.root, 'docs', 'legal')
        os.makedirs(src)
        for name in os.listdir(FIXTURES):
            shutil.copy(os.path.join(FIXTURES, name), src)
        for rel in (lp.NGINX_TEMPLATE, lp.DOCKERFILE):
            os.makedirs(os.path.dirname(self.path(rel)), exist_ok=True)
            shutil.copy(os.path.join(REPO, rel), self.path(rel))
        os.makedirs(self.path(CONFIG['output_dir']))
        open(self.path(CONFIG['output_dir'], '.gitkeep'), 'w').close()
        self.config(publish=True)

    def path(self, *parts):
        return os.path.join(self.root, *[p for part in parts for p in part.split('/')])

    def config(self, **changes):
        cfg = json.loads(json.dumps(CONFIG))
        cfg.update(changes)
        with open(self.path(lp.CONFIG_PATH), 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False)

    def edit(self, rel, old, new):
        p = self.path(rel)
        with open(p, encoding='utf-8') as f:
            text = f.read()
        self.assertIn(old, text, f'fixture {rel} changed; update the test')
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text.replace(old, new, 1))

    def output(self):
        return sorted(lp.output_files(self.root, json.loads(json.dumps(CONFIG))))

    def page(self, rel):
        with open(self.path(CONFIG['output_dir'], rel), encoding='utf-8') as f:
            return f.read()


class SwitchOff(Site):
    """Today: the switch is off. Nothing is rendered, nothing may be served."""

    def setUp(self):
        super().setUp()
        self.config(publish=False)

    def test_build_is_skipped_with_a_message_and_writes_nothing(self):
        rc, out = run(lp.build, self.root)
        self.assertEqual(rc, 0)
        self.assertIn('SKIPPED', out)
        self.assertIn('404', out)
        self.assertEqual(self.output(), [])

    def test_check_passes_with_an_empty_legal_web(self):
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 0, out)
        self.assertIn('publication is off', out)

    def test_check_fails_on_any_page_while_off(self):
        os.makedirs(self.path(CONFIG['output_dir'], 'en', 'privacy'))
        with open(self.path(CONFIG['output_dir'], 'en', 'privacy', 'index.html'), 'w') as f:
            f.write('<p>placeholder</p>')
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 1)
        self.assertIn('publication is off, so nothing may be served', out)

    def test_check_fails_without_the_gitkeep(self):
        os.remove(self.path(CONFIG['output_dir'], '.gitkeep'))
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 1)
        self.assertIn('.gitkeep', out)

    def test_manifest_refuses_and_writes_nothing(self):
        rc, out = run(lp.manifest, self.root)
        self.assertEqual(rc, 1)
        self.assertIn('nothing is published', out)
        self.assertEqual(self.output(), [])


class SwitchOn(Site):
    """After the owner's values and counsel's review: clean sources render."""

    def build(self):
        rc, out = run(lp.build, self.root)
        self.assertEqual(rc, 0, out)
        return out

    def test_renders_both_languages_at_the_planned_paths(self):
        self.build()
        self.assertEqual(self.output(), sorted([
            'index.html', 'legal.css', 'ar/index.html', 'en/index.html',
            'ar/terms/index.html', 'en/terms/index.html',
            'ar/terms/1.0/index.html', 'en/terms/1.0/index.html',
            'ar/support/index.html', 'en/support/index.html']))

    def test_arabic_is_rtl_and_english_ltr(self):
        self.build()
        self.assertIn('<html lang="ar" dir="rtl">', self.page('ar/terms/index.html'))
        self.assertIn('<html lang="en" dir="ltr">', self.page('en/terms/index.html'))
        self.assertIn('<title>شروط تجريبية · أكاديمية جَوِّد</title>', self.page('ar/terms/index.html'))

    def test_each_language_links_to_the_other_and_versioned_to_versioned(self):
        self.build()
        self.assertIn('href="/legal/en/terms" lang="en" hreflang="en">English</a>', self.page('ar/terms/index.html'))
        self.assertIn('href="/legal/ar/terms" lang="ar"', self.page('en/terms/index.html'))
        self.assertIn('href="/legal/en/terms/1.0" lang="en"', self.page('ar/terms/1.0/index.html'))

    def test_source_links_become_page_paths(self):
        self.build()
        self.assertIn('<a href="/legal/en/support">Help page</a>', self.page('en/terms/index.html'))
        self.assertIn('<a href="/legal/ar/terms">شروط تجريبية</a>', self.page('ar/support/index.html'))

    def test_markdown_subset(self):
        self.build()
        en = self.page('en/terms/index.html')
        self.assertIn('<h1>Sample Terms</h1>', en)
        self.assertIn('<h2>1. About these terms</h2>', en)
        self.assertIn('<em>fixture</em>', en)
        self.assertIn('<blockquote>\n<p><strong>Lesson audio.</strong>', en)
        self.assertIn('<li>Second point,\ncontinued on the next line</li>'.replace('\n', ' '), en)
        self.assertIn('<ol>\n<li>Step one</li>', en)
        support = self.page('en/support/index.html')
        self.assertIn('<a href="mailto:help@example.com">help@example.com</a>', support)
        self.assertIn('<a href="https://example.com/help" rel="noopener noreferrer">https://example.com/help</a>.', support)
        self.assertIn('<th scope="col">Topic</th>', support)
        self.assertIn('<div class="table-wrap" tabindex="0"><table>', support)

    def test_html_in_the_source_is_escaped(self):
        self.build()
        en = self.page('en/terms/index.html')
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', en)
        self.assertNotIn('<script', en)

    def test_pages_need_no_script_inline_style_or_third_party(self):
        self.build()
        for rel in self.output():
            text = self.page(rel)
            self.assertEqual(lp.page_problems(rel, text.encode('utf-8')), [], rel)
            self.assertNotIn('<style', text)
            self.assertNotIn(' style=', text)
            self.assertNotIn('//fonts.', text)
        self.assertIn('<link rel="stylesheet" href="/legal/legal.css">', self.page('en/index.html'))

    def test_every_directory_has_an_index(self):
        self.build()
        files = set(self.output())
        for rel in files:
            parts = rel.split('/')[:-1]
            for k in range(len(parts) + 1):
                self.assertIn('/'.join(parts[:k] + ['index.html']), files, rel)

    def test_versioned_copy_differs_only_in_its_language_link(self):
        self.build()
        cur, ver = self.page('en/terms/index.html'), self.page('en/terms/1.0/index.html')
        expected = (cur.replace('hreflang="ar" href="/legal/ar/terms">', 'hreflang="ar" href="/legal/ar/terms/1.0">')
                       .replace('href="/legal/ar/terms" lang="ar"', 'href="/legal/ar/terms/1.0" lang="ar"'))
        self.assertNotEqual(cur, expected)
        self.assertEqual(expected, ver)
        # The body's own link to the other language stays on the current text.
        self.assertIn('<a href="/legal/ar/terms">العربية</a>', ver)

    def test_deterministic(self):
        cfg = json.loads(json.dumps(CONFIG))
        self.assertEqual(lp.render_site(self.root, cfg), lp.render_site(self.root, cfg))

    def test_check_passes_after_build_and_catches_drift(self):
        self.build()
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 0, out)
        with open(self.path(CONFIG['output_dir'], 'en/support/index.html'), 'a') as f:
            f.write('<!-- hand edit -->')
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 1)
        self.assertIn('differs from its source (R-7)', out)

    def test_check_catches_a_missing_page_and_a_stray_file(self):
        self.build()
        os.remove(self.path(CONFIG['output_dir'], 'ar/support/index.html'))
        with open(self.path(CONFIG['output_dir'], 'en/extra.html'), 'w') as f:
            f.write('<p>x</p>')
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 1)
        self.assertIn('ar/support/index.html: missing', out)
        self.assertIn('en/extra.html: not produced by the generator', out)

    def test_an_archived_version_stays_but_is_still_scanned(self):
        self.build()
        old = self.path(CONFIG['output_dir'], 'en/terms/0.9')
        os.makedirs(old)
        with open(os.path.join(old, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(self.page('en/terms/1.0/index.html'))
        self.record('en/terms/0.9/index.html')
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 0, out)
        with open(os.path.join(old, 'index.html'), 'a', encoding='utf-8') as f:
            f.write('{{ENTITY_NAME}}')
        self.record('en/terms/0.9/index.html')
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 1)
        self.assertIn('en/terms/0.9/index.html: contains a {{PLACEHOLDER}}', out)

    def record(self, rel):
        """Add a page's current hash to the ledger, as if it had been published earlier."""
        with open(self.path(lp.LEDGER_PATH), encoding='utf-8') as f:
            data = json.load(f)
        with open(self.path(CONFIG['output_dir'], rel), 'rb') as f:
            data['pages'][rel] = hashlib.sha256(f.read()).hexdigest()
        with open(self.path(lp.LEDGER_PATH), 'w', encoding='utf-8') as f:
            json.dump(data, f)

    def test_build_never_deletes_existing_files(self):
        keep = self.path(CONFIG['output_dir'], 'en/terms/0.9')
        os.makedirs(keep)
        open(os.path.join(keep, 'index.html'), 'w').close()
        self.build()
        self.assertTrue(os.path.exists(os.path.join(keep, 'index.html')))
        self.assertTrue(os.path.exists(self.path(CONFIG['output_dir'], '.gitkeep')))

    def test_manifest_prints_urls_and_the_served_bytes_hash(self):
        self.build()
        before = self.output()
        rc, out = run(lp.manifest, self.root, as_json=True)
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.output(), before)
        data = json.loads(out)
        with open(self.path(CONFIG['output_dir'], 'en/terms/1.0/index.html'), 'rb') as f:
            en_versioned = hashlib.sha256(f.read()).hexdigest()
        with open(self.path(CONFIG['output_dir'], 'ar/terms/1.0/index.html'), 'rb') as f:
            ar_versioned = hashlib.sha256(f.read()).hexdigest()
        with open(self.path(CONFIG['output_dir'], 'ar/terms/index.html'), 'rb') as f:
            self.assertNotEqual(hashlib.sha256(f.read()).hexdigest(), ar_versioned)
        with open(self.path(CONFIG['output_dir'], 'ar/support/index.html'), 'rb') as f:
            ar_support = hashlib.sha256(f.read()).hexdigest()
        self.assertEqual(data['publish_legal_version'], [{
            'p_document_key': 'terms_family',
            'p_version': '1.0',
            'p_url_ar': 'https://admin.example.test/legal/ar/terms/1.0',
            'p_url_en': 'https://admin.example.test/legal/en/terms/1.0',
            'p_content_sha256_ar': ar_versioned,
            'p_content_sha256_en': en_versioned,
            'effective_date': '2026-12-01',
        }])
        support = [r for r in data['pages'] if r['document_key'] == 'support_page' and r['language'] == 'ar'][0]
        self.assertEqual(support['current_url'], 'https://admin.example.test/legal/ar/support')
        self.assertEqual(support['current_sha256'], ar_support)
        self.assertNotIn('versioned_url', support)
        rc, text = run(lp.manifest, self.root)
        self.assertEqual(rc, 0, text)
        self.assertIn('p_content_sha256_en = ' + en_versioned, text)
        self.assertIn('nothing is written to any database', text)

    def test_manifest_refuses_stale_committed_pages(self):
        rc, out = run(lp.manifest, self.root)
        self.assertEqual(rc, 1)
        self.assertIn('differ from their sources', out)


class Refusals(Site):
    """Fail closed: one unfinished page refuses the whole build, and nothing is written."""

    def assertRefused(self, why):
        rc, out = run(lp.build, self.root)
        self.assertEqual(rc, 1, out)
        self.assertIn('REFUSED', out)
        self.assertIn(why, out)
        self.assertEqual(self.output(), [])
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 1, out)

    def test_placeholder(self):
        self.edit('docs/legal/sample-support-ar.md', 'help@example.com', '{{SUPPORT_EMAIL}}')
        self.assertRefused('sample-support-ar.md: still contains a {{PLACEHOLDER}}')

    def test_placeholder_version(self):
        self.edit('docs/legal/sample-terms-en.md', 'version: "1.0"', 'version: "{{VERSION}}"')
        self.assertRefused('not a publishable version name')

    def test_to_confirm(self):
        self.edit('docs/legal/sample-support-en.md', 'By e-mail', 'By e-mail [TO CONFIRM]')
        self.assertRefused('[TO CONFIRM]')

    def test_legal_review(self):
        self.edit('docs/legal/sample-terms-en.md', 'Step two', 'Step two [legal review]')
        self.assertRefused('[legal review]')

    def test_arabic_legal_review(self):
        self.edit('docs/legal/sample-terms-ar.md', 'النقطة الثانية', 'النقطة الثانية [مراجعة قانونية]')
        self.assertRefused('مراجعة قانونية')

    def test_drafting_note(self):
        self.edit('docs/legal/sample-terms-en.md', '- First point',
                  '> **Drafting note (remove before publication):** x\n\n- First point')
        self.assertRefused('a drafting note')

    def test_draft_status(self):
        self.edit('docs/legal/sample-terms-ar.md', 'status: "Published"',
                  'status: "Ready"')
        self.assertRefused('not "Published"')

    def test_internal_id_on_the_page(self):
        self.edit('docs/legal/sample-support-en.md', 'By e-mail', 'See LD-7')
        self.assertRefused('internal ID')

    def test_languages_disagree_on_version(self):
        self.edit('docs/legal/sample-support-ar.md', 'version: "1.0"', 'version: "1.1"')
        self.assertRefused('Arabic and English differ in version')

    def test_bad_date(self):
        self.edit('docs/legal/sample-support-en.md', 'effective_date: "2026-12-01"', 'effective_date: "2026-02-30"')
        self.assertRefused('not a YYYY-MM-DD date')

    def test_gate_key_must_match_the_document_key(self):
        self.edit('docs/legal/sample-terms-en.md', 'document_key: terms_family', 'document_key: privacy_policy')
        self.assertRefused('is not the gate key')

    def test_pd048_paragraph_changed(self):
        self.edit('docs/legal/sample-terms-en.md', 'must appear unchanged', 'may change')
        self.assertRefused('PD-48 paragraph is missing or changed (R-13)')

    def test_link_to_an_unpublished_document(self):
        self.edit('docs/legal/sample-terms-en.md', '(sample-support-en.md)', '(owner-confirmation-sheet.md)')
        self.assertRefused('not a published document')

    def test_script_link(self):
        self.edit('docs/legal/sample-terms-en.md', '(sample-support-en.md)', '(javascript:alert(1))')
        self.assertRefused('neither a published document, https nor mailto')

    def test_code_fence(self):
        self.edit('docs/legal/sample-support-en.md', 'Write to', '```\ncode\n```\n\nWrite to')
        self.assertRefused('code fences are not supported')

    def test_version_missing_from_the_page(self):
        self.edit('docs/legal/sample-support-en.md', '**Version** 1.0 · **Effective** 2026-12-01', '**Version**')
        self.assertRefused('does not show its')

    def test_short_version_hidden_inside_the_date_is_not_shown(self):
        # Version "1" occurs inside "2026-12-01"; that must not count as showing the version (R-5).
        for lang in ('ar', 'en'):
            self.edit(f'docs/legal/sample-support-{lang}.md', 'version: "1.0"', 'version: "1"')
        self.edit('docs/legal/sample-support-en.md', '**Version** 1.0 · ', '')
        self.assertRefused("does not show its version '1'")

    def test_to_confirm_in_lower_case(self):
        self.edit('docs/legal/sample-support-en.md', 'By e-mail', 'By e-mail [to confirm]')
        self.assertRefused('[TO CONFIRM]')

    def test_tight_nested_unordered_list(self):
        # "  - sub" directly under "- item" (no blank line) must not be merged into the parent item.
        self.edit('docs/legal/sample-terms-en.md', '- First point\n', '- First point\n  - A sub-clause\n')
        self.assertRefused('nested lists are not supported')

    def test_tight_nested_ordered_list(self):
        self.edit('docs/legal/sample-terms-en.md', '1. Step one\n', '1. Step one\n   1. A sub-step\n')
        self.assertRefused('nested lists are not supported')

    def test_tight_nested_list_after_a_continuation_line(self):
        self.edit('docs/legal/sample-terms-en.md', '  continued on the next line\n',
                  '  continued on the next line\n  - A sub-clause\n')
        self.assertRefused('nested lists are not supported')

    def test_separated_nested_list(self):
        self.edit('docs/legal/sample-terms-en.md', '- First point\n', '- First point\n\n  - A sub-clause\n')
        self.assertRefused('nested lists are not supported')

    def test_indented_list_under_a_paragraph(self):
        self.edit('docs/legal/sample-support-en.md', 'Write to help@example.com',
                  'Write to help@example.com\n  - or by post')
        self.assertRefused('nested lists are not supported')


class Immutable(Site):
    """A versioned page (<slug>/<version>/index.html) is what the terms gate recorded: once committed it
    never changes. A change needs a new version; the old version stays, byte for byte (LR-02d, R-12)."""

    VERSIONED = ('ar/terms/1.0/index.html', 'en/terms/1.0/index.html')

    def build(self):
        rc, out = run(lp.build, self.root)
        self.assertEqual(rc, 0, out)
        return out

    def ledger(self):
        with open(self.path(lp.LEDGER_PATH), encoding='utf-8') as f:
            return json.load(f)['pages']

    def sha(self, rel):
        with open(self.path(CONFIG['output_dir'], rel), 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()

    def assertBuildRefusesAndKeepsTheBytes(self, why):
        before = {rel: self.page(rel) for rel in self.output()}
        ledger = self.ledger()
        rc, out = run(lp.build, self.root)
        self.assertEqual(rc, 1, out)
        self.assertIn('REFUSED', out)
        self.assertIn(why, out)
        self.assertEqual({rel: self.page(rel) for rel in self.output()}, before)
        self.assertEqual(self.ledger(), ledger)

    def test_build_records_the_versioned_hashes(self):
        self.build()
        self.assertEqual(self.ledger(), {rel: self.sha(rel) for rel in self.VERSIONED})
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 0, out)
        out = self.build()
        self.assertIn('(0 changed)', out)

    def test_source_change_without_a_version_bump_is_refused(self):
        self.build()
        self.edit('docs/legal/sample-terms-en.md', 'Step two', 'Step two, reworded')
        self.assertBuildRefusesAndKeepsTheBytes('en/terms/1.0/index.html: already published')

    def test_label_change_without_a_version_bump_is_refused(self):
        self.build()
        self.config(labels={**CONFIG['labels'], 'ar': {**CONFIG['labels']['ar'], 'all_documents': 'الوثائق'}})
        self.assertBuildRefusesAndKeepsTheBytes('ar/terms/1.0/index.html: already published')

    def test_link_target_change_without_a_version_bump_is_refused(self):
        self.build()
        docs = [dict(d) for d in CONFIG['documents']]
        docs[1]['slug'] = 'help'
        self.config(documents=docs)
        self.assertBuildRefusesAndKeepsTheBytes('en/terms/1.0/index.html: already published')

    def test_an_unrecorded_committed_versioned_page_is_not_overwritten(self):
        os.makedirs(self.path(CONFIG['output_dir'], 'en/terms/1.0'))
        with open(self.path(CONFIG['output_dir'], 'en/terms/1.0/index.html'), 'w') as f:
            f.write('<p>committed earlier</p>')
        rc, out = run(lp.build, self.root)
        self.assertEqual(rc, 1, out)
        self.assertIn('en/terms/1.0/index.html: already committed', out)
        self.assertEqual(self.page('en/terms/1.0/index.html'), '<p>committed earlier</p>')
        self.assertFalse(os.path.exists(self.path(lp.LEDGER_PATH)))

    def test_a_version_bump_publishes_the_new_version_and_keeps_the_old(self):
        self.build()
        old = {rel: self.sha(rel) for rel in self.VERSIONED}
        for lang in ('ar', 'en'):
            self.edit(f'docs/legal/sample-terms-{lang}.md', 'version: "1.0"', 'version: "1.1"')
            self.edit(f'docs/legal/sample-terms-{lang}.md', '1.0', '1.1')
        self.edit('docs/legal/sample-terms-en.md', 'Step two', 'Step two, reworded')
        self.build()
        self.assertEqual({rel: self.sha(rel) for rel in self.VERSIONED}, old)
        ledger = self.ledger()
        self.assertEqual({k: ledger[k] for k in self.VERSIONED}, old)
        self.assertEqual(ledger['en/terms/1.1/index.html'], self.sha('en/terms/1.1/index.html'))
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 0, out)

    def test_check_fails_when_a_versioned_page_was_deleted_and_rebuilt(self):
        self.build()
        self.edit('docs/legal/sample-terms-en.md', 'Step two', 'Step two, reworded')
        os.remove(self.path(CONFIG['output_dir'], 'en/terms/1.0/index.html'))
        # The ledger stops even a rebuild of a deleted page...
        self.assertBuildRefusesAndKeepsTheBytes('en/terms/1.0/index.html: already published')
        # ...and a hand-made copy of the new render is caught by check.
        cfg = json.loads(json.dumps(CONFIG))
        with open(self.path(CONFIG['output_dir'], 'en/terms/1.0/index.html'), 'wb') as f:
            f.write(lp.render_site(self.root, cfg)['en/terms/1.0/index.html'])
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 1, out)
        self.assertIn('en/terms/1.0/index.html: changed after publication', out)

    def test_check_fails_on_a_changed_or_removed_archived_version(self):
        self.build()
        for lang in ('ar', 'en'):
            self.edit(f'docs/legal/sample-terms-{lang}.md', 'version: "1.0"', 'version: "1.1"')
            self.edit(f'docs/legal/sample-terms-{lang}.md', '1.0', '1.1')
        self.build()
        with open(self.path(CONFIG['output_dir'], 'en/terms/1.0/index.html'), 'a') as f:
            f.write('<!-- edit -->')
        os.remove(self.path(CONFIG['output_dir'], 'ar/terms/1.0/index.html'))
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 1, out)
        self.assertIn('en/terms/1.0/index.html: changed after publication', out)
        self.assertIn('ar/terms/1.0/index.html: published, but missing', out)

    def test_check_fails_on_an_unrecorded_versioned_page(self):
        self.build()
        old = self.path(CONFIG['output_dir'], 'en/terms/0.9')
        os.makedirs(old)
        with open(os.path.join(old, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(self.page('en/terms/1.0/index.html'))
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 1, out)
        self.assertIn('en/terms/0.9/index.html: not recorded in', out)

    def test_check_fails_when_the_ledger_is_edited(self):
        self.build()
        with open(self.path(lp.LEDGER_PATH), encoding='utf-8') as f:
            data = json.load(f)
        data['pages']['en/terms/1.0/index.html'] = '0' * 64
        with open(self.path(lp.LEDGER_PATH), 'w', encoding='utf-8') as f:
            json.dump(data, f)
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 1, out)
        self.assertIn('en/terms/1.0/index.html: changed after publication', out)


class Serving(Site):
    """The real nginx template and Dockerfile serve /legal/ fail-closed; a regression is caught."""

    def setUp(self):
        super().setUp()
        self.config(publish=False)

    def assertCaught(self, rel, old, new, why):
        self.edit(rel, old, new)
        rc, out = run(lp.check, self.root)
        self.assertEqual(rc, 1, out)
        self.assertIn(why, out)

    def test_the_real_files_pass(self):
        self.assertEqual(lp.serving_problems(self.root), [])

    def test_spa_fallback_under_legal(self):
        self.assertCaught(lp.NGINX_TEMPLATE, 'try_files $uri $uri/index.html =404;\n    }\n\n    # SPA',
                          'try_files $uri $uri/index.html /index.html;\n    }\n\n    # SPA', 'never the Admin Web app')

    def test_missing_redirect(self):
        self.assertCaught(lp.NGINX_TEMPLATE, 'return 301 /legal/;', 'return 404;', 'redirect to /legal/')

    def test_add_header_in_a_location(self):
        self.assertCaught(lp.NGINX_TEMPLATE, 'try_files $uri $uri/index.html =404;\n    }\n\n    # SPA',
                          'try_files $uri $uri/index.html =404;\n        add_header X-Test "1";\n    }\n\n    # SPA',
                          'add_header inside')

    def test_csp_loosened(self):
        self.assertCaught(lp.NGINX_TEMPLATE, "default-src 'none'; style-src 'self';",
                          "default-src 'none'; style-src 'self' 'unsafe-inline';", 'must not contain unsafe-inline')

    def test_csp_allows_framing(self):
        self.assertCaught(lp.NGINX_TEMPLATE, "form-action 'none'; frame-ancestors 'none'\"",
                          "form-action 'none'\"", "lacks frame-ancestors 'none'")

    def test_cache_entry_removed(self):
        self.assertCaught(lp.NGINX_TEMPLATE, '    ~^/legal(/|$)     "no-cache";\n', '', 'no-cache')

    def test_dockerfile_without_the_refusal(self):
        self.assertCaught(lp.DOCKERFILE, "grep -rlF", "true || grep -rl", 'no longer refuses marked pages')

    def test_dockerfile_without_the_copy(self):
        self.assertCaught(lp.DOCKERFILE, 'COPY legal-web/ /usr/share/nginx/html/legal/', '', 'does not copy legal-web/')


class RealRepository(unittest.TestCase):
    """The committed state is consistent: the guard itself, on the real tree."""

    def test_check_passes(self):
        rc, out = run(lp.check, REPO)
        self.assertEqual(rc, 0, out)

    def test_every_listed_source_exists_in_both_languages(self):
        cfg = lp.load_config(REPO)
        for entry in cfg['documents']:
            for lang in lp.LANGS:
                self.assertTrue(os.path.isfile(os.path.join(REPO, cfg['source_dir'], f'{entry["source"]}-{lang}.md')),
                                entry['source'])

    def test_while_off_the_real_sources_would_be_refused_or_are_ready(self):
        # Documents the switch: when it is off, either the sources still carry markers (today), or they
        # are clean and the owner may turn it on. It must never be on with refused sources (check fails).
        cfg = lp.load_config(REPO)
        if cfg['publish']:
            self.skipTest('publication is on; test_check_passes covers it')
        cfg['publish'] = True
        try:
            lp.render_site(REPO, cfg)
        except lp.Refused as e:
            self.assertTrue(str(e))


if __name__ == '__main__':
    unittest.main(verbosity=2)
