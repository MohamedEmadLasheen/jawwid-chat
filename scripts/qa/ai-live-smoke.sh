#!/usr/bin/env bash
# Jawwid Chat -- the ONE check that needs a real Anthropic credential.
#
# WHY IT IS A SHELL SCRIPT AND NOT A TEST
# ---------------------------------------
# Every automated Phase 7 test runs against a scripted provider, deliberately:
# the properties under test are "does this system refuse when the model
# misbehaves", and a real model that behaved well would let those pass with the
# guard missing. That leaves exactly one thing unproved locally -- that the
# adapter can actually talk to Anthropic -- and that needs a credential.
#
# It lives outside jest so it CANNOT run in CI by accident. CI invokes
# `npm run test:unit` and `npm test`; neither reaches this file. There is no
# workflow step that calls it, and adding one would be a visible change to a
# reviewed file.
#
# WHAT IT NEVER DOES
# ------------------
# It does not print the key, it does not write the key anywhere, and it prints
# no model output beyond whether the shape was valid. The request it sends
# contains no family data: it is a fixed, synthetic question with a synthetic
# approved answer, so a smoke test can never be the thing that exports a real
# conversation to a vendor.
#
#   ANTHROPIC_API_KEY=sk-ant-... bash scripts/qa/ai-live-smoke.sh
#
# Optional: AI_MODEL (default claude-opus-5), AI_TIMEOUT_MS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API="$ROOT/apps/api"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ANTHROPIC_API_KEY is not set." >&2
  echo "This check is OPT-IN and needs a real credential. Nothing else in the" >&2
  echo "test suite does; the assistant degrades to DisabledAiProvider without one." >&2
  exit 2
fi

if [ ! -f "$API/dist/ai/provider/anthropic.provider.js" ]; then
  echo "building apps/api ..."
  (cd "$API" && npm run build >/dev/null)
fi

cd "$API"
node -e '
const { AnthropicAiProvider } = require("./dist/ai/provider/anthropic.provider.js");
const { z } = require("zod");

// A synthetic question against a synthetic approved answer. No real family
// data is ever sent by this script.
const schema = z.object({ answered: z.boolean(), answer: z.string() });

(async () => {
  const provider = new AnthropicAiProvider();
  console.log("provider:", provider.name, "| configured:", AnthropicAiProvider.isConfigured());

  const started = Date.now();
  const result = await provider.complete({
    feature: "faq",
    system: "You answer strictly from the approved answers you are given.",
    instruction:
      "Answer the question using only the approved answer. " +
      "Return JSON: {\"answered\": boolean, \"answer\": string}.",
    untrusted: [
      { label: "approved-answers", text: "[1] Foundation course\nA: Yes, it runs for 8 weeks." },
      { label: "question", text: "Do you offer a foundation course?" },
    ],
    schema,
    maxOutputTokens: 200,
  });
  const ms = Date.now() - started;

  if (result.ok) {
    // The VALUE is deliberately not printed. What is being smoke-tested is the
    // round trip and the schema, not the sentence.
    console.log("OK   model=" + result.model +
                " tokens=" + result.usage.inputTokens + "/" + result.usage.outputTokens +
                " latency=" + ms + "ms schema=valid");
    process.exit(0);
  }
  console.error("FAIL failure=" + result.failure + " detail=" + result.detail + " latency=" + ms + "ms");
  process.exit(1);
})().catch((e) => {
  // The provider contract says it returns failures rather than throwing. If it
  // threw, that is itself the finding.
  console.error("FAIL the provider THREW, which its contract forbids:", e && e.message);
  process.exit(1);
});
'
