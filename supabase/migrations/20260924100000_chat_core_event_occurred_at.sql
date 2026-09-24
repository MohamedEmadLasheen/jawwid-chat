-- Jawwid Chat -- the Core ledger learns the difference between two times.
--
-- THE DEFECT THIS CLOSES. chat.core_event recorded only received_at: when the
-- HTTP request arrived. The integration contract section 5 orders every
-- mirrored entity by occurred_at -- the SOURCE time Core puts in the envelope --
-- and the ledger had nowhere to put it, so the processor had to approximate it
-- with received_at. That approximation is wrong in the one case the ordering
-- rule exists for: a backfill. An event that happened yesterday and is
-- delivered today would have been ordered as if it happened today, and would
-- have overwritten newer state.
--
-- The two are different concepts and now have different columns:
--
--   occurred_at   when the thing happened, according to Core. Orders entities.
--   received_at   when Chat received the delivery. Operational only; it orders
--                 nothing and decides nothing.
--
-- NULLABLE, deliberately. Rows recorded before this migration have an UNKNOWN
-- source time. Nothing here invents one for them: back-filling received_at into
-- occurred_at would manufacture a business fact out of a transport detail, and
-- would be indistinguishable afterwards from a real one. The processor refuses
-- such a row and records why, so it stays visible in chat.sync_health rather
-- than being silently applied with a fabricated time. Every row the webhook
-- writes from here on carries a real occurred_at.

alter table chat.core_event
  add column if not exists occurred_at timestamptz;

comment on column chat.core_event.occurred_at is
  'The envelope''s occurred_at: SOURCE time, from Core. This is what orders '
  'mirrored entities (integration contract section 5). NULL only on rows '
  'recorded before the webhook carried it -- their source time is unknown and '
  'is never inferred from received_at.';

comment on column chat.core_event.received_at is
  'When Chat received the delivery. Operational only: it orders nothing. Use '
  'occurred_at for any business decision.';

-- ---------------------------------------------------------------------------
-- chat.record_core_event -- now carries the source time
-- ---------------------------------------------------------------------------
-- The original four-argument form is REPLACED rather than kept alongside a new
-- one. Two overloads would mean two ways to record an event, one of which
-- quietly loses the ordering key -- and the ambiguity would outlive everyone
-- who remembers which is which. Nothing in the repository calls the old form;
-- the webhook added in this phase is its first and only caller.

drop function if exists chat.record_core_event(text, text, jsonb, text);

create or replace function chat.record_core_event(
  p_external_event_id text,
  p_event_type        text default null,
  p_payload           jsonb default '{}'::jsonb,
  p_source            text default 'jawwid_core',
  p_occurred_at       timestamptz default null
)
returns boolean
language plpgsql
as $$
begin
  insert into chat.core_event (source, external_event_id, event_type, payload, occurred_at)
  values (p_source, p_external_event_id, p_event_type, coalesce(p_payload, '{}'::jsonb),
          p_occurred_at);
  return true;
exception when unique_violation then
  -- The delivery layer's half of the two-layer duplicate story: this
  -- (source, external_event_id) has been seen. Whether it was successfully
  -- APPLIED is a different question, answered by processed_at and error -- a
  -- delivery recorded but never applied is retryable, not a duplicate.
  return false;
end;
$$;

comment on function chat.record_core_event(text, text, jsonb, text, timestamptz) is
  'Records one inbound Core delivery. Returns true the first time and false for '
  'a repeat of the same (source, external_event_id). p_occurred_at is the '
  'envelope''s source time and is required for anything the webhook records.';

-- The ledger is the integration boundary's, not a client's. chat.core_event
-- already carries RLS and `authenticated` has only SELECT on it (20260905091200);
-- this makes the same true of the function, so an ordinary session cannot
-- manufacture a Core fact by calling it.
revoke all on function chat.record_core_event(text, text, jsonb, text, timestamptz) from public;
grant execute on function chat.record_core_event(text, text, jsonb, text, timestamptz)
  to service_role;
