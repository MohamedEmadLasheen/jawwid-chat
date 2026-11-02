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
check "re-install is a no-op" 'grep -q "(0 change(s), 0 skipped)" "$H/install2.log" && [ "$before" = "$(shasum "$H/.claude/CLAUDE.md" "$H/.codex/AGENTS.md" "$H/.jawwid-ai/protected-repos.conf")" ]'
check "exactly one managed block" '[ "$(grep -c "codex-delegate:begin" "$H/.claude/CLAUDE.md")" = 1 ]'
bash "$INSTALL" --uninstall > "$H/uninstall.log"
check "uninstall removes engine and skills" '[ ! -e "$H/bin/codex-delegate" ] && [ ! -e "$H/.claude/skills/ai-delegation" ]'
check "uninstall leaves the user text only" '[ "$(cat "$H/.claude/CLAUDE.md")" = "$(printf "# My own rules\nAlways answer in Arabic.")" ] && [ "$(cat "$H/.codex/AGENTS.md")" = "my codex note" ]'
check "uninstall keeps protected-repos.conf" 'grep -q "my/secret/repo" "$H/.jawwid-ai/protected-repos.conf"'

# Damaged markers and files that are not ours are never touched.
H2="$H/second"; mkdir -p "$H2/.claude/skills/ai-delegation" "$H2/.codex"
printf 'keep me\n<!-- codex-delegate:begin (managed by tools/codex-delegate/install.sh; edit the source, not this block) -->\nmy precious tail\n' > "$H2/.claude/CLAUDE.md"
printf -- '---\nname: ai-delegation\ndescription: my own skill\n---\nmine\n' > "$H2/.claude/skills/ai-delegation/SKILL.md"
before2="$(shasum "$H2/.claude/CLAUDE.md" "$H2/.claude/skills/ai-delegation/SKILL.md")"
rc=0; JAWWID_AI_HOME="$H2/.jawwid-ai" CODEX_DELEGATE_BIN_DIR="$H2/bin" CLAUDE_CONFIG_HOME="$H2/.claude" CODEX_HOME="$H2/.codex" AGENTS_SKILLS_HOME="$H2/.agents/skills" bash "$INSTALL" > "$H2/log" 2>&1 || rc=$?
check "lone marker: file left untouched, reported" '[ "$before2" = "$(shasum "$H2/.claude/CLAUDE.md" "$H2/.claude/skills/ai-delegation/SKILL.md")" ] && grep -q "markers damaged" "$H2/log"'
check "foreign skill file: not replaced, reported, exit 1" 'grep -q "not ours" "$H2/log" && [ "$rc" = 1 ]'
JAWWID_AI_HOME="$H2/.jawwid-ai" CODEX_DELEGATE_BIN_DIR="$H2/bin" CLAUDE_CONFIG_HOME="$H2/.claude" CODEX_HOME="$H2/.codex" AGENTS_SKILLS_HOME="$H2/.agents/skills" bash "$INSTALL" --uninstall > "$H2/ulog" 2>&1 || true
check "uninstall leaves foreign skill alone" 'grep -q "^mine$" "$H2/.claude/skills/ai-delegation/SKILL.md"'
H3="$H/third"; mkdir -p "$H3/dotfiles" "$H3/.claude"; printf 'mine\n' > "$H3/dotfiles/CLAUDE.md"; ln -s "$H3/dotfiles/CLAUDE.md" "$H3/.claude/CLAUDE.md"
JAWWID_AI_HOME="$H3/.jawwid-ai" CODEX_DELEGATE_BIN_DIR="$H3/bin" CLAUDE_CONFIG_HOME="$H3/.claude" CODEX_HOME="$H3/.codex" AGENTS_SKILLS_HOME="$H3/.agents/skills" bash "$INSTALL" > "$H3/log" 2>&1
check "symlinked CLAUDE.md written through, link kept" '[ -L "$H3/.claude/CLAUDE.md" ] && grep -q "codex-delegate:begin" "$H3/dotfiles/CLAUDE.md" && head -1 "$H3/dotfiles/CLAUDE.md" | grep -qx mine'
H4="$H/fourth"; mkdir -p "$H4/bin" "$H4/dotfiles" "$H4/.claude"; printf '#!/bin/sh\necho someone else\n' > "$H4/bin/codex-delegate"; chmod +x "$H4/bin/codex-delegate"
printf 'mine\n' > "$H4/dotfiles/CLAUDE.md"; ln -s "$H4/dotfiles/CLAUDE.md" "$H4/.claude/CLAUDE.md"
E4="JAWWID_AI_HOME=$H4/.jawwid-ai CODEX_DELEGATE_BIN_DIR=$H4/bin CLAUDE_CONFIG_HOME=$H4/.claude CODEX_HOME=$H4/.codex AGENTS_SKILLS_HOME=$H4/.agents/skills"
env JAWWID_AI_HOME="$H4/.jawwid-ai" CODEX_DELEGATE_BIN_DIR="$H4/bin2" CLAUDE_CONFIG_HOME="$H4/.claude" CODEX_HOME="$H4/.codex" AGENTS_SKILLS_HOME="$H4/.agents/skills" bash "$INSTALL" > /dev/null 2>&1 || true
env JAWWID_AI_HOME="$H4/.jawwid-ai" CODEX_DELEGATE_BIN_DIR="$H4/bin" CLAUDE_CONFIG_HOME="$H4/.claude" CODEX_HOME="$H4/.codex" AGENTS_SKILLS_HOME="$H4/.agents/skills" bash "$INSTALL" --uninstall > "$H4/ulog" 2>&1 || true
check "uninstall never deletes a foreign codex-delegate binary" 'grep -q "someone else" "$H4/bin/codex-delegate"'
check "uninstall writes through a symlinked CLAUDE.md" '[ -L "$H4/.claude/CLAUDE.md" ] && ! grep -q "codex-delegate:begin" "$H4/dotfiles/CLAUDE.md" && grep -qx mine "$H4/dotfiles/CLAUDE.md"'
H5="$H/fifth"; mkdir -p "$H5/bin"; printf '#!/bin/sh\necho not the engine\n' > "$H5/bin/codex-delegate"; chmod +x "$H5/bin/codex-delegate"
rc5=0; env JAWWID_AI_HOME="$H5/.jawwid-ai" CODEX_DELEGATE_BIN_DIR="$H5/bin" CLAUDE_CONFIG_HOME="$H5/.claude" CODEX_HOME="$H5/.codex" AGENTS_SKILLS_HOME="$H5/.agents/skills" bash "$INSTALL" > "$H5/log" 2>&1 || rc5=$?
check "install never overwrites a foreign codex-delegate binary" 'grep -q "not the engine" "$H5/bin/codex-delegate" && grep -q "not ours" "$H5/log" && [ "$rc5" = 1 ]'
echo; echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
