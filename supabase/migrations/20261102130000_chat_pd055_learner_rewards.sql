-- =============================================================================
-- PD-55 (PR-4) · rewards for children during a lesson
--
-- The owner's request (2026-11-02), decided by the department head and
-- planned in docs/product/pd055-whiteboard-teaching-and-rewards-plan.md §3-§4:
-- a teacher rewards a child -- a star, a sticker, a praise stamp, or a
-- celebration -- during that child's lesson. The family sees it live (the
-- outbox event `learner.reward_given`) and on the lesson's report.
--
--   chat.learner_reward_event   append-only. One row per reward given to one
--                               learner in one lesson by that lesson's teacher.
--                               A mistaken award is withdrawn by an 'undo' row
--                               (same teacher, within 2 minutes) -- never by an
--                               update or a delete, and never shown as a loss.
--
-- The rules, enforced here and again in the API:
--   * the lesson is the learner's, taught by the writer, in the window
--     (rewards.award_window_before/after_minutes), and not cancelled, voided,
--     a no-show, an apology, rescheduled or suspended (outcome null or held);
--   * stickers and praise come from closed catalogues; custom praise is at
--     most 40 characters;
--   * no comparisons: nothing here aggregates across learners.
--
-- Row-level security (the second line; the API decides first): the learner's
-- current teacher inserts, as themself; that teacher, an active contact of the
-- learner's family, and staff who supervise that teacher read. No blanket
-- policy; no update or delete for anyone.
--
-- Rollback: db/rollback/20261102130000_pd055_learner_rewards.down.sql
-- Idempotent where a re-run could meet it (G-19).
-- =============================================================================

create table if not exists chat.learner_reward_event (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  learner_id       uuid not null references chat.learner (id),
  lesson_id        uuid not null references chat.lesson (id),
  teacher_id       uuid not null references chat.teacher (id),
  board_id         uuid references chat.whiteboard (id) on delete set null,
  kind             text not null check (kind in ('star', 'sticker', 'praise', 'celebration', 'undo')),
  sticker_key      text check (sticker_key in (
                     'star', 'medal', 'trophy', 'rocket', 'sun', 'rainbow', 'crown', 'balloon', 'heart', 'thumbs_up', 'check')),
  praise_key       text check (praise_key in (
                     'excellent', 'well_done', 'great', 'champion',
                     'excellent_ar', 'well_done_ar', 'great_ar', 'champion_ar')),
  praise_text      text check (praise_text is null or char_length(btrim(praise_text)) between 1 and 40),
  undoes           uuid references chat.learner_reward_event (id),
  client_event_id  uuid not null,
  created_at       timestamptz not null default now(),
  constraint learner_reward_event_shape check (
    (kind = 'sticker') = (sticker_key is not null)
    and (kind <> 'praise' or ((praise_key is null) <> (praise_text is null)))
    and (kind = 'praise' or (praise_key is null and praise_text is null))
    and (kind = 'undo') = (undoes is not null)
  ),
  constraint learner_reward_event_once unique (teacher_id, client_event_id)
);

create index if not exists learner_reward_event_learner_lesson_idx on chat.learner_reward_event (learner_id, lesson_id);
create index if not exists learner_reward_event_lesson_idx on chat.learner_reward_event (lesson_id);
-- An award is withdrawn at most once.
create unique index if not exists learner_reward_event_undone_once on chat.learner_reward_event (undoes) where kind = 'undo';

comment on table chat.learner_reward_event is
  'PD-55: a reward a teacher gave a learner during a lesson (star, sticker, praise, celebration), or the withdrawal of one (undo, within 2 minutes, by the same teacher). Append-only; read by the teacher, the family and the teacher''s supervisors.';

-- --- The guard: who may record what, when ---------------------------------------------

create or replace function chat.guard_learner_reward_event()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  l record;
  target record;
  v_before integer;
  v_after integer;
