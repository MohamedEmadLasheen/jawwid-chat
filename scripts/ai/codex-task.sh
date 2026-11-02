#!/usr/bin/env bash
# Jawwid Chat -- delegate a bounded task, or an independent review, to the Codex CLI.
#
# The lead (Claude) calls this; the owner never has to. Each task gets its own
# Git worktree and branch, Codex runs sandboxed inside it, and THIS script --
# not Codex -- verifies scope, scans for secrets, re-runs the tests and commits.
# Results land as JSON in the run directory, so the lead reads one file.
#
#   run      create the worktree, run Codex, verify, commit; auto-retries on failure
#   retry    send review feedback to the same worktree (counts toward the attempt limit)
#   review   read-only Codex review of a diff between two commits of a clean checkout
#   status   print a task's result.json
#   list     list task runs
#   cleanup  remove a task's worktree (only if clean); the run directory is kept
#
# Written for macOS /bin/bash 3.2: no associative arrays, no mapfile.
# See docs/engineering/ai-delegation.md for the workflow and routing rules.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES="$SCRIPT_DIR/templates"
REPO="${JAWWID_AI_REPO:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)}"   # override only for the self-test
CODEX="${CODEX_BIN:-$HOME/.local/bin/codex}"
AI_HOME="${JAWWID_AI_HOME:-$HOME/.jawwid-ai}"
RUNS="$AI_HOME/runs"
WORKTREES="${JAWWID_AI_WORKTREES:-$HOME/jawwid-ai-worktrees}"
MAX_ATTEMPTS_DEFAULT=3
CODEX_TIMEOUT_DEFAULT=1800   # seconds per Codex attempt
TEST_TIMEOUT_DEFAULT=1800    # seconds per verification command
LOAD_MAX="${JAWWID_LOAD_MAX:-60}"   # the machine-load rule: wait while the 1-min load is above this
LOAD_WAIT_MAX=1200           # give up waiting for load after 20 minutes
PY=/usr/bin/python3          # Apple's python3 has working CA certs and no user site-packages under -I

die() { echo "codex-task: $*" >&2; exit 2; }
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "${LOGFILE:-/dev/null}" >&2; }

usage() { sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

valid_id() { [[ "$1" =~ ^[a-z0-9][a-z0-9-]{1,48}$ ]] || die "task id must be lowercase letters, digits and dashes (2-49 chars): $1"; }

# ---- small helpers ---------------------------------------------------------

load1() { sysctl -n vm.loadavg 2>/dev/null | awk '{print int($2)}'; }

wait_for_load() {
  local waited=0
  while [ "$(load1)" -gt "$LOAD_MAX" ]; do
    [ "$waited" -ge "$LOAD_WAIT_MAX" ] && return 1
    [ "$waited" -eq 0 ] && log "load $(load1) > $LOAD_MAX: waiting (machine-load rule)"
    sleep 30; waited=$((waited + 30))
  done
  return 0
}

# Run "$@" with a time limit; stdin/stdout/stderr are whatever the caller redirected.
run_with_timeout() {
  local secs="$1"; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null ) & local watchdog=$!
  local rc=0; wait "$pid" || rc=$?
  kill "$watchdog" 2>/dev/null || true; wait "$watchdog" 2>/dev/null || true
  return "$rc"
}

