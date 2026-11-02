-- PD-46 PR-1: every lesson change is announced (docs/product/pd046-schedule-chat-integration-plan.md §3.2-3.4).
--
--   1. chat.lesson.revision: bumped by a trigger whenever a field a reader sees
--      changes, so a client can order signals and ignore a stale one, and a
--      write that bypasses the API's writer is still counted.
--   2. chat.lesson_change_unannounced: the safety net. EVERY lesson change a
--      reader sees is noted here, by (lesson, revision). The API's writer
--      announces its own changes and deletes exactly the rows it announced, in
--      the same transaction; whatever is left -- a writer that bypassed it, a
--      lesson it did not pass on -- the worker announces within a minute
--      (`change: external`, or one batched `schedule.refreshed` per organization
--      for weekly materialization). A missed change shows up late, never
--      silently, and is never announced twice. (No transaction-wide "I am the
--      writer" flag: it would hide every other lesson changed in that
--      transaction.)
--   3. chat.outbox_event.idempotency_key: `lesson:<id>:<revision>:<change>`, so a
--      retried transaction cannot enqueue the same announcement twice.

-- outbox_event is never pruned: building its index takes a lock that blocks
-- every outbox insert. Fail fast rather than queue behind (or ahead of) live
-- traffic; re-run at a quiet moment if it times out.
set local lock_timeout = '5s';

alter table chat.lesson add column revision bigint not null default 0;
comment on column chat.lesson.revision is
  'PD-46: incremented by lesson_bumps_revision whenever starts_at, ends_at, teacher_id, outcome, kind or learner_id changes. Never set by hand.';

create function chat.lesson_bump_revision()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 0; -- a new lesson starts at 0, whatever the insert said
    return new;
  end if;
  if (new.starts_at, new.ends_at, new.teacher_id, new.outcome, new.kind, new.learner_id)
     is distinct from (old.starts_at, old.ends_at, old.teacher_id, old.outcome, old.kind, old.learner_id) then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision; -- a revision is the trigger's to give, nobody else's
  end if;
  return new;
end
$$;

create trigger lesson_bumps_revision before insert or update on chat.lesson
  for each row execute function chat.lesson_bump_revision();

create table chat.lesson_change_unannounced (
  lesson_id       uuid not null,
  revision        bigint not null,
  organization_id uuid not null,
  teacher_id      uuid not null,
  op              text not null check (op in ('insert', 'update')),
  -- Inserted from a weekly time (materialization): announced as one batched
  -- schedule.refreshed per teacher, never a signal per lesson (plan §2, Q8).
  from_slot       boolean not null,
  recorded_at     timestamptz not null default clock_timestamp(),
  primary key (lesson_id, revision)
);

comment on table chat.lesson_change_unannounced is
  'PD-46: lesson changes made outside the API''s lesson writer, waiting for the worker to announce them (safety net, plan §3.2). Rows are deleted once announced; the inflow says which writer still bypasses LessonWriter.';

create index lesson_change_unannounced_recorded on chat.lesson_change_unannounced (recorded_at);

-- One function per table (the shared-trigger NEW-field rule).
create function chat.lesson_note_unannounced()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.revision = old.revision then
    return null; -- nothing a reader sees changed
  end if;
  insert into chat.lesson_change_unannounced (lesson_id, revision, organization_id, teacher_id, op, from_slot)
  values (new.id, new.revision, new.organization_id, new.teacher_id, lower(tg_op),
          tg_op = 'INSERT' and new.schedule_slot_id is not null)
  on conflict do nothing;
  return null;
end
$$;

create trigger lesson_change_unannounced after insert or update on chat.lesson
  for each row execute function chat.lesson_note_unannounced();

alter table chat.outbox_event add column idempotency_key text;
create unique index outbox_event_idempotency_key on chat.outbox_event (idempotency_key) where idempotency_key is not null;
comment on column chat.outbox_event.idempotency_key is
  'PD-46: an announcement''s identity (lesson:<id>:<revision>:<change>); a second enqueue of the same one is a no-op (ON CONFLICT DO NOTHING). Null for every other event.';

-- The API (owner) only. No request role reads or writes the safety net.
alter table chat.lesson_change_unannounced enable row level security;
revoke all on chat.lesson_change_unannounced from public, anon, authenticated, chat_app;
revoke all on function chat.lesson_bump_revision() from public;
revoke all on function chat.lesson_note_unannounced() from public;
