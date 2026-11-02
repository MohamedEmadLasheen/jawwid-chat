#!/usr/bin/env bash
# A stand-in for the Codex CLI, used only by test/codex-delegate.test.sh.
#  - `codex --version`                 prints a fake version
#  - `codex sandbox ... -- CMD...`      runs CMD (the real CLI would sandbox it)
#  - `codex ... exec ... -s read-only`  writes a canned review to the -o file
#  - `codex ... exec ...`               runs the shell snippet $FAKE_CODEX_PLAN/<n> in the -C dir
#                                       (n counts implementation calls) and writes a report
# No network, no model.
set -euo pipefail
args=("$@")
for a in "${args[@]}"; do [ "$a" = --version ] && { echo "codex-cli 0.0.0-fake"; exit 0; }; done
if [ "${args[0]:-}" = sandbox ]; then
  for ((i = 0; i < ${#args[@]}; i++)); do
    if [ "${args[$i]}" = -- ]; then exec "${args[@]:$((i + 1))}"; fi
  done
  echo "fake codex: sandbox without --" >&2; exit 2
fi
dir="" out="" ro=0
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    -C|--cd) dir="${args[$((i + 1))]}" ;;
    -o|--output-last-message) out="${args[$((i + 1))]}" ;;
    read-only) ro=1 ;;
  esac
done
prompt="$(cat)"   # the prompt arrives on stdin, as with the real CLI
[ -n "$prompt" ] || { echo "No prompt provided via stdin." >&2; exit 1; }
if [ "$ro" = 1 ]; then
  printf '%s' "$prompt" > "${FAKE_REVIEW_PROMPT:-/dev/null}"
  echo '{"verdict":"merge","findings":[],"coverage_notes":"fake review"}' > "$out"
  exit 0
fi
printf '%s' "$prompt" | grep -q -- '---- TASK BRIEF ----' || { echo "fake codex: prompt lacks the brief" >&2; exit 1; }
counter="$FAKE_CODEX_PLAN/.count"
n=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$counter"
step="$FAKE_CODEX_PLAN/$n"
[ -f "$step" ] || { echo "fake codex: no plan for attempt $n" >&2; exit 1; }
( cd "$dir" && bash "$step" )
[ -f "$FAKE_CODEX_PLAN/$n.stderr" ] && { cat "$FAKE_CODEX_PLAN/$n.stderr" >&2; exit 1; }
cat > "$out" <<JSON
{"task_completed": true, "summary": "fake attempt $n", "files_changed": [], "tests_executed": [], "outstanding_problems": []}
JSON