json_get() { "$PY" -I -c 'import json,sys; d=json.load(open(sys.argv[1])); v=d
for k in sys.argv[2].split("."): v=v.get(k) if isinstance(v,dict) else None
print("" if v is None else (json.dumps(v) if isinstance(v,(dict,list,bool)) else v))' "$1" "$2"; }

# Repeated keys (allow, tests) return every value, one per line; others return the last value.
state_get() { [ -f "$RUN/state" ] && sed -n "s/^$1=//p" "$RUN/state" | awk -v k="$1" 'k=="allow"||k=="tests"{print;next}{v=$0}END{if(!(k=="allow"||k=="tests"))print v}'; }
state_set() { echo "$1=$2" >> "$RUN/state"; }

acquire_lock() {
  mkdir "$RUN/lock" 2>/dev/null || die "task $TASK is already being worked on (lock $RUN/lock). One agent per worktree."
  echo "$$" > "$RUN/lock/pid"
  trap 'rm -rf "$RUN/lock"' EXIT
}

# Paths no delegated agent may change, whatever the brief says: CI and
# protection config, the Code Owner paths (Quran and lesson content),
# secrets, this delegation system, and the shared instruction files.
protected_patterns() {
  printf '%s\n' '.github/*' 'scripts/ai/*' 'AGENTS.md' 'CLAUDE.md' '.claude/*' \
    '*.env' '.env' '.env.*' '*.pem' '*.key' '*.p12' '*.mobileprovision'
  [ -f "$WT/.github/CODEOWNERS" ] && awk '!/^#/ && NF {print $1}' "$WT/.github/CODEOWNERS" \
    | sed -e 's#^/##' -e 's#/$#/*#'
}

matches_any() { # $1 = path; remaining = glob patterns
  local f="$1"; shift; local g
  for g in "$@"; do
    # shellcheck disable=SC2254
    case "$f" in $g) return 0 ;; esac
  done
  return 1
}

changed_files() { # tracked changes and untracked files in the worktree, one per line
  git -C "$WT" status --porcelain --untracked-files=all | sed -E 's/^.{3}//; s/.* -> //'
}

# Added lines that look like credentials. Prints matches with the value masked.
secret_scan() { # $1 = unified diff file
  grep -nE '^\+' "$1" | grep -E \
    '(sk_(live|test)_[A-Za-z0-9]{8,}|pk_live_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[abpr]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.|(api[_-]?key|secret|password|passwd|token)["'"'"' ]*[:=][ ]*["'"'"'][^"'"'"']{8,}["'"'"'])' \
    | sed -E 's/(["'"'"'])[^"'"'"']{8,}(["'"'"'])/\1<redacted>\2/g; s/(sk_|pk_|AKIA|xox.-|gh.)_?[A-Za-z0-9_-]{6,}/\1<redacted>/g' || true
}

codex_version() { "$CODEX" --version 2>/dev/null | awk '{print $NF}'; }

# ---- run / retry -------------------------------------------------------------

compose_prompt() { # $1 = out file, $2 = optional feedback file
  local allowed; allowed="$(state_get allow | tr '\n' ' ')"
  sed "s#{{ALLOWED}}#${allowed:-the paths named in the brief}#" "$TEMPLATES/implementer-preamble.md" > "$1"
  { echo; echo "---- TASK BRIEF ----"; cat "$RUN/brief.md"; } >> "$1"
  if [ -n "${2:-}" ] && [ -s "$2" ]; then
    { echo; echo "---- FEEDBACK FROM THE PREVIOUS ATTEMPT (fix these; do not undo accepted work) ----"; cat "$2"; } >> "$1"
  fi
}

