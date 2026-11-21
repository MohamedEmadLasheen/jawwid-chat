-- =============================================================================
-- PD-59 / F7 · the trial a card is about, as a column
--
-- A Sales representative reads a trial card only while its prospect is assigned to them (the owner's
-- decision of 2026-11-21). The card names its trial in payload.trialId; the message read path must
-- test that in ONE database predicate (card -> lesson -> prospect -> owner) instead of shipping a list
-- of message ids from the application. A STORED generated column gives the read path an indexable,
-- uuid-typed handle on it:
--
--   * a payload with no trialId, or one that is not a uuid, yields NULL -- never an error -- and the
--     read path treats NULL as "not the viewer's" (fail closed);
--   * it is derived, so it can never disagree with the payload, and nothing writes it.
--
-- Additive: no existing column, constraint or trigger changes. Adding a STORED generated column
-- rewrites chat.message_card once (a small table: one row per card). Rollback:
-- db/rollback/20261121115000_chat_pd059_card_trial_id.down.sql
-- =============================================================================

alter table chat.message_card
  add column if not exists trial_id uuid generated always as (
    case when payload ->> 'trialId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (payload ->> 'trialId')::uuid end
  ) stored;

comment on column chat.message_card.trial_id is
  'PD-59 / F7: the trial (chat.lesson) a trial card is about, derived from payload.trialId; null if absent or not a uuid. Never written.';
