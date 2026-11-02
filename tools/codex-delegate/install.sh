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
problems=0
OWNED='codex-delegate:owned-file'   # present in every file the installer may replace or delete

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
  if [ -L "$2" ]; then
    cat "$1" > "$2"   # a symlinked file (e.g. a dotfiles repo) is written through, never replaced
  else
    cp "$1" "$2.tmp.$$"; chmod "$3" "$2.tmp.$$"; mv "$2.tmp.$$" "$2"
  fi
  say "updated: $2"
}
# A shared instruction file is edited only when its markers are intact: none, or
# exactly one begin line followed later by exactly one end line. Anything else
# (a lone marker, duplicates) is left untouched and reported, never "repaired".
markers_ok() { # $1 = file
  [ -f "$1" ] || return 0
  local b e; b="$(grep -cxF "$BEGIN" "$1" || true)"; e="$(grep -cxF "$END" "$1" || true)"
  [ "$b" = 0 ] && [ "$e" = 0 ] && return 0
  [ "$b" = 1 ] && [ "$e" = 1 ] || return 1
  [ "$(grep -nxF "$BEGIN" "$1" | cut -d: -f1)" -lt "$(grep -nxF "$END" "$1" | cut -d: -f1)" ]
}
# Replace (or append) the managed block in a shared instruction file.
put_block() { # $1 = block source, $2 = target
  if ! markers_ok "$2"; then
    say "SKIPPED (markers damaged; fix or remove the codex-delegate lines by hand, then re-run): $2"
    problems=$((problems + 1)); return 0
  fi
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
  markers_ok "$1" || { say "SKIPPED (markers damaged): $1"; problems=$((problems + 1)); return 0; }
  changes=$((changes + 1))
  if [ "$MODE" = --check ]; then say "would remove block from: $1"; return 0; fi
  backup "$1"
  local stripped; stripped="$(awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$1")"
  if [ -L "$1" ]; then
    printf '%s\n' "$stripped" > "$1"   # write through a symlinked file; never replace the link
  else
    printf '%s\n' "$stripped" > "$1.tmp.$$" && mv "$1.tmp.$$" "$1"
  fi
  say "removed managed block: $1"
}
# A whole file the installer owns. An existing file without our marker belongs to
# someone else: it is never replaced (or, on uninstall, deleted).
# Ours = carries the marker, or is the pre-marker 2.0.0 skill (frontmatter name
# ai-delegation and written for codex-delegate), or is the engine itself.
is_ours() { # $1 = file
  grep -q "$OWNED" "$1" && return 0
  grep -qx 'name: ai-delegation' "$1" && grep -q 'codex-delegate' "$1" && return 0
  head -3 "$1" | grep -q '^# codex-delegate' && return 0
  return 1
}
put_owned() { # $1 = source, $2 = target
  if [ -f "$2" ] && ! is_ours "$2"; then
    say "SKIPPED (not ours; rename or remove it to install): $2"; problems=$((problems + 1)); return 0
  fi
  put_file "$1" "$2" 644
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
    put_owned "$SRC/global/claude-skill/SKILL.md" "$CLAUDE_HOME/skills/ai-delegation/SKILL.md"
    put_owned "$SRC/global/agents-skill/SKILL.md" "$AGENTS_SKILLS/ai-delegation/SKILL.md"
    if [ "$MODE" = install ]; then
      mkdir -p "$AI_HOME/engine" "$AI_HOME/runs"
      src_rev="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"
      printf 'version=%s\nsource=%s\nsource_commit=%s\ninstalled_at=%s\n' \
        "$("$BIN_DIR/codex-delegate" --version | awk '{print $2}')" "$SRC" "$src_rev" "$STAMP" > "$AI_HOME/engine/INSTALLED"
      case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "note: $BIN_DIR is not on PATH; call $BIN_DIR/codex-delegate directly" ;; esac
      [ -d "$BACKUP" ] && say "backups: $BACKUP"
      say "codex-delegate installed ($changes change(s), $problems skipped). Next: codex-delegate doctor"
      [ "$problems" = 0 ] || exit 1
    else
      say "$changes change(s) pending"
    fi
    ;;
  --uninstall)
    for f in "$BIN_DIR/codex-delegate" "$CLAUDE_HOME/skills/ai-delegation/SKILL.md" "$AGENTS_SKILLS/ai-delegation/SKILL.md"; do
      [ -f "$f" ] || continue
      is_ours "$f" || { say "SKIPPED (not ours): $f"; continue; }
      backup "$f"; rm -f "$f"; rmdir "$(dirname "$f")" 2>/dev/null || true; say "removed: $f"
    done
    remove_block "$CLAUDE_HOME/CLAUDE.md"
    remove_block "$CODEX_HOME_DIR/AGENTS.md"
    if [ -d "$AI_HOME/engine" ]; then
      mkdir -p "$BACKUP"; mv "$AI_HOME/engine" "$BACKUP/engine"; say "moved engine files to $BACKUP/engine"
    fi
    say "uninstalled. Kept: $AI_HOME/runs, $AI_HOME/protected-repos.conf, backups."
    ;;
  *) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
