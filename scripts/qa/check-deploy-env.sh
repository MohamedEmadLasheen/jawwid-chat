#!/usr/bin/env bash
# Prove the deployment workflows still match the environment contract.
# Owner: AI #7 (infrastructure).
#
#   scripts/qa/check-deploy-env.sh
#   scripts/qa/check-deploy-env.sh --workflows /tmp/copies
#   scripts/qa/check-deploy-env.sh --self-test
#
# WHY THIS EXISTS
# ---------------
# infra/env/manifest.tsv required STORAGE_SIGNING_SECRET from the day it was
# written, and neither deployment workflow ever supplied it. Nothing compared
# the two, so the gap survived every review and would have surfaced as a failed
# release. The APNs half was worse: the contract moved from APNS_PRODUCTION to
# APNS_ENVIRONMENT, the workflows kept the old name, and check-env.sh iterates
# the MANIFEST -- so a variable no manifest names is ignored in silence. The
# workflow still read as if the control were there.
#
# check-env.sh grades an environment at DEPLOY time, when the secrets exist.
# This grades the workflow FILES at commit time, when nothing exists yet. The
# two are complementary and neither replaces the other: a pass here means the
# right variable NAMES are wired to the right validator, not that any of them
# has a usable value.
#
# Portability: bash 3.2 (macOS), plus awk. No associative arrays, no readarray.
# No Python, no YAML library, no network -- the same contract scripts/qa/guards.sh
# states for everything it runs.
#
# It NEVER prints a variable's value, QUEUE_PREFIX included. Names and verdicts
# only, exactly as check-env.sh does.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOWS="$ROOT/.github/workflows"
SELFTEST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --workflows) WORKFLOWS="${2:-}"; shift 2 ;;
    --self-test) SELFTEST=1; shift ;;
    *) echo "unknown argument: $1" >&2
       echo "usage: $0 [--workflows DIR] [--self-test]" >&2; exit 64 ;;
  esac
done

MANIFEST_API="$ROOT/infra/env/manifest.tsv"
MANIFEST_WORKER="$ROOT/infra/env/worker.manifest.tsv"

# Variables that are legitimately in a workflow env and in NO manifest, because
# they configure the PIPELINE rather than the application. Deliberately one
# name: a broad allowlist would re-open exactly the hole this gate closes.
ALLOWLIST="REGISTRY"

# Names the contract has RETIRED. check-env.sh cannot catch these -- it walks
# the manifest, so a name no manifest carries is invisible to it, and a retired
# variable therefore keeps reading like a working control.
RETIRED="APNS_PRODUCTION"

# The four contracts that must exist. Fewer, more, or different is a failure:
# a deleted validation step is the most direct way to silently stop grading.
EXPECTED="api:staging worker:staging api:production worker:production"

# ---------------------------------------------------------------- self-test
# Nine synthetic mutations, each applied to a COPY in a temp directory. The
# repository is never written to. Eight must fail and one -- renaming a step
# while leaving its command alone -- must still pass, which is what proves the
# guard keys on the command rather than on prose.
_st_del() { # file KEY RUNCMD : drop the last `KEY:` line before that run line
  local f="$1" k="$2" cmd="$3" a t
  a=$(grep -n "run: $cmd\$" "$f" | head -1 | cut -d: -f1)
  [ -n "$a" ] || return 1
  t=$(grep -n "^          $k:" "$f" | awk -F: -v a="$a" '$1<a { n=$1 } END { print n+0 }')
  [ "$t" -gt 0 ] || return 1
  awk -v t="$t" 'NR != t' "$f" > "$f.n" && mv "$f.n" "$f"
}
_st_ins() { # file RUNCMD LINE : add an env entry to that step
  local f="$1" cmd="$2" l="$3" a
  a=$(grep -n "run: $cmd\$" "$f" | head -1 | cut -d: -f1)
  [ -n "$a" ] || return 1
  awk -v a="$a" -v l="$l" 'NR == a { print l } { print }' "$f" > "$f.n" && mv "$f.n" "$f"
}

