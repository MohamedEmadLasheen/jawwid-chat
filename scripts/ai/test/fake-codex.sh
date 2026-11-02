#!/usr/bin/env bash
# A stand-in for the Codex CLI, used only by scripts/ai/test/codex-task.test.sh.
# It accepts the same arguments the wrapper passes, performs the edit named in
# $FAKE_CODEX_PLAN/<attempt-number> (a shell snippet run in the -C directory),
# and writes a report to the -o file. No network, no model.
set -euo pipefail
dir="" out=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    -C|--cd) dir="${args[$((i + 1))]}" ;;
    -o|--output-last-message) out="${args[$((i + 1))]}" ;;
    --version) echo "codex-cli 0.0.0-fake"; exit 0 ;;
  esac
done
prompt="$(cat)"   # the prompt arrives on stdin, as with the real CLI
[ -n "$prompt" ] || { echo "No prompt provided via stdin." >&2; exit 1; }
printf '%s' "$prompt" | grep -q -- '---- TASK BRIEF ----' || { echo "fake codex: prompt lacks the brief" >&2; exit 1; }
counter="$FAKE_CODEX_PLAN/.count"
n=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$counter"
step="$FAKE_CODEX_PLAN/$n"
[ -f "$step" ] || { echo "fake codex: no plan for attempt $n" >&2; exit 1; }
( cd "$dir" && bash "$step" )
cat > "$out" <<JSON
{"task_completed": true, "summary": "fake attempt $n", "files_changed": [], "tests_executed": [], "outstanding_problems": []}
JSON
