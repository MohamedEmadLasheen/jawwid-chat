#!/usr/bin/env python3
"""The PD-number and migration-slot registry: one file per claim.

    python3 -I scripts/docs/registry-index.py            # print the index
    python3 -I scripts/docs/registry-index.py check      # the guard (pd-registry)
    python3 -I scripts/docs/registry-index.py selftest   # prove the guard fails

WHY ONE FILE PER CLAIM
----------------------
The registry used to be one table in docs/product/PD-NUMBER-REGISTRY.md with a
"next free" footer. Nearly every PR of the week of 2026-10-26 conflicted on it:
two branches adding a row to the same table, or bumping the same footer, is a
merge conflict every time. Now a claim is a NEW FILE --
docs/product/pd-registry/PD-<n>.md (or PD-<n>-amendment-<slug>.md) and
docs/product/migration-slots/<timestamp>.md -- so parallel PRs only ever add
distinct files and never touch the same one. The index is printed by this
script on demand and never committed, for the same reason.

WHAT THE CHECK REFUSES
----------------------
  * a claim file that does not parse, or whose name does not match its fields;
  * the same PD number claimed twice as a decision, or a claim of PD-1..PD-21
    (those are recorded in the boundary doc §4);
  * a slot that names a PD with no registry file;
  * two migrations in supabase/migrations with the same timestamp (apply.sh
    keys its ledger on the whole filename, so a duplicate does not fail -- it
    silently orders by the suffix);
  * a migration from the registry's start (20261022130000) on with no slot
    claim, or whose name differs from its claim.
Standard library only, so it runs with `python3 -I` on the CI runner and on a
Mac alike.
"""
from __future__ import annotations

import datetime
import os
import re
import sys
import tempfile

PD_DIR = "docs/product/pd-registry"
SLOT_DIR = "docs/product/migration-slots"
MIGRATIONS = "supabase/migrations"
# The first migration claimed through the registry. Earlier ones predate it.
REGISTRY_START = "20261022130000"
# PD-1..PD-21 are closed decisions recorded in the boundary doc §4 itself.
FIRST_REGISTERED_PD = 22

PD_RE = re.compile(r"^PD-(\d+)$")
SLOT_RE = re.compile(r"^\d{14}$")
MIGRATION_RE = re.compile(r"^(\d{14})_([a-z0-9_]+)\.sql$")
NAME_RE = re.compile(r"^[a-z0-9_]+$")


def front_matter(path: str) -> dict[str, str]:
    """The `key: value` lines between the leading `---` fences."""
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    if not lines or lines[0].strip() != "---" or "---" not in [l.strip() for l in lines[1:]]:
        raise ValueError("no front matter (a block between two '---' lines)")
    fields: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if not line.strip():
            continue
        if ":" not in line:
            raise ValueError(f"not a 'key: value' line: {line!r}")
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip()
    return fields


def claim_files(root: str, folder: str) -> list[str]:
    path = os.path.join(root, folder)
    if not os.path.isdir(path):
        return []
    return sorted(n for n in os.listdir(path) if n.endswith(".md") and n != "README.md")


def load(root: str):
    """(pds, slots, errors). pds/slots are lists of (filename, fields)."""
    errors: list[str] = []
    pds, slots = [], []
    for name in claim_files(root, PD_DIR):
        try:
            pds.append((name, front_matter(os.path.join(root, PD_DIR, name))))
        except (OSError, ValueError) as e:
            errors.append(f"{PD_DIR}/{name}: {e}")
    for name in claim_files(root, SLOT_DIR):
        try:
            slots.append((name, front_matter(os.path.join(root, SLOT_DIR, name))))
        except (OSError, ValueError) as e:
            errors.append(f"{SLOT_DIR}/{name}: {e}")
    return pds, slots, errors


