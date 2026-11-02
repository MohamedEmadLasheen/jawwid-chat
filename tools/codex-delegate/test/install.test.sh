#!/usr/bin/env bash
# Self-test for install.sh, entirely inside a throwaway home directory.
#   bash tools/codex-delegate/test/install.test.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="$HERE/../install.sh"
H="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/cd-install-test.XXXXXX")" && pwd -P)"
trap 'rm -rf "$H"' EXIT
export JAWWID_AI_HOME="$H/.jawwid-ai" CODEX_DELEGATE_BIN_DIR="$H/bin" CLAUDE_CONFIG_HOME="$H/.claude" CODEX_HOME="$H/.codex" AGENTS_SKILLS_HOME="$H/.agents/skills"
pass=0 fail=0
check() { if eval "$2"; then echo "  ok   $1"; pass=$((pass + 1)); else echo "  FAIL $1"; fail=$((fail + 1)); fi; }

mkdir -p "$H/.claude" "$H/.codex" "$H/.jawwid-ai"
printf '# My own rules\nAlways answer in Arabic.\n' > "$H/.claude/CLAUDE.md"
printf 'my codex note\n' > "$H/.codex/AGENTS.md"
printf '# mine\n^/my/secret/repo(/|$)\n' > "$H/.jawwid-ai/protected-repos.conf"

out="$(bash "$INSTALL" --check)"
check "--check changes nothing" '[ ! -e "$H/bin/codex-delegate" ] && printf "%s" "$out" | grep -q "would update"'
bash "$INSTALL" > "$H/install1.log"
check "engine installed, executable" '[ -x "$H/bin/codex-delegate" ] && "$H/bin/codex-delegate" --version | grep -q "codex-delegate"'
check "templates installed" '[ -f "$H/.jawwid-ai/engine/templates/result.schema.json" ]'
check "user text in CLAUDE.md kept, block appended" 'head -2 "$H/.claude/CLAUDE.md" | grep -q "Always answer in Arabic" && grep -q "codex-delegate:begin" "$H/.claude/CLAUDE.md"'
check "user text in Codex AGENTS.md kept" 'head -1 "$H/.codex/AGENTS.md" | grep -qx "my codex note" && grep -q "codex-delegate:end" "$H/.codex/AGENTS.md"'
check "both skills installed" '[ -f "$H/.claude/skills/ai-delegation/SKILL.md" ] && [ -f "$H/.agents/skills/ai-delegation/SKILL.md" ]'
check "custom protected rule kept, defaults added" 'grep -q "my/secret/repo" "$H/.jawwid-ai/protected-repos.conf" && grep -q "MohamedEmadLasheen/jawwid" "$H/.jawwid-ai/protected-repos.conf"'
check "backups taken of changed files" 'ls "$H"/.jawwid-ai/backups/*"$H"/.claude/CLAUDE.md >/dev/null 2>&1'
before="$(shasum "$H/.claude/CLAUDE.md" "$H/.codex/AGENTS.md" "$H/.jawwid-ai/protected-repos.conf")"
bash "$INSTALL" > "$H/install2.log"
check "re-install is a no-op" 'grep -q "(0 change(s))" "$H/install2.log" && [ "$before" = "$(shasum "$H/.claude/CLAUDE.md" "$H/.codex/AGENTS.md" "$H/.jawwid-ai/protected-repos.conf")" ]'
check "exactly one managed block" '[ "$(grep -c "codex-delegate:begin" "$H/.claude/CLAUDE.md")" = 1 ]'
bash "$INSTALL" --uninstall > "$H/uninstall.log"
check "uninstall removes engine and skills" '[ ! -e "$H/bin/codex-delegate" ] && [ ! -e "$H/.claude/skills/ai-delegation" ]'
check "uninstall leaves the user text only" '[ "$(cat "$H/.claude/CLAUDE.md")" = "$(printf "# My own rules\nAlways answer in Arabic.")" ] && [ "$(cat "$H/.codex/AGENTS.md")" = "my codex note" ]'
check "uninstall keeps protected-repos.conf" 'grep -q "my/secret/repo" "$H/.jawwid-ai/protected-repos.conf"'
echo; echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
