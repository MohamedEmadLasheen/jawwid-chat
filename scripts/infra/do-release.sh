#!/usr/bin/env bash
# Release a resolved app spec to DigitalOcean App Platform. Owner: infrastructure.
#
#   scripts/infra/do-release.sh staging "$RUNNER_TEMP/app-spec.yaml"
#
# Run by the Release step of deploy-staging.yml and deploy-production.yml, after
# the configuration check, the backup and the migrations. The spec it is given
# was produced by `scripts/infra/app-spec.py resolve`; it holds secrets and is
# never printed.
#
# It FAILS LOUDLY, never a silent no-op (ADR-003):
#   * DIGITALOCEAN_ACCESS_TOKEN unset              -> refuse
#   * DIGITALOCEAN_APP_ID unset, FIRST_DEPLOY false -> refuse
#   * DIGITALOCEAN_APP_ID set,   FIRST_DEPLOY true  -> refuse (no second app)
#   * the app id names a different app than the spec (a staging id in the
#     production environment)                      -> refuse
#   * after the deploy, the ACTIVE deployment is not running API_IMAGE_TAG and
#     ADMIN_WEB_IMAGE_TAG                          -> fail
# The last check is the one that matters: "doctl returned 0" is not evidence
# that the new release serves traffic. A failed deployment leaves the previous
# one active, and this compares what is actually active.
#
# Environment:
#   DIGITALOCEAN_ACCESS_TOKEN  required; read by doctl itself, never echoed
#   DIGITALOCEAN_APP_ID        required unless FIRST_DEPLOY=true
#   FIRST_DEPLOY               "true" only for the one run that creates the app
#   DIGITALOCEAN_PROJECT_ID    optional; the project a first deploy lands in
#   API_IMAGE_TAG              the API/worker image tag being released
#   ADMIN_WEB_IMAGE_TAG        the Admin Web image tag being released
set -euo pipefail

ENVIRONMENT="${1:-}"
SPEC="${2:-}"
case "$ENVIRONMENT" in
  staging|production) : ;;
  *) echo "usage: $0 {staging|production} <resolved-spec>" >&2; exit 64 ;;
esac

fail() { echo "::error title=Release refused::$*"; exit 1; }

[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] \
  || fail "DIGITALOCEAN_ACCESS_TOKEN is not set in the $ENVIRONMENT GitHub Environment. Nothing was deployed. See docs/infrastructure/production-readiness.md (owner steps)."
[ -n "${API_IMAGE_TAG:-}" ] || fail "API_IMAGE_TAG is empty"
[ -n "${ADMIN_WEB_IMAGE_TAG:-}" ] || fail "ADMIN_WEB_IMAGE_TAG is empty"
[ -n "$SPEC" ] && [ -s "$SPEC" ] || fail "resolved app spec not found: ${SPEC:-<none>}"
command -v doctl >/dev/null 2>&1 || fail "doctl is not installed"
command -v jq >/dev/null 2>&1 || fail "jq is not installed"

EXPECTED_NAME="jawwid-chat-$ENVIRONMENT"
spec_name="$(sed -n 's/^name: *//p' "$SPEC" | head -1)"
[ "$spec_name" = "$EXPECTED_NAME" ] \
  || fail "the spec names app '$spec_name', expected '$EXPECTED_NAME'"

APP_ID="${DIGITALOCEAN_APP_ID:-}"
FIRST="${FIRST_DEPLOY:-false}"

if [ -z "$APP_ID" ]; then
  [ "$FIRST" = "true" ] || fail "DIGITALOCEAN_APP_ID is not set in the $ENVIRONMENT GitHub Environment. Nothing was deployed. If this app has never been created, re-run with first_deploy=true once; otherwise set the secret to the existing app's id."

  # Refuse to create a duplicate: an app of this name already existing means
  # the secret is what is missing, not the app.
  existing="$(doctl apps list -o json | jq -r --arg n "$EXPECTED_NAME" '[.[]? | select(.spec.name == $n) | .id] | join(" ")')"
  [ -z "$existing" ] \
    || fail "an app named $EXPECTED_NAME already exists ($existing). Set DIGITALOCEAN_APP_ID to it instead of creating another."

  echo "Creating $EXPECTED_NAME (first deploy)"
  create_args=(apps create --spec "$SPEC" --wait -o json)
  [ -n "${DIGITALOCEAN_PROJECT_ID:-}" ] && create_args+=(--project-id "$DIGITALOCEAN_PROJECT_ID")
  APP_ID="$(doctl "${create_args[@]}" | jq -r '.[0].id // empty')"
  [ -n "$APP_ID" ] || fail "doctl apps create returned no app id"
  echo "::notice title=Save the app id::Created $EXPECTED_NAME with id $APP_ID. Set it as the DIGITALOCEAN_APP_ID secret of the $ENVIRONMENT GitHub Environment; every later run requires it."
  {
    echo "### First deploy of $EXPECTED_NAME"
    echo ""
    echo "App id: \`$APP_ID\`. Save it as the \`DIGITALOCEAN_APP_ID\` secret of the"
    echo "\`$ENVIRONMENT\` GitHub Environment. The next run without it is refused."
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
else
  [ "$FIRST" != "true" ] \
    || fail "first_deploy=true but DIGITALOCEAN_APP_ID is already set. Refusing to create a second $EXPECTED_NAME."

  live_name="$(doctl apps get "$APP_ID" -o json | jq -r '.[0].spec.name // empty')"
  [ "$live_name" = "$EXPECTED_NAME" ] \
    || fail "DIGITALOCEAN_APP_ID names app '${live_name:-<not found>}', not '$EXPECTED_NAME'. Wrong environment's secret?"

  echo "Updating $EXPECTED_NAME to api=$API_IMAGE_TAG admin-web=$ADMIN_WEB_IMAGE_TAG"
  # --update-sources makes the platform pull the images even when the spec is
  # byte-identical to the live one (re-running a release); --wait blocks until
  # the deployment settles, either way.
  doctl apps update "$APP_ID" --spec "$SPEC" --update-sources --wait -o json >/dev/null
fi

# What is ACTIVE, not what was requested.
app_json="$(doctl apps get "$APP_ID" -o json)"
phase="$(printf '%s' "$app_json" | jq -r '.[0].active_deployment.phase // empty')"
tag_of() {
  printf '%s' "$app_json" | jq -r --arg c "$1" \
    '[.[0].active_deployment.spec | (.services // [])[], (.workers // [])[] | select(.name == $c) | .image.tag] | first // empty'
}
api_tag="$(tag_of api)"
worker_tag="$(tag_of worker)"
web_tag="$(tag_of admin-web)"

echo "active deployment: phase=${phase:-none} api=${api_tag:-none} worker=${worker_tag:-none} admin-web=${web_tag:-none}"
[ "$phase" = "ACTIVE" ] || fail "the active deployment is in phase '${phase:-none}', not ACTIVE"
[ "$api_tag" = "$API_IMAGE_TAG" ] && [ "$worker_tag" = "$API_IMAGE_TAG" ] \
  || fail "the active deployment runs api=$api_tag worker=$worker_tag, not $API_IMAGE_TAG -- the new deployment did not go live; see the app's deployment log"
[ "$web_tag" = "$ADMIN_WEB_IMAGE_TAG" ] \
  || fail "the active deployment runs admin-web=$web_tag, not $ADMIN_WEB_IMAGE_TAG"

echo "released $EXPECTED_NAME: $API_IMAGE_TAG (admin-web $ADMIN_WEB_IMAGE_TAG)"