one_attempt() { # $1 = feedback file (may be empty). Sets OUTCOME and writes $FEEDBACK_NEXT.
  local n; n=$(( $(state_get attempts || echo 0) + 1 )); state_set attempts "$n"
  ATT="$RUN/attempt-$n"; mkdir -p "$ATT" "$RUN/tmp"
  LOGFILE="$ATT/wrapper.log"
  FEEDBACK_NEXT="$ATT/feedback-for-next.md"; : > "$FEEDBACK_NEXT"
  compose_prompt "$ATT/prompt.md" "${1:-}"

  local model_args=(); local m; m="$(state_get model)"; [ -n "$m" ] && model_args=(-m "$m")
  log "attempt $n/$(state_get max): running codex $(codex_version) in $WT (workspace-write sandbox)"
  local rc=0
  # -a is a top-level flag in codex-cli 0.166 (not an `exec` flag). --ignore-user-config
  # keeps the owner's personal Codex plugins and notify hooks out of delegated runs;
  # auth still comes from CODEX_HOME. TMPDIR is redirected into the run dir and added
  # as writable so tools that need a temp file (git's xcrun shim) do not fail.
  TMPDIR="$RUN/tmp" run_with_timeout "$(state_get codex_timeout)" \
    "$CODEX" -a never exec -C "$WT" -s workspace-write --ignore-user-config \
      --add-dir "$RUN/tmp" --color never --json \
      --output-schema "$TEMPLATES/result.schema.json" -o "$ATT/report.json" \
      ${model_args[@]+"${model_args[@]}"} - \
      < "$ATT/prompt.md" > "$ATT/codex.jsonl" 2> "$ATT/codex.stderr" || rc=$?
  echo "$rc" > "$ATT/codex.exit"

  if [ "$rc" -ne 0 ] || ! "$PY" -I -c 'import json,sys; d=json.load(open(sys.argv[1])); assert isinstance(d.get("task_completed"),bool)' "$ATT/report.json" 2>/dev/null; then
    local tail; tail="$(tail -c 1500 "$ATT/codex.stderr" 2>/dev/null; tail -c 1500 "$ATT/codex.jsonl" 2>/dev/null)"
    if echo "$tail" | grep -qiE 'usage limit|rate limit|quota|not logged in|login|unauthori[sz]ed|401|403 Forbidden'; then
      log "codex cannot run (auth/usage limit); not retrying"
      OUTCOME=blocked; echo "Codex could not run: auth or usage limit. Exit $rc." > "$ATT/problem.txt"; return
    fi
    log "codex exit $rc or no valid report"
    { echo "- Your previous run ended without a valid JSON report (exit $rc). Finish the task and end with the JSON report."; } >> "$FEEDBACK_NEXT"
    OUTCOME=retry; return
  fi

  # 1. Scope: revert anything outside the allowed paths or inside a protected path.
  local allow_globs=() prot=() f bad=0
  while IFS= read -r f; do [ -n "$f" ] && allow_globs+=("$f"); done <<EOF
$(state_get allow)
EOF
  while IFS= read -r f; do [ -n "$f" ] && prot+=("$f"); done <<EOF
$(protected_patterns)
EOF
  [ "$(state_get allow_migrations)" = 1 ] || prot+=('supabase/migrations/*' 'apps/api/prisma/migrations/*')
  : > "$ATT/out-of-scope.txt"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if matches_any "$f" "${prot[@]}" || ! matches_any "$f" "${allow_globs[@]}"; then
      echo "$f" >> "$ATT/out-of-scope.txt"; bad=1
    fi
  done <<EOF
$(changed_files)
EOF
  if [ "$bad" = 1 ]; then
    git -C "$WT" diff -- $(cat "$ATT/out-of-scope.txt") > "$ATT/out-of-scope.patch" 2>/dev/null || true
    while IFS= read -r f; do
      if git -C "$WT" ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
        git -C "$WT" checkout -- "$f"
      else
        rm -f -- "$WT/$f"
      fi
    done < "$ATT/out-of-scope.txt"
    log "reverted out-of-scope changes: $(tr '\n' ' ' < "$ATT/out-of-scope.txt")"
    { echo "- These paths are outside your allowed scope or protected, and were reverted: $(tr '\n' ' ' < "$ATT/out-of-scope.txt"). Achieve the goal without them, or report why that is impossible."; } >> "$FEEDBACK_NEXT"
  fi

  if [ -z "$(changed_files)" ]; then
    log "no in-scope changes"
    [ "$(json_get "$ATT/report.json" task_completed)" = "true" ] && echo "- You reported completion but no in-scope file changed." >> "$FEEDBACK_NEXT"
    OUTCOME=retry; return
  fi

  # 2. Secrets: never commit a credential.
  git -C "$WT" add -A
  git -C "$WT" diff --cached > "$ATT/candidate.patch"
  git -C "$WT" reset -q
  secret_scan "$ATT/candidate.patch" > "$ATT/secret-scan.txt"
  if [ -s "$ATT/secret-scan.txt" ]; then
    log "possible credential in the diff; not committing (see secret-scan.txt, values masked)"
    echo "- The diff appears to contain a credential (lines: $(cut -d: -f1 "$ATT/secret-scan.txt" | tr '\n' ' ')). Remove it; use configuration, never literals." >> "$FEEDBACK_NEXT"
    OUTCOME=retry; return
  fi

  # 3. Independent verification: the wrapper re-runs every test command itself.
  local i=0 cmd trc all_ok=1
  echo "[]" > "$ATT/tests.json"
  while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    i=$((i + 1))
    if ! wait_for_load; then
      log "test $i not run: load stayed above $LOAD_MAX"
      "$PY" -I - "$ATT/tests.json" "$cmd" not_run "machine load above $LOAD_MAX" <<'PYEOF'
import json,sys; p=sys.argv[1]; d=json.load(open(p)); d.append({"command":sys.argv[2],"result":sys.argv[3],"details":sys.argv[4]}); json.dump(d,open(p,"w"),indent=1)
PYEOF
      all_ok=0; continue
    fi
    log "verify $i: $cmd"
    trc=0
    ( cd "$WT" && run_with_timeout "$(state_get test_timeout)" bash -c "$cmd" ) > "$ATT/test-$i.log" 2>&1 || trc=$?
    local res=passed; [ "$trc" -ne 0 ] && { res=failed; all_ok=0; }
    "$PY" -I - "$ATT/tests.json" "$cmd" "$res" "exit $trc; log attempt-$n/test-$i.log" <<'PYEOF'
import json,sys; p=sys.argv[1]; d=json.load(open(p)); d.append({"command":sys.argv[2],"result":sys.argv[3],"details":sys.argv[4]}); json.dump(d,open(p,"w"),indent=1)
PYEOF
    if [ "$trc" -ne 0 ]; then
      { echo "- Verification command failed (exit $trc): \`$cmd\`. Last lines:"; echo '```'; tail -n 40 "$ATT/test-$i.log"; echo '```'; } >> "$FEEDBACK_NEXT"
    fi
  done <<EOF
$(state_get tests)
EOF
  if [ "$i" -eq 0 ]; then log "no --test commands given: nothing independently verified"; fi
  if [ "$all_ok" != 1 ]; then OUTCOME=retry; return; fi

  # 4. Commit on the task branch (the wrapper, not Codex, owns Git).
  local summary; summary="$(json_get "$ATT/report.json" summary | head -c 400)"
  git -C "$WT" add -A
  git -C "$WT" commit -q -F - <<MSG
codex($TASK): $(state_get title)

$summary

Task-Id: $TASK
Attempt: $n
Delegated-Agent: codex-cli $(codex_version)
Verified-By: scripts/ai/codex-task.sh ($i command(s) re-run by the wrapper)
MSG
  state_set commit "$(git -C "$WT" rev-parse HEAD)"
  log "committed $(git -C "$WT" rev-parse --short HEAD) on $(state_get branch)"
  if [ "$(json_get "$ATT/report.json" task_completed)" != "true" ]; then
    log "committed, but Codex reports the task incomplete; see its outstanding_problems"
    OUTCOME=partial; return
  fi
  OUTCOME=passed
}