def check(root: str) -> list[str]:
    pds, slots, errors = load(root)

    decisions: dict[int, str] = {}
    for name, f in pds:
        where = f"{PD_DIR}/{name}"
        for key in ("pd", "kind", "subject", "state"):
            if not f.get(key):
                errors.append(f"{where}: missing '{key}'")
        m = PD_RE.match(f.get("pd", ""))
        if not m:
            errors.append(f"{where}: pd must look like PD-<n>, got {f.get('pd')!r}")
            continue
        number = int(m.group(1))
        pd = f"PD-{number}"
        kind = f.get("kind")
        if number < FIRST_REGISTERED_PD:
            errors.append(f"{where}: PD-1..PD-{FIRST_REGISTERED_PD - 1} are recorded in the boundary doc §4; claim a new number")
        if kind == "decision":
            if name != f"{pd}.md":
                errors.append(f"{where}: a decision's file is named {pd}.md")
            if number in decisions:
                errors.append(f"{where}: {pd} is already claimed by {PD_DIR}/{decisions[number]}")
            else:
                decisions[number] = name
        elif kind == "amendment":
            if not (name.startswith(f"{pd}-amendment-") and len(name) > len(f"{pd}-amendment-.md")):
                errors.append(f"{where}: an amendment's file is named {pd}-amendment-<slug>.md")
        else:
            errors.append(f"{where}: kind must be 'decision' or 'amendment', got {kind!r}")

    claimed: dict[str, tuple[str, dict[str, str]]] = {}
    for name, f in slots:
        where = f"{SLOT_DIR}/{name}"
        slot = f.get("slot", "")
        if not SLOT_RE.match(slot):
            errors.append(f"{where}: slot must be a 14-digit timestamp, got {slot!r}")
            continue
        if name != f"{slot}.md":
            errors.append(f"{where}: a slot's file is named {slot}.md")
        m = PD_RE.match(f.get("pd", ""))
        if not m:
            errors.append(f"{where}: pd must look like PD-<n>, got {f.get('pd')!r}")
        elif int(m.group(1)) not in decisions:
            errors.append(f"{where}: names {f.get('pd')}, which has no {PD_DIR}/PD-{int(m.group(1))}.md")
        migration = f.get("migration", "")
        if migration and not NAME_RE.match(migration):
            errors.append(f"{where}: migration must be the file name without timestamp and .sql, got {migration!r}")
        claimed[slot] = (name, f)

    stamps: dict[str, str] = {}
    mig_dir = os.path.join(root, MIGRATIONS)
    names = sorted(n for n in os.listdir(mig_dir) if n.endswith(".sql")) if os.path.isdir(mig_dir) else []
    for name in names:
        m = MIGRATION_RE.match(name)
        if not m:
            errors.append(f"{MIGRATIONS}/{name}: a migration is named <14-digit timestamp>_<snake_case>.sql")
            continue
        stamp, rest = m.group(1), m.group(2)
        if stamp in stamps:
            errors.append(f"{MIGRATIONS}/{name}: timestamp {stamp} is also {MIGRATIONS}/{stamps[stamp]}")
        else:
            stamps[stamp] = name
        if stamp < REGISTRY_START:
            continue
        if stamp not in claimed:
            errors.append(f"{MIGRATIONS}/{name}: no claim -- add {SLOT_DIR}/{stamp}.md")
            continue
        want = claimed[stamp][1].get("migration", "")
        if want and want != rest:
            errors.append(f"{MIGRATIONS}/{name}: its claim {SLOT_DIR}/{stamp}.md says migration: {want}")
    return errors