self_test() {
  local base out rc pass=0 fail=0 n
  base="$(mktemp -d -t jawwid-deploy-selftest.XXXXXX)"
  echo "Self-test — nine synthetic mutations on temporary copies"
  echo "  source: $WORKFLOWS"
  echo "  copies: $base   (the repository is never modified)"
  echo

  _st_case() { # n description expect-rc expect-pattern mutate-fn
    local d="$base/$1"
    mkdir -p "$d"; cp "$WORKFLOWS/deploy-staging.yml" "$WORKFLOWS/deploy-production.yml" "$d/"
    "$5" "$d" || { printf '  %-2s %-52s MUTATION FAILED\n' "$1" "$2"; fail=$((fail+1)); return; }
    out=$("$0" --workflows "$d" 2>&1); rc=$?
    if [ "$3" = "0" ]; then
      if [ "$rc" -eq 0 ]; then printf '  %-2s %-52s expect PASS -> PASS\n' "$1" "$2"; pass=$((pass+1))
      else printf '  %-2s %-52s expect PASS -> FAILED\n' "$1" "$2"; echo "$out" | sed 's/^/       /'; fail=$((fail+1)); fi
    else
      if [ "$rc" -ne 0 ] && echo "$out" | grep -q "$4"; then
        printf '  %-2s %-52s expect FAIL -> FAIL [%s]\n' "$1" "$2" "$4"; pass=$((pass+1))
      else
        printf '  %-2s %-52s expect FAIL -> WRONG (rc=%s)\n' "$1" "$2" "$rc"; echo "$out" | sed 's/^/       /'; fail=$((fail+1))
      fi
    fi
  }

  _m0() { :; }
  _m1() { _st_del "$1/deploy-staging.yml"    STORAGE_SIGNING_SECRET "scripts/infra/check-env.sh staging"; }
  _m2() { _st_del "$1/deploy-production.yml" APNS_ENVIRONMENT       "scripts/infra/check-env.sh production"; }
  _m3() { _st_ins "$1/deploy-production.yml" "scripts/infra/check-env.sh production" "          APNS_PRODUCTION: 'true'"; }
  _m4() { _st_ins "$1/deploy-production.yml" "scripts/infra/check-env.sh production --component worker" "          DATABASE_URL: \${{ secrets.DATABASE_URL }}"; }
  _m5() { _st_del "$1/deploy-staging.yml"    DATABASE_SERVICE_URL   "scripts/infra/check-env.sh staging --component worker"; }
  _m6() { _st_ins "$1/deploy-staging.yml"    "scripts/infra/check-env.sh staging --component worker" "          QUEUE_PREFIX: a-different-namespace"; }
  _m7() { local f="$1/deploy-staging.yml"
          awk '!/^  QUEUE_PREFIX:/' "$f" > "$f.n" && mv "$f.n" "$f"
          awk 'BEGIN{d=0} { print } /^    runs-on: ubuntu-latest$/ && !d { print "    env:"; print "      QUEUE_PREFIX: moved-away"; d=1 }' "$f" > "$f.n" && mv "$f.n" "$f"; }
  _m8() { local f="$1/deploy-staging.yml"
          awk '/^      - name: Validate the worker configuration$/{s=1} s && /--component worker$/{s=0; next} !s' "$f" > "$f.n" && mv "$f.n" "$f"; }
  _m9() { local f="$1/deploy-staging.yml"
          sed 's/^      - name: Validate the worker configuration$/      - name: Grade the background process/' "$f" > "$f.n" && mv "$f.n" "$f"; }

  _st_case 0 "baseline copy (backup-step DATABASE_URL not flagged)" 0 ""                       _m0
  _st_case 1 "remove STORAGE_SIGNING_SECRET from staging API"       1 "MISSING.*STORAGE_SIGNING_SECRET" _m1
  _st_case 2 "remove APNS_ENVIRONMENT from production API"          1 "MISSING.*APNS_ENVIRONMENT"       _m2
  _st_case 3 "reintroduce APNS_PRODUCTION"                          1 "RETIRED.*APNS_PRODUCTION"        _m3
  _st_case 4 "add DATABASE_URL to worker production"                1 "FORBIDDEN.*DATABASE_URL"         _m4
  _st_case 5 "remove DATABASE_SERVICE_URL from worker staging"      1 "MISSING.*DATABASE_SERVICE_URL"   _m5
  _st_case 6 "override QUEUE_PREFIX in the worker step only"        1 "overridden in a step"            _m6
  _st_case 7 "move QUEUE_PREFIX into the unrelated build job"       1 "MISSING.*QUEUE_PREFIX"           _m7
  _st_case 8 "delete an entire validation step"                     1 "expected exactly"                _m8
  _st_case 9 "rename a validation step, command unchanged"          0 ""                                _m9

  echo
  n=$((pass + fail))
  rm -rf "$base"
  if [ "$fail" -eq 0 ]; then echo "self-test: PASS ($pass/$n)"; return 0; fi
  echo "::error::self-test: FAIL ($fail of $n)"; return 1
}