write_result() { # $1 = final status
  local att="$RUN/attempt-$(state_get attempts)"
  "$PY" -I - "$RUN" "$1" "$att" <<'PYEOF'
import json, os, subprocess, sys
run, status, att = sys.argv[1], sys.argv[2], sys.argv[3]
st = {}
for line in open(os.path.join(run, "state")):
    k, _, v = line.rstrip("\n").partition("=")
    st[k] = v
def load(p, default):
    try: return json.load(open(p))
    except Exception: return default
report = load(os.path.join(att, "report.json"), {})
wt = st.get("worktree", "")
commit = st.get("commit", "")
files = []
if commit and wt and os.path.isdir(wt):
    base = st.get("base_sha", "")
    out = subprocess.run(["git", "-C", wt, "diff", "--name-only", base, commit], capture_output=True, text=True)
    files = [f for f in out.stdout.splitlines() if f]
problems = list(report.get("outstanding_problems", []))
for name in ("problem.txt", "out-of-scope.txt", "secret-scan.txt"):
    p = os.path.join(att, name)
    if os.path.exists(p) and os.path.getsize(p):
        problems.append(f"{name}: " + open(p).read().strip()[:600])
result = {
    "task_id": st.get("task"), "status": status, "attempts": int(st.get("attempts", "0")),
    "max_attempts": int(st.get("max", "3")), "branch": st.get("branch"), "worktree": wt,
    "base_sha": st.get("base_sha"), "commit_sha": commit or None,
    "codex_task_completed": report.get("task_completed"),
    "codex_summary": report.get("summary"),
    "files_changed": files or report.get("files_changed", []),
    "tests_reported_by_codex": report.get("tests_executed", []),
    "tests_verified_by_wrapper": load(os.path.join(att, "tests.json"), []),
    "outstanding_problems": problems,
    "run_dir": run,
}
json.dump(result, open(os.path.join(run, "result.json"), "w"), indent=2, ensure_ascii=False)
print(json.dumps(result, indent=2, ensure_ascii=False))
PYEOF
}

