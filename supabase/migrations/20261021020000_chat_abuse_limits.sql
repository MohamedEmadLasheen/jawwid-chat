-- =============================================================================
-- Abuse limits for AUTHENTICATED actions (Phase 8, rebuilt on main)
-- =============================================================================
--
-- Configuration only: no table, no function, no policy. The counters live in
-- Redis, in the RateLimitStore login rate limiting already uses
-- (apps/api/src/platform/auth/action-throttle.guard.ts); the frame budget lives
-- in memory in the realtime gateway (communication/realtime/frame-budget.ts).
-- This file only seeds the numbers, so correcting one is an operations change
-- rather than a deploy. AppConfigService carries the same values as compiled
-- defaults, so a database without these rows behaves identically.
--
-- Ported from the September lineage (integration/phase7-gate2-ci,
-- 20260908090000_chat_phase8_action_throttle.sql) WITHOUT its Postgres counter
-- table, and without three of its rows:
--   abuse.throttle.block_seconds         main's store is a fixed window; a
--                                        refused actor waits out the window
--                                        (Retry-After), exactly as login does.
--   abuse.throttle.broadcast_send_actor  main has no broadcast route. Story
--                                        publish is the fan-out action, and
--                                        has its own row below.
--   abuse.throttle.ai_generate_actor     main has no AI surface.
--
-- Every number is an INITIAL HYPOTHESIS, sized from the shape of the product
-- rather than from measurement, and set well above human use on purpose: a
-- limit a busy admin can reach on a difficult morning gets raised in a panic and
-- then forgotten. docs/security/ABUSE-LIMITS.md carries the reasoning.
--
-- Idempotent: `on conflict do nothing`, so a re-run never overwrites a value an
-- operator has tuned.

insert into chat.config (key, value, scope, description) values
('abuse.throttle.window_seconds', '60'::jsonb, 'abuse',
 '[hypothesis] The fixed window the authenticated-action counters below are '
 'measured over. Short: it asks whether a session is behaving like a script '
 'right now. A refused actor gets Retry-After = the rest of the window.'),

('abuse.throttle.message_send_actor', '60'::jsonb, 'abuse',
 '[hypothesis] Message sends (and forwards) one actor may make per window. '
 'One per second sustained is far above human typing and far below a script.'),

('abuse.throttle.attachment_upload_actor', '30'::jsonb, 'abuse',
 '[hypothesis] Upload grants (message attachments and story media) per actor '
 'per window. Each one authorises a write to object storage, so this bounds '
 'spend as well as abuse.'),

('abuse.throttle.story_publish_actor', '20'::jsonb, 'abuse',
 '[hypothesis] Story publications per actor per window. A publication fans '
 'out to its whole audience.'),

('abuse.throttle.call_start_actor', '20'::jsonb, 'abuse',
 '[hypothesis] Call starts (POST /calls and scheduled-call joins) per actor '
 'per window. Each one reserves a room and rings every member.'),

('abuse.realtime.frames_per_socket_per_minute', '600'::jsonb, 'abuse',
 '[hypothesis] Inbound WebSocket frames one socket may send per minute before '
 'it is disconnected. Enforced IN MEMORY in the gateway, never per frame in '
 'Redis or here: a typing indicator fires per keystroke.')
on conflict (key) do nothing;
