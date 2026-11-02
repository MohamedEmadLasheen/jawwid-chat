#!/usr/bin/env python3
"""PD-46 §3.1: chat.lesson is written only through LessonWriter.

Every lesson change must be announced in its own transaction
(apps/api/src/lessons/lesson-writer.ts). A Prisma `.lesson.create/update/...`
or a raw `UPDATE / INSERT INTO / DELETE FROM chat.lesson` anywhere else in
apps/api/src is refused, unless one of the three lines above it carries the
marker `lesson-writer: announced` (a raw statement whose returned ids the
caller hands to `writer.announce` itself).

The SQL writers (materialize_lessons, transfer_learner) live in migrations and
reach the safety net; they are not scanned.

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

PRISMA = re.compile(r"\.lesson\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\(")
# chat.lesson exactly: not chat.lesson_report, chat.lesson_ruling, ...
RAW = re.compile(r"\b(update|insert\s+into|delete\s+from)\s+chat\.lesson\b(?!_)", re.IGNORECASE)


def findings(text: str):
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if PRISMA.search(line) or RAW.search(line):
            if any(MARKER in prev for prev in lines[max(0, i - 3):i + 1]):
                continue
            yield i + 1, line.strip()


def check() -> int:
    bad = 0
    for path in sorted(SRC.rglob("*.ts")):
        if path == WRITER:
            continue
        for n, line in findings(path.read_text(encoding="utf-8")):
            print(f"::error file={path.relative_to(ROOT)},line={n}::chat.lesson written outside LessonWriter: {line}")
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
        "        UPDATE chat.lesson",
        "insert into chat.lesson (id) values ($1)",
        "DELETE FROM chat.lesson WHERE id = $1",
    ]
    passed = [
        "await tx.lessonReport.update({",
        "await tx.lesson.findMany({",
        "UPDATE chat.lesson_report SET x = 1",
        "SELECT id FROM chat.lesson WHERE id = $1 FOR UPDATE",
        "// lesson-writer: announced\n      const rows = await tx.$queryRaw`\n        UPDATE chat.lesson",
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