if [ "$SELFTEST" -eq 1 ]; then self_test; exit $?; fi

TMP="$(mktemp -d -t jawwid-deploy-env.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

findings=0
note() { printf '  %-11s %-6s %-11s %-30s %s\n' "$1" "$2" "$3" "$4" "${5:-}"; findings=$((findings + 1)); }
hard() { printf '  %-11s %s\n' "STRUCTURE" "$1"; findings=$((findings + 1)); }

# ---------------------------------------------------------------- parser
#
# Emits one tab-separated record per line:
#   WF    KEY VALUE                 workflow-level env entry
#   JOB   job KEY VALUE             job-level env entry (scoped to that job)
#   STEP  job n KEY VALUE           step-level env entry
#   RUN   job n COMMAND             a check-env.sh invocation
#   REFS  n                         how many non-comment lines mention check-env.sh
#   ERR   message                   an unmodelled construct
#
# Indentation is the whole model: GitHub workflows are 2-space canonical, so
# workflow env entries sit at 2, job env at 6, step env at 10. Anything inside
# an env block that is not `NAME: value` at the expected depth is an ERR rather
# than a skip. A parser that silently ignores what it cannot read produces a
# green gate over unread configuration, which is the failure this file exists
# to prevent -- so it fails closed, loudly, every time.
parse() {
  awk '
    function ind(s,   n) { match(s, /^ */); return RLENGTH }
    BEGIN { scope=""; envind=-1; job=""; step=0; injobs=0; refs=0 }
    {
      line = $0; sub(/\r$/, "", line)
      i = ind(line)
      body = line; sub(/^ */, "", body)

      if (body != "" && substr(body,1,1) != "#" && line ~ /check-env\.sh/) refs++
      if (body == "" || substr(body,1,1) == "#") next

      # YAML anchors, aliases and merge keys would make the text say one thing
      # and the parsed document another. Refuse rather than guess.
      if (body ~ /^<<:/ || body ~ /:[ \t]*[&*][A-Za-z_]/) {
        printf "ERR\tYAML anchor, alias or merge key affects the environment\n"; next
      }

      if (scope != "") {
        if (i >= envind) {
          if (body ~ /^[A-Za-z_][A-Za-z0-9_]*:/) {
            key = body; sub(/:.*/, "", key)
            val = body; sub(/^[A-Za-z_][A-Za-z0-9_]*:[ \t]*/, "", val)
            if (scope == "WF")       printf "WF\t%s\t%s\n", key, val
            else if (scope == "JOB") printf "JOB\t%s\t%s\t%s\n", job, key, val
            else                     printf "STEP\t%s\t%d\t%s\t%s\n", job, step, key, val
            next
          }
          printf "ERR\tunmodelled line inside a %s env block\n", scope
          next
        }
        scope = ""   # dedent closed the block; fall through and read this line
      }

      if (i == 0 && body ~ /^env:/) {
        rest = body; sub(/^env:[ \t]*/, "", rest)
        if (rest != "") { printf "ERR\tflow-style or inline workflow env\n"; next }
        scope = "WF"; envind = 2; next
      }
      if (i == 0 && body ~ /^jobs:/) { injobs = 1; next }
      if (i == 0) { injobs = 0; next }

      if (injobs && i == 2 && body ~ /^[A-Za-z_][A-Za-z0-9_-]*:/) {
        job = body; sub(/:.*/, "", job); step = 0; next
      }
      if (i == 4 && body ~ /^env:/) {
        rest = body; sub(/^env:[ \t]*/, "", rest)
        if (rest != "") { printf "ERR\tflow-style or inline job env\n"; next }
        scope = "JOB"; envind = 6; next
      }
      if (i == 6 && body ~ /^- /) { step++; next }
      if (i == 8 && body ~ /^env:/) {
        rest = body; sub(/^env:[ \t]*/, "", rest)
        if (rest != "") { printf "ERR\tflow-style or inline step env\n"; next }
        scope = "STEP"; envind = 10; next
      }
      if (i == 8 && body ~ /^run:/) {
        cmd = body; sub(/^run:[ \t]*/, "", cmd)
        if (cmd ~ /check-env\.sh/) printf "RUN\t%s\t%d\t%s\n", job, step, cmd
        next
      }
    }
    END { printf "REFS\t%d\n", refs }
  ' "$1"
}