attempt_loop() { # $1 = initial feedback file (may be empty)
  local fb="${1:-}" max; max="$(state_get max)"
  while :; do
    OUTCOME=""; one_attempt "$fb"
    case "$OUTCOME" in
      passed|partial|blocked) break ;;
    esac
    if [ "$(state_get attempts)" -ge "$max" ]; then OUTCOME=failed; break; fi
    if [ "$(state_get auto_retry)" != 1 ]; then OUTCOME=needs_feedback; break; fi
    fb="$FEEDBACK_NEXT"
    log "retrying with feedback ($(state_get attempts)/$max used)"
  done
  write_result "$OUTCOME"
}

cmd_run() {
  local brief="" base="origin/main" risk="low" approval="" title="" model="" auto=1 max="$MAX_ATTEMPTS_DEFAULT"
  local ct="$CODEX_TIMEOUT_DEFAULT" tt="$TEST_TIMEOUT_DEFAULT" allow=() tests=() prepare=() migrations=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --task-id) TASK="$2"; shift 2 ;;
      --brief) brief="$2"; shift 2 ;;
      --title) title="$2"; shift 2 ;;
      --base) base="$2"; shift 2 ;;
      --allow) allow+=("$2"); shift 2 ;;
      --allow-migrations) migrations=1; shift ;;
      --test) tests+=("$2"); shift 2 ;;
      --prepare) prepare+=("$2"); shift 2 ;;
      --risk) risk="$2"; shift 2 ;;
      --owner-approval) approval="$2"; shift 2 ;;
      --model) model="$2"; shift 2 ;;
      --max-attempts) max="$2"; shift 2 ;;
      --no-auto-retry) auto=0; shift ;;
      --codex-timeout) ct="$2"; shift 2 ;;
      --test-timeout) tt="$2"; shift 2 ;;
      *) die "run: unknown option $1" ;;
    esac
  done
  [ -n "${TASK:-}" ] || die "run: --task-id is required"; valid_id "$TASK"
  [ -f "$brief" ] || die "run: --brief FILE is required"
  [ ${#allow[@]} -gt 0 ] || die "run: at least one --allow PATH-GLOB is required (explicit ownership)"
  [ "$max" -ge 1 ] && [ "$max" -le 3 ] || die "run: --max-attempts must be 1..3"
  case "$risk" in
    low|medium) ;;
    high) [ -n "$approval" ] || die "run: high-risk work needs --owner-approval \"<the owner's words, quoted>\"" ;;
    *) die "run: --risk must be low, medium or high" ;;
  esac
  [ "$migrations" = 0 ] || [ "$risk" != low ] || die "run: a migration is never low risk; use --risk medium or high"
  [ -x "$CODEX" ] || die "codex CLI not found at $CODEX (set CODEX_BIN)"

  RUN="$RUNS/$TASK"; WT="$WORKTREES/$TASK"
  [ -e "$RUN/state" ] && die "run: task $TASK already exists; use 'retry' or a new task id"
  [ -e "$WT" ] && die "run: $WT already exists"
  mkdir -p "$RUN"; acquire_lock
  LOGFILE="$RUN/setup.log"

  [ "${JAWWID_AI_NO_FETCH:-0}" = 1 ] || git -C "$REPO" fetch -q origin main
  local base_sha; base_sha="$(git -C "$REPO" rev-parse --verify "$base^{commit}")" || die "run: unknown base $base"
  local branch="claude/codex-$TASK"
  git -C "$REPO" show-ref --quiet "refs/heads/$branch" && die "run: branch $branch already exists"
  mkdir -p "$WORKTREES"
  git -C "$REPO" worktree add -q -b "$branch" "$WT" "$base_sha"
  log "worktree $WT on $branch from $(git -C "$REPO" rev-parse --short "$base_sha")"

  cp "$brief" "$RUN/brief.md"
  {
    echo "task=$TASK"; echo "branch=$branch"; echo "worktree=$WT"; echo "base_sha=$base_sha"
    echo "title=${title:-$(head -1 "$brief" | sed 's/^#* *//; s/^Task brief: *//')}"
    echo "risk=$risk"; [ -n "$approval" ] && echo "owner_approval=$approval"
    echo "model=$model"; echo "max=$max"; echo "auto_retry=$auto"; echo "attempts=0"
    echo "allow_migrations=$migrations"; echo "codex_timeout=$ct"; echo "test_timeout=$tt"
  } > "$RUN/state"
  # Multi-line values: one line each under a single key.
  local a; for a in "${allow[@]}"; do echo "allow=$a"; done >> "$RUN/state"
  for a in ${tests[@]+"${tests[@]}"}; do echo "tests=$a"; done >> "$RUN/state"

  # Dependency setup runs OUTSIDE the sandbox (it may need the network), before Codex.
  for a in ${prepare[@]+"${prepare[@]}"}; do
    wait_for_load || die "prepare: load stayed above $LOAD_MAX"
    log "prepare: $a"
    ( cd "$WT" && bash -c "$a" ) >> "$RUN/prepare.log" 2>&1 || die "prepare failed: $a (see $RUN/prepare.log)"
  done

  attempt_loop ""
}