def next_slot(highest: str) -> str:
    """A suggestion: the next round 10000 after the highest claim, or today if later."""
    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d") + "100000"
    bumped = str((int(highest) // 10000 + 1) * 10000) if highest else today
    return max(bumped, today)


def index(root: str) -> int:
    pds, slots, errors = load(root)
    rows = []
    for name, f in pds:
        m = PD_RE.match(f.get("pd", ""))
        rows.append((int(m.group(1)) if m else 0, f.get("kind") != "decision", name, f))
    rows.sort()
    print("| PD | Kind | Subject | Branch | PR | State |")
    print("|----|------|---------|--------|----|-------|")
    print("| PD-1 … PD-21 | decision | see the boundary doc §4 | — | — | CLOSED |")
    for number, _, name, f in rows:
        label = f.get("pd", "?") + ("" if f.get("kind") == "decision" else " amendment")
        print(f"| {label} | {f.get('kind', '')} | {f.get('subject', '')} | {f.get('branch', '')} | {f.get('pr', '')} | {f.get('state', '')} |")
    print()
    print("| Slot | PD | Migration | PR |")
    print("|------|----|-----------|----|")
    for name, f in sorted(slots):
        print(f"| `{f.get('slot', '')}` | {f.get('pd', '')} | `{f.get('migration', '') or '(not written yet)'}` | {f.get('pr', '')} |")
    numbers = [r[0] for r in rows if not r[1]]
    stamps = [f.get("slot", "") for _, f in slots if SLOT_RE.match(f.get("slot", ""))]
    print()
    print(f"Next free PD number: PD-{max(numbers + [FIRST_REGISTERED_PD - 1]) + 1}")
    highest = max(stamps) if stamps else ""
    print(f"Highest claimed slot: {highest or '(none)'} -- next free, for example: {next_slot(highest)}")
    print("Claim a number or a slot by ADDING its file (see the folder's README).")
    for e in errors:
        print(f"warning: {e}", file=sys.stderr)
    return 0


def write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def selftest() -> int:
    """A valid tree passes; each refusal the check promises is actually made."""
    def tree(root: str) -> None:
        write(f"{root}/{PD_DIR}/PD-40.md", "---\npd: PD-40\nkind: decision\nsubject: S\nstate: MERGED\n---\n")
        write(f"{root}/{PD_DIR}/PD-40-amendment-x.md", "---\npd: PD-40\nkind: amendment\nsubject: S\nstate: OPEN\n---\n")
        write(f"{root}/{SLOT_DIR}/20261101100000.md", "---\nslot: 20261101100000\npd: PD-40\nmigration: chat_pd040_x\n---\n")
        write(f"{root}/{MIGRATIONS}/20260101000000_chat_old.sql", "-- predates the registry\n")
        write(f"{root}/{MIGRATIONS}/20261101100000_chat_pd040_x.sql", "select 1;\n")

    cases = {
        "a valid tree": (lambda r: None, None),
        "a duplicate decision": (lambda r: write(f"{r}/{PD_DIR}/PD-040.md", "---\npd: PD-40\nkind: decision\nsubject: S\nstate: OPEN\n---\n"), "already claimed"),
        "a migration with no claim": (lambda r: write(f"{r}/{MIGRATIONS}/20261102100000_chat_y.sql", ""), "no claim"),
        "a duplicate migration timestamp": (lambda r: write(f"{r}/{MIGRATIONS}/20261101100000_chat_pd040_z.sql", ""), "is also"),
        "a migration whose name differs from its claim": (
            lambda r: (os.remove(f"{r}/{MIGRATIONS}/20261101100000_chat_pd040_x.sql"),
                       write(f"{r}/{MIGRATIONS}/20261101100000_chat_other.sql", "")), "says migration"),
        "a slot naming an unregistered PD": (lambda r: write(f"{r}/{SLOT_DIR}/20261103100000.md", "---\nslot: 20261103100000\npd: PD-41\n---\n"), "has no"),
        "a claim of PD-1..PD-21": (lambda r: write(f"{r}/{PD_DIR}/PD-7.md", "---\npd: PD-7\nkind: decision\nsubject: S\nstate: OPEN\n---\n"), "boundary doc"),
        "a file without front matter": (lambda r: write(f"{r}/{SLOT_DIR}/20261104100000.md", "slot: 20261104100000\n"), "no front matter"),
    }
    failed = 0
    for label, (mutate, expect) in cases.items():
        with tempfile.TemporaryDirectory() as root:
            tree(root)
            mutate(root)
            errors = check(root)
            ok = (not errors) if expect is None else any(expect in e for e in errors)
            print(f"{'ok  ' if ok else 'FAIL'} {label}" + ("" if ok else f": {errors or 'no error reported'}"))
            failed += 0 if ok else 1
    return 1 if failed else 0


def main(argv: list[str]) -> int:
    root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    command = argv[1] if len(argv) > 1 else "index"
    if command == "index":
        return index(root)
    if command == "check":
        errors = check(root)
        for e in errors:
            print(f"::error::{e}")
        if not errors:
            pds, slots, _ = load(root)
            print(f"registry pass: {len(pds)} PD claims, {len(slots)} migration slots, every migration since {REGISTRY_START} claimed")
        return 1 if errors else 0
    if command == "selftest":
        return selftest()
    print(__doc__.split("\n\n")[0], file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
