# Merge record — Admin Portal call screen onto the integration line (2026-10-19)

**What this is:** a merge of FROZEN work, not a reopen. On 2026-10-19 the product owner
explicitly authorized porting and merging the Admin Portal voice-calls work that was CLOSED /
FROZEN on 2026-10-17 (`ADMIN-PORTAL-VOICE-CALLS-CLOSURE-2026-10-17.md`; its merge was listed
there as a separate task needing approval). Asked which frozen item to lift, the owner selected
**"Call-screen redesign"**. Only what integration requires was changed; no behaviour was added,
removed or redesigned. W4, W7 and the Admin Portal voice-calls work stay CLOSED / FROZEN at the
ported commits below — any new change to them still needs the Critical Defect Reopen Protocol.

- **Source:** `claude/admin-portal-call-screen` @ `93608f0` (branched from rtchat `eabc5c8`).
- **Target:** `integration/admin-profile-2026-10-14-rtchat` @ `0c848c4`.
- **Not ported:** `claude/admin-portal-voice-calls-audit-0c5794` — retired; PR #41 carried what
  mattered from it.

## Ported commits (cherry-picked with `-x`, in order)

| Source | On this branch | What |
|---|---|---|
| `abe155d` | `3f24e45` | Admin Web call screen: 1:1 and Student Group voice calls from the admin chat |
| `017e106` | `cbb511c` | `@Public()` on the signed local-storage route (signature check unchanged) |
| `6b9ddbb` | `4218d7b` | Admin Web floating call window and web voice messages; CSP `STORAGE_ORIGIN` |
| `a91c690` | `f1946ae` | Phone: WhatsApp-style call screen (W7) |
| `a60aa13` | `51d5712` | W7 CLOSED / IMMUTABLE again at `a91c690` |
| `cf74606` | `9825f6d` | W4: a failed media join is always reported, never "Connecting..." forever |
| `ff9c47b` | `1cf17a6` | W4 CLOSED / IMMUTABLE again at `cf74606` |
| `93608f0` | `7d8f9d3` | Admin Portal voice calls CLOSED / FROZEN (closure record) |

## Conflict resolutions

Only `apps/admin-web/src/features/chat/ChatPage.tsx`, twice, both import blocks: the integration
line's `NewFamilyGroupDialog` / `isOperator` imports (PD-8) were kept and the call screen's
`ConversationCallControls` and `VoiceNotePlayer` / `VoiceRecorder` imports added beside them. No
other file conflicted; no code was rewritten.

## Fit to what integration changed since `eabc5c8`

- **PR #41 (no phantom calls; tenant-first call ops).** No code change was needed. The Call
  button renders only on the server's `GET /conversations/:id/call-capability`, which on this
  line runs the same `decideInitiate` as `POST /calls` (including `canStartCallAsParticipant`),
  so an admin who is not a participant gets `canCall:false` and no button. The capability stays
  advisory: `POST /calls` decides again, and a 403/404 refusal (including a tenant-first 404) is
  classified `notAllowed` and shown, never retried and never rung.
- **PD-8 / PD-7.** Visibility is the server's; the client infers nothing from conversation type
  or members (`isGroup` only chooses the "Group call" label).
- **Storage.** The `@Public()` decorator is the only change to `StorageController`. The
  teacher-profile fix "the local signer gets its own public base URL" is not ported here and does
  not touch this controller. Until it lands, local-dev voice-note uploads still need the
  `/api/v1` half of that fix.

## Still open (carried from the closure record §3, unchanged)

Minimum LiveKit server ≥ 1.13 for `livekit-client` 2.22.4; stale ACTIVE calls; on-duty routing
not organization-scoped; performance thresholds; D6 re-check on this lineage; phone "Try again"
on a failed call that still exists; RT-037 staging real-media test.
