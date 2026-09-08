-- Jawwid Chat -- Phase 7 audit fix: bound how often one actor may spend money.
--
-- Phase 8 (20260908090000) added the authenticated-abuse gate and applied it to
-- the actions that are expensive to repeat: sending, uploading, broadcasting,
-- publishing, calling. The AI endpoints were not among them, because they did
-- not exist when that list was written.
--
-- They belong on it more than anything already there. Every other throttled
-- action costs a database round trip and some storage; an AI request costs a
-- per-call charge from a third party. An authorized staff session looping on
-- `POST /ai/summaries` with `refresh=true` -- which deliberately bypasses the
-- cache -- is an unbounded bill, and authorization has nothing to say about it.
-- Phase 8's own reasoning applies exactly: authorization answers whether an
-- actor may do a thing, not whether they may do it four thousand times a
-- minute.
--
-- ONE scope for the three generating routes rather than one each. What is being
-- rationed is provider spend, and a caller who exhausts their budget on
-- summaries should not still have a full budget for suggestions. A shared
-- counter is the honest model of a shared cost.
--
-- The SEND route is deliberately NOT given a new scope. It reuses
-- `message_send_actor`, so an AI-assisted send draws down the same budget as a
-- typed one -- see the controller comment for why that closes a real hole.

alter table chat.auth_throttle drop constraint if exists auth_throttle_scope_check;
alter table chat.auth_throttle add constraint auth_throttle_scope_check
  check (scope in (
    'login_ip',
    'login_subject',
    'reset_request_ip',
    -- Do not drop this one. It was missing from the first draft of this
    -- migration, and because the statement above DROPS the constraint before
    -- re-adding it, omitting a scope here does not merely fail to add it -- it
    -- REMOVES it. Two proven consequences:
    --
    --   * on a database where anyone has ever used forgot-password, the ADD
    --     CONSTRAINT fails outright ("is violated by some row") and the
    --     migration aborts;
    --   * on a fresh one it applies, and then every forgot-password request
    --     raises a check violation from inside chat.record_auth_attempt,
    --     because AuthService.requestPasswordReset hits this scope.
    --
    -- It is the per-TARGET axis, the one address rotation cannot avoid
    -- (AUTH-THROTTLING.md §2). Any future migration that restates this list
    -- must copy it from the previous one rather than retyping it.
    'reset_request_subject',
    'reset_redeem_ip',
    'message_send_actor',
    'attachment_upload_actor',
    'broadcast_send_actor',
    'story_publish_actor',
    'call_start_actor',
    'ai_generate_actor'
  ));

insert into chat.config (key, value, scope, description) values
('abuse.throttle.ai_generate_actor', '30', 'abuse',
 'INITIAL HYPOTHESIS - AI generations one actor may request per abuse.throttle.window_seconds, across FAQ, suggestions and summaries together. Lower than message_send because each one costs a third-party charge, and high enough that a supervisor working a queue never notices it.')
on conflict (key) do nothing;