begin
  if tg_op = 'UPDATE' then
    raise exception 'a reward is a record; it is never changed' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'a reward is never deleted; an undo withdraws it' using errcode = 'check_violation';
  end if;

  new.created_at := now();

  select ls.id, ls.learner_id, ls.teacher_id, ls.organization_id, ls.starts_at, ls.ends_at, ls.outcome
    into l
    from chat.lesson ls where ls.id = new.lesson_id;
  if l.id is null or l.learner_id is distinct from new.learner_id or l.teacher_id <> new.teacher_id
     or l.organization_id <> new.organization_id then
    raise exception 'a reward belongs to this learner''s lesson, by its teacher' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.learner lr where lr.id = new.learner_id and lr.teacher_id = new.teacher_id) then
    raise exception 'only the learner''s own teacher rewards them' using errcode = 'check_violation';
  end if;

  if new.kind = 'undo' then
    select e.* into target from chat.learner_reward_event e where e.id = new.undoes;
    if target.id is null or target.kind = 'undo' or target.teacher_id <> new.teacher_id
       or target.learner_id <> new.learner_id or target.lesson_id <> new.lesson_id
       or target.created_at < now() - interval '2 minutes' then
      raise exception 'an undo withdraws one of this teacher''s own rewards, within 2 minutes' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if l.outcome is not null and l.outcome <> 'held' then
    raise exception 'rewards count only in a lesson that took place' using errcode = 'check_violation';
  end if;
  select coalesce((select (value #>> '{}')::integer from chat.config where key = 'rewards.award_window_before_minutes'), 10),
         coalesce((select (value #>> '{}')::integer from chat.config where key = 'rewards.award_window_after_minutes'), 30)
    into v_before, v_after;
  if now() < l.starts_at - make_interval(mins => v_before) or now() > l.ends_at + make_interval(mins => v_after) then
    raise exception 'rewards count only during the lesson' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function chat.guard_learner_reward_event_truncate()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if coalesce(current_setting('chat.test_truncate', true), '') = 'on' then
    return null;
  end if;
  raise exception 'rewards are never truncated' using errcode = 'check_violation';
end;
$$;

drop trigger if exists learner_reward_event_is_a_record on chat.learner_reward_event;
create trigger learner_reward_event_is_a_record before insert or update or delete on chat.learner_reward_event
  for each row execute function chat.guard_learner_reward_event();
drop trigger if exists learner_reward_event_no_truncate on chat.learner_reward_event;
create trigger learner_reward_event_no_truncate before truncate on chat.learner_reward_event
  for each statement execute function chat.guard_learner_reward_event_truncate();

-- --- Who may read and write: two questions, asked as the caller -------------------------

-- The writer: the caller IS this teacher, and this teacher is the learner's current teacher.
create or replace function chat.may_reward_learner(p_learner uuid, p_teacher uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select p_teacher in (select chat.current_actor_ids())
     and exists (select 1 from chat.learner l where l.id = p_learner and l.teacher_id = p_teacher)
$$;

-- A reader: the teacher who gave it, an active contact of the learner's family,
-- or staff who supervise the learner's current teacher.
create or replace function chat.may_read_learner_rewards(p_learner uuid, p_teacher uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select p_teacher in (select chat.current_actor_ids())
      or exists (
           select 1 from chat.learner l
             join chat.contact c on c.family_id = l.family_id and c.is_active
            where l.id = p_learner and c.id in (select chat.current_actor_ids()))
      or (chat.current_staff_id() is not null and exists (
           select 1 from chat.learner l
            where l.id = p_learner
              and l.teacher_id in (select chat.staff_supervised_teacher_ids(chat.current_staff_id()))))
$$;

alter table chat.learner_reward_event enable row level security;
revoke all on chat.learner_reward_event from public, anon, authenticated, chat_app;
grant select, insert on chat.learner_reward_event to authenticated;

drop policy if exists learner_reward_event_insert on chat.learner_reward_event;
create policy learner_reward_event_insert on chat.learner_reward_event
  for insert to authenticated
  with check (chat.may_reward_learner(learner_id, teacher_id));

drop policy if exists learner_reward_event_read on chat.learner_reward_event;
create policy learner_reward_event_read on chat.learner_reward_event
  for select to authenticated
  using (chat.may_read_learner_rewards(learner_id, teacher_id));

revoke all on function chat.guard_learner_reward_event() from public;
revoke all on function chat.guard_learner_reward_event_truncate() from public;
revoke all on function chat.may_reward_learner(uuid, uuid) from public;
revoke all on function chat.may_read_learner_rewards(uuid, uuid) from public;
grant execute on function chat.may_reward_learner(uuid, uuid) to authenticated;
grant execute on function chat.may_read_learner_rewards(uuid, uuid) to authenticated;

-- --- Configuration --------------------------------------------------------------------

insert into chat.config (key, value, scope, description) values
  ('rewards.enabled', 'false'::jsonb, 'whiteboards',
   'PD-55: teacher rewards (tray, celebration, star tally). Off until QA has passed in an environment.'),
  ('rewards.lesson_badge_thresholds', '[3, 6, 10]'::jsonb, 'whiteboards',
   'PD-55: the stars in one lesson that earn the Bronze, Silver and Gold badge.'),
  ('rewards.award_window_before_minutes', '10'::jsonb, 'whiteboards',
   'PD-55: rewards count from this many minutes before a lesson starts.'),
  ('rewards.award_window_after_minutes', '30'::jsonb, 'whiteboards',
   'PD-55: rewards count until this many minutes after a lesson ends.')
on conflict (key) do nothing;
