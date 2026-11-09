#!/usr/bin/env bash
# LR-46 P2-2 / P2-3: what may touch production runs a VERIFIED image, and the
# review cohort refuses an unprotected `production` Environment. A static read
# of the three workflows (no network, no credential, no GitHub API):
#
#   1  no run: script interpolates ${{ inputs.* }} (inputs go through env:),
#      and review-cohort.yml uses no action that is not pinned to a commit SHA
#   2  review-cohort: a preflight job with no Environment and no secrets reads
#      the production Environment through the API and refuses unless it has
#      required reviewers and exactly one deployment branch rule, `main`
#   3  review-cohort and deploy-production: api:<sha> is accepted only if it
#      resolves to the digest a Deploy staging run at <sha> recorded
#   4  review-cohort runs the image BY DIGEST, never by tag
#   5  deploy-production re-checks the tag before the backup and the
#      migrations, and again after the release
#   6  deploy-staging records the digest of its OWN push as the artifact the
#      other two download
#   7  review-cohort never prints a review login (LR-46 P3-9): the login
#      domain is in no env: block, each job masks it in its first step, the
#      CLI's raw output is reduced to counts, and no line prints <x>@$EMAIL_DOMAIN
#
#   bash scripts/qa/check-image-digest-gates.sh            # selftest, then check
#
# The selftest mutates the real files in memory, once per rule, and proves the
# check then fails; an assertion that cannot fail guards nothing.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "check-image-digest-gates: $PYTHON not found -- the check cannot run, so it FAILS"
  exit 2
fi

"$PYTHON" -I - "$ROOT" <<'PY'
import os, re, sys

root = sys.argv[1]
FILES = {
    "review-cohort": ".github/workflows/review-cohort.yml",
    "deploy-production": ".github/workflows/deploy-production.yml",
    "deploy-staging": ".github/workflows/deploy-staging.yml",
}

# The digest record check, as it must appear in BOTH consumers.
DIGEST_CHECK = [
    'docker buildx imagetools inspect "$REPO:$IMAGE_TAG"',
    'actions/workflows/deploy-staging.yml/runs?head_sha=$IMAGE_TAG',
    'select(.head_sha == $sha and .head_repository.full_name == $repo',
    '== ".github/workflows/deploy-staging.yml"',
    # a pull_request run executes the merge commit's (possibly edited) file under head_sha:
    # only a manual run from main may vouch for a digest.
    'and .event == "workflow_dispatch" and .head_branch == "main"',
    'gh run download "$id" -R "$GITHUB_REPOSITORY" -n api-image-digest',
    '= "$IMAGE_TAG $digest" ]',
]
ENV_CHECK = [
    'environments/production")',
    'environments/production/deployment-branch-policies")',
    'select(.type == "required_reviewers")',
    '.deployment_branch_policy.custom_branch_policies',
    '.deployment_branch_policy.protected_branches',
    """'[{"name":"main","type":"branch"}]'""",
]
RECHECK = ['API_DIGEST: ${{ needs.preflight.outputs.api_digest }}', '[ "$now" = "$API_DIGEST" ]']


def jobs(text):
    """job name -> body, by indentation; good enough for these files."""
    i = text.find("\njobs:\n")
    if i < 0:
        return {}
    body = text[i + len("\njobs:"):]
    return {m.group(1): m.group(2) for m in
            re.finditer(r"\n  ([A-Za-z0-9_-]+):\n(.*?)(?=\n  [A-Za-z0-9_-]+:\n|\Z)", body, re.S)}


def steps(job):
    """[(name, body)] in order; a step without a name gets ''."""
    out = []
    for chunk in re.split(r"(?m)^      - ", job)[1:]:
        m = re.search(r"(?m)^(?:        )?name: (.+)$", chunk)
        out.append(((m.group(1).strip().strip('"') if m else ""), chunk))
    return out


def run_blocks(text):
    lines, out, i = text.split("\n"), [], 0
    while i < len(lines):
        m = re.match(r"^(\s*)(?:- )?run: ?(.*)$", lines[i])
        if m:
            ind, rest = len(m.group(1)), m.group(2).strip()
            if rest in ("|", ">", "|-", ">-"):
                block = []
                i += 1
                while i < len(lines) and (not lines[i].strip() or len(lines[i]) - len(lines[i].lstrip()) > ind):
                    block.append(lines[i])
                    i += 1
                out.append("\n".join(block))
                continue
            out.append(rest)
        i += 1
    return out


