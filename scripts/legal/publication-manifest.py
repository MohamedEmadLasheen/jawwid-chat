#!/usr/bin/env python3
"""Print what publishing the legal pages records (LR-04, LR-02d). PRINT ONLY.

    python3 -I scripts/legal/publication-manifest.py          # readable
    python3 -I scripts/legal/publication-manifest.py --json   # machine-readable

For each document and language: the version, the effective date, the final URL (and, for the four
acceptance documents, the versioned URL the terms gate stores) and the SHA-256 of the exact bytes
nginx serves there. For terms_family, terms_teacher, terms_staff and code_of_conduct it then lists
the inputs of chat.publish_legal_version (supabase/migrations/20261107110000_chat_pd058_terms.sql):
p_document_key, p_version, p_url_ar, p_url_en, p_content_sha256_ar, p_content_sha256_en.
p_requires_reacceptance and the time of p_effective_at are the owner's decision and are not guessed.

It connects to nothing and writes nothing: no database, no file. It refuses (exit 1) while
publication is switched off, when a source would be refused, or when the committed pages in
apps/admin-web/legal-web/ are not exactly what the sources render (the hash would not be the
served page's).
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load():
    # By absolute path: `python3 -I` keeps this directory off sys.path, on purpose.
    spec = importlib.util.spec_from_file_location('legal_pages', os.path.join(HERE, 'legal_pages.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv):
    if argv not in ([], ['--json']):
        print(__doc__.split('\n\n')[1], file=sys.stderr)
        return 64
    lp = load()
    try:
        return lp.manifest(as_json=argv == ['--json'])
    except (OSError, ValueError, KeyError, lp.Refused) as e:
        print(f'publication manifest: FAIL ({type(e).__name__}: {e})')
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