load_task() {
  valid_id "$TASK"; RUN="$RUNS/$TASK"; [ -f "$RUN/state" ] || die "no such task: $TASK"
  WT="$(state_get worktree)"
}

cmd_retry() {
  local fb=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --task-id) TASK="$2"; shift 2 ;;
      --feedback) fb="$2"; shift 2 ;;
      *) die "retry: unknown option $1" ;;
    esac
  done
  [ -f "$fb" ] || die "retry: --feedback FILE is required"
  load_task; acquire_lock
  [ -d "$WT" ] || die "retry: worktree $WT is gone"
  [ "$(state_get attempts)" -lt "$(state_get max)" ] || die "retry: attempt limit $(state_get max) reached; fall back to Claude or escalate"
  cp "$fb" "$RUN/feedback-$(($(state_get attempts) + 1)).md"
  attempt_loop "$fb"
}

# ---- review -------------------------------------------------------------------

cmd_review() {
  local dir="" base="" head="" focus="" model=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --task-id) TASK="$2"; shift 2 ;;
      --repo) dir="$2"; shift 2 ;;
      --base) base="$2"; shift 2 ;;
      --head) head="$2"; shift 2 ;;
      --focus) focus="$2"; shift 2 ;;
      --model) model="$2"; shift 2 ;;
      *) die "review: unknown option $1" ;;
    esac
  done
  [ -n "${TASK:-}" ] || die "review: --task-id is required"; valid_id "$TASK"
  [ -d "$dir" ] || die "review: --repo DIR (a clean checkout of the head commit) is required"
  [ -n "$base" ] || die "review: --base REF is required"
  head="${head:-HEAD}"
  local head_sha base_sha
  head_sha="$(git -C "$dir" rev-parse --verify "$head^{commit}")"
  base_sha="$(git -C "$dir" rev-parse --verify "$base^{commit}")"
  [ "$(git -C "$dir" rev-parse HEAD)" = "$head_sha" ] || die "review: $dir is not checked out at $head_sha; the reviewer reads source from it"
  [ -z "$(git -C "$dir" status --porcelain)" ] || die "review: $dir has uncommitted changes; review needs a clean tree"

  RUN="$RUNS/$TASK/review-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$RUN/tmp"; LOGFILE="$RUN/review.log"
  git -C "$dir" diff --no-color --no-ext-diff "$base_sha" "$head_sha" > "$RUN/diff.patch"
  git -C "$dir" diff --name-status "$base_sha" "$head_sha" > "$RUN/files.txt"
  local nfiles; nfiles="$(wc -l < "$RUN/files.txt" | tr -d ' ')"
  [ "$(grep -c '^diff --git' "$RUN/diff.patch")" = "$nfiles" ] || die "review: diff/file-count mismatch; refusing an incomplete diff"
  secret_scan "$RUN/diff.patch" > "$RUN/secret-scan.txt"
  if [ -s "$RUN/secret-scan.txt" ]; then
    log "possible credentials in the diff: redacting before Codex sees it"
    sed -E -i '' 's/(sk_(live|test)_|pk_live_|AKIA|gh[pousr]_|xox[abpr]-)[A-Za-z0-9_-]{6,}/\1<redacted>/g; s/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/<redacted-jwt>/g' "$RUN/diff.patch"
  fi
  sed -e "s#{{DIFF_FILE}}#$RUN/diff.patch#" -e "s#{{FILE_COUNT}}#$nfiles#" "$TEMPLATES/reviewer-preamble.md" > "$RUN/prompt.md"
  { echo; echo "Review the change $base_sha..$head_sha."; [ -f "$focus" ] && { echo; echo "---- FOCUS ----"; cat "$focus"; }; } >> "$RUN/prompt.md"

  local model_args=(); [ -n "$model" ] && model_args=(-m "$model")
  log "review: $nfiles files, codex $(codex_version), read-only sandbox, in $dir"
  local rc=0
  TMPDIR="$RUN/tmp" run_with_timeout "$CODEX_TIMEOUT_DEFAULT" \
    "$CODEX" -a never exec -C "$dir" -s read-only --ignore-user-config --color never --json \
      --output-schema "$TEMPLATES/review.schema.json" -o "$RUN/review.json" \
      ${model_args[@]+"${model_args[@]}"} - \
      < "$RUN/prompt.md" > "$RUN/codex.jsonl" 2> "$RUN/codex.stderr" || rc=$?
  [ -z "$(git -C "$dir" status --porcelain)" ] || log "WARNING: $dir changed during a read-only review"
  if [ "$rc" -ne 0 ] || [ ! -s "$RUN/review.json" ]; then
    log "review failed (exit $rc); see $RUN/codex.stderr"; tail -c 800 "$RUN/codex.stderr" >&2; exit 1
  fi
  echo "review written to $RUN/review.json" >&2
  cat "$RUN/review.json"
}

