# Task brief: <task-id>

<!--
Written by the lead (Claude) and passed to `scripts/ai/codex-task.sh run --brief`.
Keep it self-contained: the implementer has not seen the conversation.
Never paste secrets, tokens, passwords or production data here.
-->

## Goal
One or two sentences: the outcome, not the steps.

## Context
- Why this change is needed (the bug, the decision, the PD/issue id).
- Relevant files to read first (paths only; do not paste their contents).
- Decisions already made that must not be reopened.

## Scope
- Allowed to change: the paths that must also be passed as `--allow` globs.
- Out of scope: what must not be touched even if it looks related.

## Acceptance criteria
1. Observable behaviour that must hold.
2. Tests that must exist: name the failing-first test.
3. Commands that must pass (also passed as `--test`, so the wrapper re-runs them).

## Constraints
- Risk level: low | medium (high-risk work is never delegated without the owner's recorded approval).
- Anything specific: Arabic and English strings, API compatibility, no new dependencies, etc.
