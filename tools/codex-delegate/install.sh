#!/usr/bin/env bash
# Install, update, check or remove the user-level codex-delegate system.
#
#   bash tools/codex-delegate/install.sh            install or update (idempotent)
#   bash tools/codex-delegate/install.sh --check    show what would change; change nothing
#   bash tools/codex-delegate/install.sh --uninstall
#
# What it manages (and nothing else):
#   ~/.local/bin/codex-delegate                     the engine
#   ~/.jawwid-ai/engine/                            templates, version, manifest
#   ~/.jawwid-ai/protected-repos.conf               created if missing; missing default rules appended;
#                                                   never overwritten, never shortened
#   ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md         a MARKED BLOCK only; text outside it is never touched
#   ~/.claude/skills/ai-delegation/SKILL.md         the Claude skill
#   ~/.agents/skills/ai-delegation/SKILL.md         the Codex skill
# Every file it changes is first copied to ~/.jawwid-ai/backups/<timestamp>/.
# It never touches Codex or Claude authentication, billing, models or config.toml.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_HOME="${JAWWID_AI_HOME:-$HOME/.jawwid-ai}"
BIN_DIR="${CODEX_DELEGATE_BIN_DIR:-$HOME/.local/bin}"
CLAUDE_HOME="${CLAUDE_CONFIG_HOME:-$HOME/.claude}"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
AGENTS_SKILLS="${AGENTS_SKILLS_HOME:-$HOME/.agents/skills}"
BEGIN='<!-- codex-delegate:begin (managed by tools/codex-delegate/install.sh; edit the source, not this block) -->'
END='<!-- codex-delegate:end -->'
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$AI_HOME/backups/$STAMP"
MODE="${1:-install}"
changes=0

say() { printf '%s\n' "$*"; }
backup() { # $1 = existing file
  [ -e "$1" ] || return 0
  mkdir -p "$BACKUP$(dirname "$1")"
  cp -p "$1" "$BACKUP$1"
}
put_file() { # $1 = source, $2 = target, $3 = mode
  if [ -f "$2" ] && cmp -s "$1" "$2"; then return 0; fi
  changes=$((changes + 1))
  if [ "$MODE" = --check ]; then say "would update: $2"; return 0; fi
  backup "$2"; mkdir -p "$(dirname "$2")"
  cp "$1" "$2.tmp.$$"; chmod "$3" "$2.tmp.$$"; mv "$2.tmp.$$" "$2"
  say "updated: $2"
}
# Replace (or append) the managed block in a shared instruction file.
put_block() { # $1 = block source, $2 = target
  local tmp; tmp="$(mktemp "${TMPDIR:-/tmp}/cd-block.XXXXXX")"
  {
    if [ -f "$2" ]; then
      # The owner's own text, without our block and without trailing blank lines,
      # then exactly one blank line before the block.
      local rest
      rest="$(awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$2")"
      if [ -n "$(printf '%s' "$rest" | tr -d '[:space:]')" ]; then printf '%s\n\n' "$rest"; fi
    fi
    echo "$BEGIN"; grep -v '^<!-- codex-delegate: installed' "$1"; echo "$END"
  } > "$tmp"
  put_file "$tmp" "$2" 644; rm -f "$tmp"
}
remove_block() { # $1 = target
  [ -f "$1" ] && grep -qxF "$BEGIN" "$1" || return 0
  changes=$((changes + 1))
  if [ "$MODE" = --check ]; then say "would remove block from: $1"; return 0; fi
  backup "$1"
  awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$1" > "$1.tmp.$$" && mv "$1.tmp.$$" "$1"
  say "removed managed block: $1"
}
merge_protected() { # create if missing; append default rules that are absent; never remove
  local target="$AI_HOME/protected-repos.conf" src="$SRC/global/protected-repos.conf" line missing=""
  if [ ! -f "$target" ]; then put_file "$src" "$target" 644; return; fi
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    grep -qxF -- "$line" "$target" || missing="$missing$line"$'\n'
  done < "$src"
  [ -z "$missing" ] && return 0
  changes=$((changes + 1))
  if [ "$MODE" = --check ]; then say "would add protected-repo rules to $target"; return 0; fi
  backup "$target"; printf '%s' "$missing" >> "$target"; say "added protected-repo rules: $target"
}

case "$MODE" in
  install|--install|--check)
    [ "$MODE" = --install ] && MODE=install
    command -v git >/dev/null || { say "git is required"; exit 1; }
    [ -x /usr/bin/python3 ] || { say "/usr/bin/python3 is required"; exit 1; }
    put_file "$SRC/codex-delegate" "$BIN_DIR/codex-delegate" 755
    for t in "$SRC"/templates/*; do put_file "$t" "$AI_HOME/engine/templates/$(basename "$t")" 644; done
    merge_protected
    put_block "$SRC/global/CLAUDE.md" "$CLAUDE_HOME/CLAUDE.md"
    put_block "$SRC/global/codex-AGENTS.md" "$CODEX_HOME_DIR/AGENTS.md"
    put_file "$SRC/global/claude-skill/SKILL.md" "$CLAUDE_HOME/skills/ai-delegation/SKILL.md" 644
    put_file "$SRC/global/agents-skill/SKILL.md" "$AGENTS_SKILLS/ai-delegation/SKILL.md" 644
    if [ "$MODE" = install ]; then
      mkdir -p "$AI_HOME/engine" "$AI_HOME/runs"
      src_rev="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"
      printf 'version=%s\nsource=%s\nsource_commit=%s\ninstalled_at=%s\n' \
        "$("$BIN_DIR/codex-delegate" --version | awk '{print $2}')" "$SRC" "$src_rev" "$STAMP" > "$AI_HOME/engine/INSTALLED"
      case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "note: $BIN_DIR is not on PATH; call $BIN_DIR/codex-delegate directly" ;; esac
      [ -d "$BACKUP" ] && say "backups: $BACKUP"
      say "codex-delegate installed ($changes change(s)). Next: codex-delegate doctor"
    else
      say "$changes change(s) pending"
    fi
    ;;
  --uninstall)
    for f in "$BIN_DIR/codex-delegate" "$CLAUDE_HOME/skills/ai-delegation/SKILL.md" "$AGENTS_SKILLS/ai-delegation/SKILL.md"; do
      [ -f "$f" ] || continue
      backup "$f"; rm -f "$f"; rmdir "$(dirname "$f")" 2>/dev/null || true; say "removed: $f"
    done
    rm -f "$BIN_DIR/codex-delegate" 2>/dev/null || true
    remove_block "$CLAUDE_HOME/CLAUDE.md"
    remove_block "$CODEX_HOME_DIR/AGENTS.md"
    if [ -d "$AI_HOME/engine" ]; then
      mkdir -p "$BACKUP"; mv "$AI_HOME/engine" "$BACKUP/engine"; say "moved engine files to $BACKUP/engine"
    fi
    say "uninstalled. Kept: $AI_HOME/runs, $AI_HOME/protected-repos.conf, backups."
    ;;
  *) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