# ---- status / list / cleanup ----------------------------------------------------

cmd_status() { [ "${1:-}" = --task-id ] && TASK="$2"; load_task; [ -f "$RUN/result.json" ] && cat "$RUN/result.json" || cat "$RUN/state"; }

cmd_list() {
  [ -d "$RUNS" ] || { echo "no runs"; return; }
  local d; for d in "$RUNS"/*/; do
    TASK="$(basename "$d")"; RUN="$RUNS/$TASK"
    [ -f "$RUN/result.json" ] && printf '%-36s %s\n' "$TASK" "$(json_get "$RUN/result.json" status) $(json_get "$RUN/result.json" commit_sha)" \
      || printf '%-36s %s\n' "$TASK" "(no result yet)"
  done
}

cmd_cleanup() {
  local delete_branch=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --task-id) TASK="$2"; shift 2 ;;
      --delete-merged-branch) delete_branch=1; shift ;;
      *) die "cleanup: unknown option $1" ;;
    esac
  done
  load_task; acquire_lock
  local branch; branch="$(state_get branch)"
  if [ -d "$WT" ]; then
    [ -z "$(git -C "$WT" status --porcelain)" ] || die "cleanup: $WT has uncommitted changes; refusing (never forced)"
    git -C "$REPO" worktree remove "$WT"   # no --force, by design
    log "removed worktree $WT"
  fi
  if [ "$delete_branch" = 1 ]; then
    git -C "$REPO" fetch -q origin main
    if git -C "$REPO" merge-base --is-ancestor "$branch" origin/main; then
      git -C "$REPO" branch -d "$branch" && log "deleted merged branch $branch"
    else
      log "kept $branch: not merged into origin/main"
    fi
  fi
  echo "run directory kept: $RUN"
}

sub="${1:-}"; [ $# -gt 0 ] && shift
case "$sub" in
  run) cmd_run "$@" ;;
  retry) cmd_retry "$@" ;;
  review) cmd_review "$@" ;;
  status) cmd_status "$@" ;;
  list) cmd_list ;;
  cleanup) cmd_cleanup "$@" ;;
  *) usage ;;
esac