def check(t):
    P = []
    # 1 ----------------------------------------------------------------------
    for k, text in t.items():
        for b in run_blocks(text):
            if re.search(r"\$\{\{[^}]*\binputs\.", b):
                P.append(f"{k}: a run: script interpolates an input; pass it through env:")
    for u in re.findall(r"(?m)^\s+(?:- )?uses: (\S+)", t["review-cohort"]):
        if not re.search(r"@[0-9a-f]{40}$", u):
            P.append(f"review-cohort: {u} is not pinned to a commit SHA")

    # 2, 3, 4 ----------------------------------------------------------------
    rc = jobs(t["review-cohort"])
    pre, prov = rc.get("preflight", ""), rc.get("provision", "")
    if not pre:
        P.append("review-cohort: no preflight job")
    else:
        if re.search(r"(?m)^    environment:", pre):
            P.append("review-cohort: the preflight job must not run in an Environment (it runs before approval)")
        if "secrets." in pre:
            P.append("review-cohort: the preflight job must not see a secret")
        if not re.search(r"(?m)^      actions: read$", pre):
            P.append("review-cohort: the preflight job lacks actions: read (Environment rules, digest records)")
        for s in ENV_CHECK:
            if s not in pre:
                P.append(f"review-cohort: the Environment preflight does not check {s}")
        for s in DIGEST_CHECK:
            if s not in pre:
                P.append(f"review-cohort: the digest check lacks {s}")
    if not prov:
        P.append("review-cohort: no provision job")
    else:
        if not re.search(r"(?m)^    needs: \[preflight\]$", prov):
            P.append("review-cohort: provision does not need preflight")
        if not re.search(r"(?m)^    environment:\n      name: production$", prov):
            P.append("review-cohort: provision does not run in the production Environment")
        if "IMAGE: ${{ needs.preflight.outputs.image }}" not in prov:
            P.append("review-cohort: provision does not take the digest-pinned image from preflight")
        if re.search(r":\$\{?IMAGE_TAG", prov) or re.search(r"api:\$\{\{", prov):
            P.append("review-cohort: provision references the API image by tag")
        if 'docker pull -q "$IMAGE"' not in prov or '"$IMAGE" "$@"' not in prov:
            P.append("review-cohort: provision does not pull and run \"$IMAGE\"")
        if "/api@sha256:[0-9a-f]{64}$" not in prov:
            P.append("review-cohort: provision does not refuse an IMAGE that is not digest-pinned")

    # 7 ----------------------------------------------------------------------
    rct = t["review-cohort"]
    if re.search(r"\$\{\{\s*inputs\.(?:confirm_)?email_domain", rct):
        P.append("review-cohort: the login domain is in an env: block or expression (its value is printed in the log)")
    if re.search(r"(?:parent2?|teacher)@\$\{?EMAIL_DOMAIN", rct):
        P.append("review-cohort: a review login is printed (summary or log)")
    if re.search(r'(?:echo|printf)[^\n]*"\$out"', prov):
        P.append("review-cohort: the CLI's raw output (it names the logins) is printed")
    if '<<<"$out"' not in prov:
        P.append("review-cohort: the CLI's output is not reduced to counts")
    if not prov or not steps(prov) or "::add-mask::" not in steps(prov)[0][1]:
        P.append("review-cohort: the provision job's first step does not mask the login domain")
    if not pre or not steps(pre) or "::add-mask::$EMAIL_DOMAIN" not in steps(pre)[0][1]:
        P.append("review-cohort: preflight's first step does not mask the login domain")

    # 3, 5 -------------------------------------------------------------------
    pj = jobs(t["deploy-production"])
    ppre, dep = pj.get("preflight", ""), pj.get("deploy", "")
    if not re.search(r"(?m)^      actions: read$", ppre):
        P.append("deploy-production: the preflight job lacks actions: read (digest records)")
    if "api_digest: ${{ steps.image.outputs.digest }}" not in ppre:
        P.append("deploy-production: preflight does not output the verified digest")
    for s in DIGEST_CHECK:
        if s not in ppre:
            P.append(f"deploy-production: the digest check lacks {s}")
    ss = steps(dep)
    names = [n for n, _ in ss]

    def at(prefix):
        return next((i for i, n in enumerate(names) if n.startswith(prefix)), -1)

    before, backup, mig = at("The API tag still points at the verified image"), at("Back up the database"), at("Apply database migrations")
    rel, after = at("Release"), at("The API tag did not move during the release")
    if before < 0 or backup < 0 or mig < 0 or not before < backup < mig:
        P.append("deploy-production: the tag is not re-checked before the backup and the migrations")
    if rel < 0 or after < 0 or not rel < after:
        P.append("deploy-production: the tag is not re-checked after the release")
    for i in (before, after):
        if i >= 0 and not all(s in ss[i][1] for s in RECHECK):
            P.append(f"deploy-production: '{names[i]}' does not compare the tag with preflight's digest")

    # 6 ----------------------------------------------------------------------
    b = jobs(t["deploy-staging"]).get("build", "")
    if 'pushed="$(docker push "$IMAGE:${GITHUB_SHA}")"' not in b:
        P.append("deploy-staging: the digest is not taken from the build's own push")
    if r'''printf '%s %s\n' "$GITHUB_SHA" "$digest"''' not in b:
        P.append("deploy-staging: the record is not '<commit> <digest>'")
    if "imagetools inspect" in b:
        P.append("deploy-staging: the build re-reads the digest from the registry (the tag may have moved)")
    if not re.search(r"uses: actions/upload-artifact@\S+(?: #[^\n]*)?\n        with:\n          name: api-image-digest\n", b):
        P.append("deploy-staging: the digest is not uploaded as the api-image-digest artifact")
    if "if-no-files-found: error" not in b:
        P.append("deploy-staging: a missing digest record would not fail the build")
    return P


