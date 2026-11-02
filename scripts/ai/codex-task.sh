#!/usr/bin/env bash
# Backward-compatible entry point (PR #380). The engine moved to
# tools/codex-delegate/codex-delegate, which is also installed globally as
# ~/.local/bin/codex-delegate. Jawwid's own rules live in /.ai-delegation.json.
# This copy runs the repository's engine, so a checkout always uses the engine
# its own tests were written against.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/tools/codex-delegate/codex-delegate" "$@"