# Effective environment of one step, in GitHub precedence: step > job > workflow.
# Reading only the step block would report QUEUE_PREFIX missing -- it reaches
# both validation steps by inheritance. Job scope is keyed on the job NAME, so a
# variable parked in an unrelated job does not count as present.
effective() { # records job step
  awk -F'\t' -v job="$2" -v st="$3" '
    $1=="WF"                              { v[$2]=$3; seen[$2]=1 }
    $1=="JOB"  && $2==job                 { v[$3]=$4; seen[$3]=1 }
    $1=="STEP" && $2==job && $3==st       { v[$4]=$5; seen[$4]=1 }
    END { for (k in seen) printf "%s\t%s\n", k, v[k] }
  ' "$1" | sort
}

# ---------------------------------------------------------------- collect
FILES=""
for e in staging production; do
  f="$WORKFLOWS/deploy-$e.yml"
  [ -f "$f" ] || { echo "workflow not found: $f" >&2; exit 66; }
  parse "$f" > "$TMP/rec.$e"
  FILES="$FILES $e"
done

echo "Deployment environment contract — 4 contracts, 2 workflows"
echo

# Fail closed on anything the parser could not model.
for e in $FILES; do
  while IFS=$'\t' read -r kind msg; do
    [ "$kind" = "ERR" ] && hard "deploy-$e.yml: $msg"
  done < "$TMP/rec.$e"

  runs=$(awk -F'\t' '$1=="RUN"' "$TMP/rec.$e" | wc -l | tr -d ' ')
  refs=$(awk -F'\t' '$1=="REFS" { print $2 }' "$TMP/rec.$e")
  # Every mention of check-env.sh outside a comment must be one of the
  # invocations we parsed. A call hidden in a `run: |` block, or built from an
  # expression, would otherwise run ungraded.
  [ "$runs" = "$refs" ] || hard "deploy-$e.yml: $refs check-env.sh reference(s) but $runs parsed invocation(s)"
done

