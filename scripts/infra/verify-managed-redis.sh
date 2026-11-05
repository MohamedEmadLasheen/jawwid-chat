#!/usr/bin/env bash
# Is production's REDIS_URL a managed Valkey cluster, provisioned and locked
# down, before a LAUNCH_PHASE=launch deploy changes anything? (ADR-015)
#
#   DIGITALOCEAN_ACCESS_TOKEN=… DIGITALOCEAN_APP_ID=… REDIS_URL=… \
#     scripts/infra/verify-managed-redis.sh
#
# Run by deploy-production.yml only when LAUNCH_PHASE=launch, after the app spec
# resolved (which already refused an in-app or non-TLS REDIS_URL) and BEFORE the
# backup and the migrations, so a refusal changes nothing. It asks DigitalOcean,
# with doctl, about the cluster REDIS_URL names:
#
#   1  REDIS_URL is rediss:// (TLS) and its host is exactly one DigitalOcean
#      Valkey (or Redis) cluster, public or private hostname
#   2  that cluster is online and in fra1, beside the app
#   3  its eviction policy is noeviction (production-runbook.md §1c)
#   4  its Trusted Sources are set, and every rule is THIS app: nothing else,
#      no IP address, can reach it
#
# Connectivity itself is proven after the release by /health/ready, which fails
# while Redis is unreachable; the runner cannot test it directly, because rule 4
# deliberately keeps it out.
#
# The token needs read access to databases as well as apps. REDIS_URL is a
# secret (it holds the cluster password): this script prints its HOST, never
# the URL, and never a doctl error verbatim.
set -euo pipefail

fail() { echo "::error title=Managed Valkey not ready::$*" >&2; exit 1; }

[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] || fail "DIGITALOCEAN_ACCESS_TOKEN is not set"
[ -n "${DIGITALOCEAN_APP_ID:-}" ] || fail "DIGITALOCEAN_APP_ID is not set: deploy once with LAUNCH_PHASE=review first, so the app exists and its Trusted Source can name it"
[ -n "${REDIS_URL:-}" ] || fail "REDIS_URL is not set"
command -v doctl >/dev/null 2>&1 || fail "doctl is not installed"
command -v jq >/dev/null 2>&1 || fail "jq is not installed"

case "$REDIS_URL" in
  rediss://*) : ;;
  *) fail "REDIS_URL must be rediss:// (TLS); managed Valkey refuses plaintext" ;;
esac
rest="${REDIS_URL#rediss://}"
rest="${rest##*@}"
HOST="${rest%%[:/?]*}"
[ -n "$HOST" ] || fail "REDIS_URL names no host"
case "$HOST" in
  redis | localhost | 127.0.0.1) fail "REDIS_URL names the in-app redis ($HOST), not a managed cluster" ;;
esac
echo "managed valkey: host $HOST"

dbs="$(doctl databases list -o json 2>/dev/null)" \
  || fail "could not list database clusters (does the token have database read access?)"
matches="$(jq -c --arg h "$HOST" '[.[]? | select((.engine == "valkey" or .engine == "redis")
  and ((.connection.host // "") == $h or (.private_connection.host // "") == $h))]' <<<"$dbs")"
count="$(jq 'length' <<<"$matches")"
[ "$count" = "1" ] || fail "expected exactly one Valkey cluster with host $HOST, found $count"
id="$(jq -r '.[0].id' <<<"$matches")"
name="$(jq -r '.[0].name' <<<"$matches")"
engine="$(jq -r '.[0].engine' <<<"$matches")"
status="$(jq -r '.[0].status' <<<"$matches")"
region="$(jq -r '.[0].region' <<<"$matches")"
echo "managed valkey: cluster $name ($engine, $region, $status)"
[ "$status" = "online" ] || fail "cluster $name is $status, not online"
[ "$region" = "fra1" ] || fail "cluster $name is in $region; it must be in fra1, beside the app"

cfg="$(doctl databases configuration get "$id" --engine "$engine" -o json 2>/dev/null)" \
  || fail "could not read cluster $name's configuration"
policy="$(jq -r '[.. | objects | to_entries[] | select(.key | test("maxmemory_policy$")) | .value] | first // empty' <<<"$cfg")"
[ -n "$policy" ] || fail "cluster $name reports no eviction policy; set it to noeviction (production-runbook.md §1c)"
[ "$policy" = "noeviction" ] || fail "cluster $name evicts keys ($policy); set noeviction (production-runbook.md §1c)"
echo "managed valkey: eviction policy noeviction"

rules="$(doctl databases firewalls list "$id" -o json 2>/dev/null)" \
  || fail "could not read cluster $name's Trusted Sources"
total="$(jq '[.[]?] | length' <<<"$rules")"
[ "$total" -gt 0 ] || fail "cluster $name has no Trusted Sources: it is reachable from any address"
others="$(jq --arg app "$DIGITALOCEAN_APP_ID" '[.[]? | select(.type != "app" or .value != $app)] | length' <<<"$rules")"
[ "$others" = "0" ] || fail "cluster $name has $others Trusted Source(s) other than this app; remove them"
echo "managed valkey: Trusted Sources = this app only ($total rule(s))"
echo "managed valkey: ready"
