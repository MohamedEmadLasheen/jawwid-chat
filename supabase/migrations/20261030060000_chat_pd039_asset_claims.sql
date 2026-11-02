-- =============================================================================
-- PD-39 PR-4a follow-up (review of #305): asset claims, so no pooled database
-- connection is held while storage is read or an export is made.
--
-- Confirming an image, composing an export and sweeping an abandoned upload
-- each CLAIM their rows in a short transaction (state 'claimed', a token and a
-- lease), do their storage work outside any transaction, and finish in a
-- second short transaction that only the token's holder can complete. A claim
-- whose holder died runs out with its lease and is swept.
--
-- The sweep backs off per row: a row whose object cannot be deleted waits
-- 1 min, 2, 4 ... up to a day (sweep_retry_at) and never holds up the rest.
-- =============================================================================

alter table chat.whiteboard_asset drop constraint whiteboard_asset_state_check;
alter table chat.whiteboard_asset
  add constraint whiteboard_asset_state_check check (state in ('pending', 'claimed', 'ready')),
  add column claim_token    uuid,
  add column claimed_until  timestamptz,
  add column sweep_attempts integer not null default 0 check (sweep_attempts >= 0),
  add column sweep_retry_at timestamptz;

alter table chat.whiteboard_asset
  add constraint whiteboard_asset_claim check (
    (state = 'claimed') = (claim_token is not null and claimed_until is not null));

-- The sweep's look-up: what is pending or claimed, by when it runs out.
create index whiteboard_asset_unfinished_idx on chat.whiteboard_asset (coalesce(claimed_until, expires_at))
  where state <> 'ready';

comment on column chat.whiteboard_asset.claim_token is
  'PD-39: who holds the row while its storage work runs outside a transaction; only the holder finishes it.';