texts = {}
for k, rel in FILES.items():
    p = os.path.join(root, rel)
    if not os.path.exists(p):
        sys.exit(f"check-image-digest-gates: {rel} not found")
    texts[k] = open(p, encoding="utf-8").read()

MUTATIONS = [
    ("review-cohort", """'[{"name":"main","type":"branch"}]'""", "'[]'"),
    ("review-cohort", "    needs: [preflight]\n", ""),
    ("review-cohort", "IMAGE: ${{ needs.preflight.outputs.image }}", "IMAGE: ghcr.io/x/api:${{ inputs.image_tag }}"),
    ("review-cohort", "\n  preflight:\n", "\n  preflight:\n    environment: production\n"),
    ("review-cohort", "      actions: read\n", ""),
    ("review-cohort", '= "$IMAGE_TAG $digest" ]', '!= "" ]'),
    ("review-cohort", "    steps:\n      - name: Inputs are well formed",
     "    steps:\n      - uses: actions/checkout@v4\n      - name: Inputs are well formed"),
    ("deploy-production", "The API tag still points at the verified image", "The API tag is looked at"),
    ("deploy-production", '[ "$now" = "$API_DIGEST" ] || { echo "::error::$REPO:$IMAGE_TAG moved from the verified $API_DIGEST to ${now:-nothing}. Nothing',
     '[ -n "$now" ] || { echo "::error::$REPO:$IMAGE_TAG moved from the verified $API_DIGEST to ${now:-nothing}. Nothing'),
    ("deploy-production", "runs?head_sha=$IMAGE_TAG", "runs?branch=main"),
    ("deploy-staging", 'echo "reusing existing image $INPUT_TAG"', 'echo "reusing existing image ${{ inputs.image_tag }}"'),
    ("deploy-staging", "          name: api-image-digest\n", "          name: api-digest\n"),
    ("review-cohort", 'and .event == "workflow_dispatch" and .head_branch == "main"', 'and true'),
    ("deploy-production", 'and .event == "workflow_dispatch" and .head_branch == "main"', 'and true'),
    # 7: the review logins never reach the public log or summary (LR-46 P3-9)
    ("review-cohort", "      IMAGE_TAG: ${{ inputs.image_tag }}\n    steps:\n",
     "      IMAGE_TAG: ${{ inputs.image_tag }}\n      EMAIL_DOMAIN: ${{ inputs.email_domain }}\n    steps:\n"),
    ("review-cohort", 'echo "| run by | ${GITHUB_ACTOR} |"', 'echo "| logins | parent@${EMAIL_DOMAIN} |"'),
    ("review-cohort", 'read -r total created org <<<"$counts"', 'echo "$out"; read -r total created org <<<"$counts"'),
    ("review-cohort", 'echo "::add-mask::$d"', 'true'),
    ("review-cohort", '[ -z "$EMAIL_DOMAIN" ] || echo "::add-mask::$EMAIL_DOMAIN"', 'true'),
]

bad = 0
for k, old, new in MUTATIONS:
    if old not in texts[k]:
        print(f"  FAIL  selftest: the mutation target is gone from {k}: {old[:60]!r}")
        bad = 1
        continue
    mutated = dict(texts, **{k: texts[k].replace(old, new, 1)})
    if not check(mutated):
        print(f"  FAIL  selftest: mutating {k} ({old[:50]!r}) was not caught")
        bad = 1
if not bad:
    print(f"  ok  selftest: each of {len(MUTATIONS)} mutations is caught")

problems = check(texts)
for p in problems:
    print("    " + p)
if problems:
    print("  FAIL  the production image and Environment gates (above)")
    bad = 1
else:
    print("  ok  review cohort and production run only a recorded digest; the cohort refuses an unprotected production Environment")
sys.exit(bad)
PY
