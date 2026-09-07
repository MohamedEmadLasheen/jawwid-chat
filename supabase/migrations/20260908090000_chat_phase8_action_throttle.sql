-- Jawwid Chat -- abuse protection for AUTHENTICATED actions. Phase 8.
--
-- WHAT WAS MISSING
-- ----------------
-- 20260907120100 bounded the endpoints reachable WITHOUT a session: login,
-- forgot-password, reset redemption. docs/security/AUTH-THROTTLING.md 5 then
-- said, plainly and correctly, what it did not cover:
--
--   "Authenticated endpoints are not throttled. They are bounded by
--    authorization, and a session that misbehaves can be revoked."
--
-- Authorization answers "may this actor do this at all". It does not answer
-- "may this actor do it four thousand times a minute", and revocation is a
-- human noticing. Between those two sits every abuse case this product actually
-- has: a compromised or malicious staff session flooding a family's thread, a
-- scripted client hammering presigned uploads until the bucket bill is a
-- problem, a broadcast fired repeatedly at every family in the tenant. Each of
-- those is an AUTHORIZED action. Nothing counted them.
--
-- WHY THE SAME TABLE
-- ------------------
-- The counter, the window/block semantics, the single-statement race safety and
-- the hashed keys are all already here and already tested. A second mechanism
-- with its own storage and its own off-by-one is how two limiters disagree
-- during an incident. This extends the CHECK constraint and adds configuration;
-- it changes no existing behaviour.
--
-- WHY POSTGRES IS STILL THE RIGHT PLACE, AND WHERE IT IS NOT
-- ----------------------------------------------------------
-- These actions already write several rows each -- a message writes the message,
-- its receipts and an outbox event -- so one indexed upsert alongside them is
-- not the cost that matters, and a durable limit cannot be cleared by causing a
-- restart.
--
-- It is deliberately NOT used for WebSocket frames. Typing indicators fire per
-- keystroke, and a database write per keystroke would be a self-inflicted
-- denial of service. Frame flooding is bounded in the gateway, per socket, in
-- memory: the resource being protected there is one node's CPU, and a socket
-- lives on exactly one node.

-- ---------------------------------------------------------------------------
-- 1. The scope vocabulary
-- ---------------------------------------------------------------------------
--
-- Every action scope is per ACTOR, not per address. An authenticated caller has
-- something better than an IP: an identity that authorization already resolved,
-- that survives address rotation, and that can be revoked. The *_ip axis exists
-- for the unauthenticated endpoints precisely because they have no identity yet.
alter table chat.auth_throttle drop constraint if exists auth_throttle_scope_check;
alter table chat.auth_throttle add constraint auth_throttle_scope_check
  check (scope in (
    -- unauthenticated (20260907120100)
    'login_ip', 'login_subject', 'reset_request_ip',
    'reset_request_subject', 'reset_redeem_ip',
    -- authenticated actions (Phase 8)
    'message_send_actor',
    'attachment_upload_actor',
    'broadcast_send_actor',
    'story_publish_actor',
    'call_start_actor'
  ));

comment on table chat.auth_throttle is
  'Attempt counters for the unauthenticated endpoints and for expensive '
  'authenticated actions. Keys are hashed; no address, subject or actor id is '
  'recoverable from this table.';

-- ---------------------------------------------------------------------------
-- 2. Policy, as configuration
-- ---------------------------------------------------------------------------
--
-- A separate window from the auth counters, and a much shorter one. Auth
-- throttling asks "is somebody grinding at this account over fifteen minutes";
-- this asks "is this session behaving like a script right now", which is a
-- question about the last minute.
--
-- Every number below is an INITIAL HYPOTHESIS, sized from the shape of the
-- product rather than from measurement, and every one is a chat.config row so
-- that correcting it is an operations change rather than a deploy. They are set
-- well above human use on purpose: a limit that a busy admin can reach during a
-- difficult morning is a limit that gets raised in a panic and then forgotten.
insert into chat.config (key, value, scope, description) values
('abuse.throttle.window_seconds', '60', 'abuse',
 'INITIAL HYPOTHESIS - the rolling window the action counters below are '
 'measured over. Short: this asks whether a session is behaving like a script '
 'right now, not whether somebody is grinding at an account for an hour.'),

('abuse.throttle.block_seconds', '300', 'abuse',
 'INITIAL HYPOTHESIS - how long an actor stays blocked once a counter trips. '
 'Long enough to end a runaway client, short enough that a real person who hit '
 'it by accident is not locked out of their morning.'),

('abuse.throttle.message_send_actor', '60', 'abuse',
 'INITIAL HYPOTHESIS - messages one actor may send per window. One per second '
 'sustained is far above human typing and far below what a script does.'),

('abuse.throttle.attachment_upload_actor', '30', 'abuse',
 'INITIAL HYPOTHESIS - presigned upload grants per actor per window. Each one '
 'authorises a write to object storage, so this bounds spend as well as abuse.'),

('abuse.throttle.broadcast_send_actor', '5', 'abuse',
 'INITIAL HYPOTHESIS - broadcasts per actor per window. A broadcast fans out to '
 'every family in the audience, so it is the most expensive single action in '
 'the product and the one worth bounding hardest.'),

('abuse.throttle.story_publish_actor', '20', 'abuse',
 'INITIAL HYPOTHESIS - story publications per actor per window.'),

('abuse.throttle.call_start_actor', '20', 'abuse',
 'INITIAL HYPOTHESIS - call initiations per actor per window. Each one mints a '
 'media token and reserves a room.'),

('abuse.realtime.frames_per_socket_per_minute', '600', 'abuse',
 'INITIAL HYPOTHESIS - inbound WebSocket frames one socket may send per minute '
 'before it is disconnected. Enforced in the gateway IN MEMORY, not here: a '
 'typing indicator fires per keystroke and a database write per keystroke '
 'would be a self-inflicted denial of service. Ten frames a second is far '
 'above a person typing and far below a loop.')
on conflict (key) do nothing;
