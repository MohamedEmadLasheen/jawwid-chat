#!/usr/bin/env python3
"""PD-46 §3.1: chat.lesson is written only through LessonWriter.

Every lesson change must be announced in its own transaction
(apps/api/src/lessons/lesson-writer.ts). A Prisma `.lesson.create/update/...`
or a raw `UPDATE / INSERT INTO / DELETE FROM chat.lesson` (quoted or not)
anywhere else in apps/api/src is refused, unless the three lines above it carry
the marker `lesson-writer: announced` AND the same file calls
`writer.announce(` after it (a raw statement whose returned ids the caller
announces itself).

Matched over the WHOLE file with free whitespace, so a call split over lines
(`tx.lesson\\n  .update(`, `UPDATE\\n chat.lesson`) is caught too.

The SQL writers (materialize_lessons, transfer_learner) live in migrations; the
database notes their changes and the sweep announces them. Not scanned.

  check-lesson-writer.py check      scan apps/api/src (exit 1 on a finding)
  check-lesson-writer.py selftest   prove the patterns catch and pass what they must
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "apps" / "api" / "src"
WRITER = SRC / "lessons" / "lesson-writer.ts"
MARKER = "lesson-writer: announced"

PRISMA = re.compile(r"\.\s*lesson\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\s*\(")
# chat.lesson exactly -- also "chat"."lesson" -- never chat.lesson_report, chat.lesson_ruling, ...
TABLE = r'(?:chat\s*\.\s*lesson|"chat"\s*\.\s*"lesson")(?![\w"])'
RAW = re.compile(r"\b(?:update|insert\s+into|delete\s+from)\s+" + TABLE, re.IGNORECASE)
ANNOUNCE = re.compile(r"writer\s*\.\s*announce\s*\(")


def findings(text: str):
    lines = text.splitlines()
    for rx in (PRISMA, RAW):
        for m in rx.finditer(text):
            line_no = text.count("\n", 0, m.start()) + 1
            above = lines[max(0, line_no - 4):line_no]
            if any(MARKER in l for l in above) and ANNOUNCE.search(text, m.end()):
                continue
            yield line_no, " ".join(m.group(0).split())


def check() -> int:
    bad = 0
    for path in sorted(SRC.rglob("*.ts")):
        if path == WRITER:
            continue
        for n, found in findings(path.read_text(encoding="utf-8")):
            print(f"::error file={path.relative_to(ROOT)},line={n}::chat.lesson written outside LessonWriter: {found}")
            bad += 1
    if bad:
        print(f"lesson-writer FAIL: {bad} write(s) of chat.lesson outside LessonWriter (PD-46 §3.1)")
        return 1
    print("lesson-writer pass: every chat.lesson write goes through LessonWriter")
    return 0


def selftest() -> int:
    caught = [
        "await tx.lesson.update({ where: { id } });",
        "await this.prisma.lesson.updateMany({",
        "const created = await tx.lesson.create({",
        "await db.lesson.upsert({",
        "await tx.lesson\n      .update({ where: { id } });",
        "        UPDATE chat.lesson",
        "        UPDATE\n          chat.lesson SET outcome = 'x'",
        'UPDATE "chat"."lesson" SET outcome = $1',
        "insert into chat.lesson (id) values ($1)",
        "DELETE FROM chat.lesson WHERE id = $1",
        # A marker with no announce after it is not an exemption.
        "// lesson-writer: announced\n      const rows = await tx.$queryRaw`\n        UPDATE chat.lesson SET x = 1 RETURNING id`;",
    ]
    passed = [
        "await tx.lessonReport.update({",
        "await tx.lesson.findMany({",
        "UPDATE chat.lesson_report SET x = 1",
        'UPDATE "chat"."lesson_report" SET x = 1',
        "SELECT id FROM chat.lesson WHERE id = $1 FOR UPDATE",
        "// lesson-writer: announced\n      const rows = await tx.$queryRaw`\n        UPDATE chat.lesson SET x = 1 RETURNING id`;\n      await this.lessons.writer.announce(tx, 'paused', rows.map((r) => r.id));",
    ]
    ok = True
    for text in caught:
        if not list(findings(text)):
            print(f"selftest: NOT caught: {text!r}")
            ok = False
    for text in passed:
        if list(findings(text)):
            print(f"selftest: wrongly caught: {text!r}")
            ok = False
    print("lesson-writer selftest " + ("pass" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"
    sys.exit(selftest() if mode == "selftest" else check())