# Contracts, derived from the COMMAND rather than the step name. The run line is
# what the runner executes; a step name is prose an author may rewrite freely,
# and a gate keyed on prose stops grading the moment someone improves a label.
: > "$TMP/contracts"
for e in $FILES; do
  while IFS=$'\t' read -r kind job step cmd; do
    [ "$kind" = "RUN" ] || continue
    case "$cmd" in *'${{'*) hard "deploy-$e.yml: check-env.sh command is built from an expression"; continue ;; esac
    set -- $cmd
    [ "$1" = "scripts/infra/check-env.sh" ] || { hard "deploy-$e.yml: unrecognised validator: $1"; continue; }
    cenv="${2:-}"; comp="api"
    if [ $# -eq 4 ] && [ "$3" = "--component" ]; then comp="$4"
    elif [ $# -ne 2 ]; then hard "deploy-$e.yml: malformed check-env.sh invocation"; continue
    fi
    case "$cenv" in staging|production) : ;; *) hard "deploy-$e.yml: unknown environment '$cenv'"; continue ;; esac
    case "$comp" in api|worker) : ;; *) hard "deploy-$e.yml: unknown component '$comp'"; continue ;; esac
    printf '%s\t%s\t%s\t%s\t%s\n' "$e" "$job" "$step" "$cenv" "$comp" >> "$TMP/contracts"
  done < "$TMP/rec.$e"
done

found=$(awk -F'\t' '{ print $5":"$4 }' "$TMP/contracts" | sort | tr '\n' ' ')
want=$(echo "$EXPECTED" | tr ' ' '\n' | sort | tr '\n' ' ')
[ "$found" = "$want" ] || hard "expected exactly [$want], found [$found]"

