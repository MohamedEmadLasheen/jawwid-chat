#!/usr/bin/env python3
"""Write the API's SIGNED approvals export into the lessons engine (PD-49, plan F.3).

    python3 -I scripts/lessons/export-approvals.py <export.json>

<export.json> is what the API answered GET /api/v1/lesson-content/approvals/<scope>
(quran-NNN or play) for a reviewer of the content organization: the envelope
{payload, keyId, signature}, signed by the API's LESSON_APPROVALS_SIGNING_KEY.
This writes it, byte for byte as canonical JSON, to
apps/lessons/src/content/approvals/surah-NNN.json (or play.json), after checking
its shape and that its key id is one of approvals-keys.json. It verifies
nothing cryptographically and changes nothing: CI does that
(scripts/lessons/verify-approvals.mjs), so a file edited after the API signed it
fails the build. Commit the file in an ordinary reviewed PR.
Standard library only; reads and writes files.
"""
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CONTENT = os.path.join(ROOT, 'apps', 'lessons', 'src', 'content')
KEYS = os.path.join(CONTENT, 'approvals-keys.json')


def target(lesson_key):
    if lesson_key == 'play':
        return 'play.json'
    m = re.fullmatch(r'quran-(\d{3})', lesson_key or '')
    return f'surah-{m.group(1)}.json' if m else None


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 2
    env = json.load(open(argv[0], encoding='utf-8'))
    if not isinstance(env, dict) or set(env) != {'payload', 'keyId', 'signature'} or not isinstance(env['payload'], dict):
        print('export-approvals: not a signed export {payload, keyId, signature}')
        return 1
    keys = {k.get('id') for k in json.load(open(KEYS, encoding='utf-8')).get('keys', [])}
    if env['keyId'] not in keys or not isinstance(env['signature'], str):
        print(f'export-approvals: signed by key {env["keyId"]!r}, which approvals-keys.json does not list; add the public key first')
        return 1
    name = target(env['payload'].get('lessonKey'))
    if not name:
        print('export-approvals: the payload names no lesson (quran-NNN or play)')
        return 1
    out = os.path.join(CONTENT, 'approvals', name)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(env, f, ensure_ascii=True, indent=1, sort_keys=True)
        f.write('\n')
    print(f'export-approvals: wrote {os.path.relpath(out, ROOT)} ({len(env["payload"].get("approvals", []))} approval(s)); '
          'now run: node scripts/lessons/verify-approvals.mjs')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