# ---------------------------------------------------------------- contracts
while IFS=$'\t' read -r file job step cenv comp; do
  [ "$comp" = "worker" ] && man="$MANIFEST_WORKER" || man="$MANIFEST_API"
  effective "$TMP/rec.$file" "$job" "$step" > "$TMP/eff"
  awk -F'\t' -v e="$cenv" '!/^#/ && NF>=6 { print $1"\t"((e=="staging")?$5:$6)"\t"$2 }' "$man" > "$TMP/man"

  miss=0; forb=0; stale=0
  # A: every required name is supplied, inheritance included.
  # B: every forbidden name is absent -- inheritance is exactly how one leaks in.
  # C: every supplied name exists in THIS component's manifest. Worker-specific
  #    rules need no code here: DATABASE_URL is forbidden by the worker manifest,
  #    and PORT / CORS_ALLOWED_ORIGINS / WORKER_CONCURRENCY / FCM_PROJECT_ID are
  #    absent from it, so authoring one is stale by construction.
  while IFS=$'\t' read -r kind name grp; do
    case "$kind" in
      MISSING) note "MISSING" "$comp" "$cenv" "$name" "($grp, required)"; miss=$((miss+1)) ;;
      FORBID)  note "FORBIDDEN" "$comp" "$cenv" "$name" "($grp, forbidden)"; forb=$((forb+1)) ;;
      STALE)   note "STALE" "$comp" "$cenv" "$name" "(in no $comp manifest row)"; stale=$((stale+1)) ;;
    esac
  done < <(awk -F'\t' -v allow="$ALLOWLIST" '
      FILENAME ~ /man$/ { rule[$1]=$2; grp[$1]=$3; next }
      { have[$1]=1 }
      END {
        n=split(allow, a, " "); for (i=1;i<=n;i++) ok[a[i]]=1
        for (k in rule) {
          if (rule[k]=="req"    && !(k in have)) printf "MISSING\t%s\t%s\n", k, grp[k]
          if (rule[k]=="forbid" &&  (k in have)) printf "FORBID\t%s\t%s\n",  k, grp[k]
        }
        for (k in have) if (!(k in rule) && !(k in ok)) printf "STALE\t%s\t-\n", k
      }' "$TMP/man" "$TMP/eff" | sort)

  total=$(wc -l < "$TMP/eff" | tr -d ' ')
  if [ $((miss + forb + stale)) -eq 0 ]; then verdict=PASS; else verdict=FAIL; fi
  printf '  %-7s %-11s %3s vars · %d missing · %d forbidden · %d stale   %s\n' \
    "$comp" "$cenv" "$total" "$miss" "$forb" "$stale" "$verdict"
done < "$TMP/contracts"

# ---------------------------------------------------------------- retired
# Scanned over PARSED env keys at every scope in both files, not by grepping the
# text: a mention in a comment is prose, a key in an env block is configuration.
for e in $FILES; do
  for r in $RETIRED; do
    if awk -F'\t' -v r="$r" '
         ($1=="WF"   && $2==r) ||
         ($1=="JOB"  && $3==r) ||
         ($1=="STEP" && $4==r) { found=1 } END { exit !found }' "$TMP/rec.$e"; then
      note "RETIRED" "-" "$e" "$r" "(removed from the contract; check-env.sh ignores it)"
    fi
  done
done

# ---------------------------------------------------------------- QUEUE_PREFIX
# Structural only. The literals are authoritative nowhere in this repository --
# every manifest and template declares QUEUE_PREFIX required with no value -- so
# the guard proves the SHAPE and never the string, and prints neither.
echo
qp_ok=1; qp_stg=""; qp_prod=""
for e in $FILES; do
  defs=$(awk -F'\t' '($1=="WF" && $2=="QUEUE_PREFIX") || ($1=="JOB" && $3=="QUEUE_PREFIX") || ($1=="STEP" && $4=="QUEUE_PREFIX")' "$TMP/rec.$e" | wc -l | tr -d ' ')
  wf=$(awk -F'\t'  '$1=="WF"   && $2=="QUEUE_PREFIX"' "$TMP/rec.$e" | wc -l | tr -d ' ')
  st=$(awk -F'\t'  '$1=="STEP" && $4=="QUEUE_PREFIX"' "$TMP/rec.$e" | wc -l | tr -d ' ')
  [ "$defs" = "1" ] || { hard "deploy-$e.yml: QUEUE_PREFIX defined $defs times; exactly one source is required"; qp_ok=0; }
  [ "$wf"   = "1" ] || { hard "deploy-$e.yml: QUEUE_PREFIX is not defined at workflow level"; qp_ok=0; }
  [ "$st"   = "0" ] || { hard "deploy-$e.yml: QUEUE_PREFIX is overridden in a step; the API and worker values would diverge"; qp_ok=0; }

  a=""; w=""
  while IFS=$'\t' read -r file job step cenv comp; do
    [ "$file" = "$e" ] || continue
    v=$(effective "$TMP/rec.$e" "$job" "$step" | awk -F'\t' '$1=="QUEUE_PREFIX" { print $2 }')
    [ "$comp" = "api" ] && a="$v" || w="$v"
  done < "$TMP/contracts"
  [ "$a" = "$w" ] || { hard "deploy-$e.yml: the API and worker QUEUE_PREFIX resolve differently"; qp_ok=0; }
  [ "$e" = "staging" ] && qp_stg="$a" || qp_prod="$a"
done
if [ -n "$qp_stg" ] && [ "$qp_stg" = "$qp_prod" ]; then
  hard "staging and production share one QUEUE_PREFIX; Redis pub/sub is global to the server"
  qp_ok=0
fi
[ "$qp_ok" -eq 1 ] && qpv=PASS || qpv=FAIL
echo "  QUEUE_PREFIX  one workflow-level source per file · no step override"
printf '                api == worker in each environment · staging != production   %s\n' "$qpv"

# ---------------------------------------------------------------- verdict
echo
if [ "$findings" -eq 0 ]; then
  echo "deployment contract: PASS (4 contracts, 0 findings)"
  exit 0
fi
echo "::error::deployment contract: FAIL ($findings finding(s))"
exit 1
