-- PD-35 (2026-10-26), part 3 -- report correction requests, teacher evaluations
-- and improvement plans.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-35.
--
-- WHAT IS NEW
--
--   chat.report_correction_request
--                          "Request correction" on a lesson report (or "the
--                          report is missing"), with a reason, as a task for the
--                          lesson's teacher. The teacher answers through PD-15's
--                          recorded edit (or by filing the report); the request is
--                          resolved BY THE DATABASE in that same transaction, with
--                          the version it asked about and the version that answered
--                          it, so the change is the two PD-15 revisions apart. A
--                          supervisor never edits silently: their own PD-15 edit is
--                          recorded, and resolves a request as 'staff'.
--   chat.evaluation_criterion
--                          what an evaluation scores (1-5): rows per organization,
--                          renamed or retired by the Teachers Manager, never deleted.
--   chat.teacher_evaluation
--                          an evaluation of a teacher for a period: scores, notes,
--                          recommendations. Append-only: a correction is a new row
--                          that supersedes the old.
--   chat.teacher_improvement_plan, _goal, _goal_update
--                          an improvement plan of goals with due dates; a goal's
--                          status is its latest update (open | met | missed |
--                          dropped). Append-only.
--   *_share                an evaluation or a plan is the teacher's to read only
--                          once a supervisor shares it (owner Q4); sharing posts a
--                          card in the teacher's supervision conversation.
--
-- FAIL CLOSED. RLS on, no grant to any request role.

-- ===========================================================================
-- 1. Report correction requests
-- ===========================================================================

create table chat.report_correction_request (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references chat.organization (id),
  lesson_id         uuid not null references chat.lesson (id),
  teacher_id        uuid not null references chat.teacher (id),
  -- missing     the lesson has no live report: "please file it"
  -- correction  the live report needs a change: "please correct it"
  kind              text not null check (kind in ('missing', 'correction')),
  reason            text not null check (length(btrim(reason)) between 1 and 500),
  -- Which parts, as the report form names them (advisory; the reason says it all).
  fields            text[] not null default '{}' check (cardinality(fields) <= 12),
  requested_by      uuid not null references chat.staff (id),
  requested_at      timestamptz not null default now(),
  -- The report's version the request was about (a correction only).
  asked_version     integer,
  resolved_at       timestamptz,
  resolution        text check (resolution in ('corrected', 'filed', 'withdrawn')),
  resolved_version  integer,
  resolved_by_kind  text check (resolved_by_kind in ('teacher', 'staff')),
  resolved_by       uuid,
  constraint report_correction_resolution_shape check ((resolved_at is null) = (resolution is null)),
  constraint report_correction_asks_a_version check ((kind = 'correction') = (asked_version is not null))
);

comment on table chat.report_correction_request is
  'PD-35: a request that a lesson''s teacher files or corrects its report. Resolved by the database when the report is filed or edited.';

create unique index report_correction_one_open
  on chat.report_correction_request (lesson_id) where resolved_at is null;
create index report_correction_teacher_idx
  on chat.report_correction_request (teacher_id, requested_at desc);

create or replace function chat.guard_report_correction_request()
returns trigger
language plpgsql
as $$
declare
  v_lesson chat.lesson%rowtype;
  v_report record;
begin
  if tg_op = 'DELETE' then
    raise exception 'a correction request is never deleted; it is withdrawn' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if old.resolved_at is not null then
      raise exception 'a resolved correction request is a record' using errcode = 'check_violation';
    end if;
    if (new.id, new.organization_id, new.lesson_id, new.teacher_id, new.kind, new.reason, new.fields,
        new.requested_by, new.requested_at, new.asked_version)
       is distinct from
       (old.id, old.organization_id, old.lesson_id, old.teacher_id, old.kind, old.reason, old.fields,
        old.requested_by, old.requested_at, old.asked_version) then
      raise exception 'only a correction request''s resolution changes' using errcode = 'check_violation';
    end if;
    if new.resolved_at is null then
      raise exception 'a correction request changes only to be resolved' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select * into v_lesson from chat.lesson where id = new.lesson_id;
  if v_lesson.id is null or v_lesson.kind = 'trial' then
    raise exception 'a correction request is about a lesson' using errcode = 'foreign_key_violation';
  end if;
  if not chat.can_correct_lessons(new.requested_by, v_lesson.organization_id) then
    raise exception 'a correction is requested by the Teachers or Operations department' using errcode = 'insufficient_privilege';
  end if;
  select version, deleted_at into v_report from chat.lesson_report where lesson_id = new.lesson_id;
  if new.kind = 'correction' then
    if v_report.version is null or v_report.deleted_at is not null then
      raise exception 'there is no report to correct' using errcode = 'check_violation';
    end if;
    new.asked_version := v_report.version;
  else
    if v_report.version is not null and v_report.deleted_at is null then
      raise exception 'the report is not missing' using errcode = 'check_violation';
    end if;
    if v_lesson.starts_at > now() then
      raise exception 'a report is owed only once the lesson has started' using errcode = 'check_violation';
    end if;
    if v_lesson.outcome is not null and v_lesson.outcome <> 'held' then
      raise exception 'this lesson owes no report' using errcode = 'check_violation';
    end if;
    new.asked_version := null;
  end if;
  if new.resolved_at is not null then
    raise exception 'a correction request is opened, then resolved' using errcode = 'check_violation';
  end if;
  new.organization_id := v_lesson.organization_id;
  new.teacher_id := v_lesson.teacher_id;
  new.requested_at := now();
  return new;
end;
$$;

create trigger report_correction_request_is_coherent
  before insert or update or delete on chat.report_correction_request
  for each row execute function chat.guard_report_correction_request();

-- A report filed, edited or resent answers the open request, in the same
-- transaction: who answered it is the PD-15 revision written with it (or the
-- report's own author when it is filed).
create or replace function chat.resolve_report_correction()
returns trigger
language plpgsql
as $$
declare
  v_by_kind text;
  v_by      uuid;
begin
  if new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' and new.version = old.version and old.deleted_at is null then return new; end if;
  select r.by_kind, r.by_id into v_by_kind, v_by
    from chat.lesson_report_revision r
   where r.lesson_id = new.lesson_id and r.txid = txid_current()
   order by r.at desc limit 1;
  if v_by is null then
    v_by_kind := new.entered_by_kind;
    v_by := new.entered_by;
  end if;
  update chat.report_correction_request q
     set resolved_at = now(),
         resolution = case q.kind when 'missing' then 'filed' else 'corrected' end,
         resolved_version = new.version,
         resolved_by_kind = v_by_kind,
         resolved_by = v_by
   where q.lesson_id = new.lesson_id and q.resolved_at is null;
  return new;
end;
$$;

-- Any update, not "update of version": PD-15 bumps the version in a BEFORE
-- trigger, and a column list fires only for columns the statement itself sets.
create trigger lesson_report_resolves_correction
  after insert or update on chat.lesson_report
  for each row execute function chat.resolve_report_correction();

-- ===========================================================================
-- 2. Evaluation criteria
-- ===========================================================================

create table chat.evaluation_criterion (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references chat.organization (id),
  label_en        text not null check (length(btrim(label_en)) between 1 and 80),
  label_ar        text not null check (length(btrim(label_ar)) between 1 and 80),
  position        integer not null default 0 check (position between 0 and 999),
  is_active       boolean not null default true,
  updated_by      uuid references chat.staff (id),
  updated_at      timestamptz not null default now()
);

comment on table chat.evaluation_criterion is
  'PD-35: what a teacher evaluation scores, 1-5. Renamed or retired by the Teachers Manager; never deleted (old evaluations name it).';

create index evaluation_criterion_org_idx on chat.evaluation_criterion (organization_id, position);

create or replace function chat.forbid_criterion_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'a criterion is retired, never deleted' using errcode = 'check_violation';
end;
$$;

create trigger evaluation_criterion_never_deleted before delete on chat.evaluation_criterion
  for each row execute function chat.forbid_criterion_delete();

-- The seven the owner approved (Q4), for an organization that has none yet.
create or replace function chat.ensure_evaluation_criteria(p_org uuid)
returns void
language sql
as $$
  insert into chat.evaluation_criterion (organization_id, label_en, label_ar, position)
  select p_org, d.en, d.ar, d.pos
    from (values
      ('Recitation and tajweed accuracy', 'دقة التلاوة والتجويد', 1),
      ('Lesson preparation', 'التحضير للحصة', 2),
      ('Punctuality', 'الالتزام بالمواعيد', 3),
      ('Report quality', 'جودة التقارير', 4),
      ('Student engagement', 'تفاعل الطالب', 5),
      ('Communication', 'التواصل', 6),
      ('Student progress', 'تقدم الطالب', 7)
    ) as d(en, ar, pos)
   where not exists (select 1 from chat.evaluation_criterion c where c.organization_id = p_org);
$$;

select chat.ensure_evaluation_criteria(o.id) from chat.organization o;

-- ===========================================================================
-- 3. Evaluations
-- ===========================================================================

create table chat.teacher_evaluation (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  teacher_id       uuid not null references chat.teacher (id),
  period_from      date not null,
  period_to        date not null,
  -- { "<criterion id>": 1..5, ... }
  scores           jsonb not null check (jsonb_typeof(scores) = 'object'),
  notes            text check (notes is null or length(btrim(notes)) between 1 and 4000),
  recommendations  text check (recommendations is null or length(btrim(recommendations)) between 1 and 4000),
  author_id        uuid not null references chat.staff (id),
  created_at       timestamptz not null default now(),
  supersedes_id    uuid unique references chat.teacher_evaluation (id),
  constraint teacher_evaluation_period check (period_to >= period_from)
);

comment on table chat.teacher_evaluation is
  'PD-35: a teacher evaluation for a period. Append-only; a correction supersedes it.';

create index teacher_evaluation_teacher_idx on chat.teacher_evaluation (teacher_id, created_at desc);

create or replace function chat.guard_teacher_evaluation()
returns trigger
language plpgsql
as $$
declare
  v_org uuid;
  k     text;
  v     jsonb;
  n     integer := 0;
begin
  select organization_id into v_org from chat.teacher where id = new.teacher_id;
  if v_org is null then
    raise exception 'an evaluation is about a teacher' using errcode = 'foreign_key_violation';
  end if;
  if not chat.is_lesson_manager(new.author_id, v_org) then
    raise exception 'an evaluation is written by the Teachers department' using errcode = 'insufficient_privilege';
  end if;
  for k, v in select * from jsonb_each(new.scores) loop
    if not exists (select 1 from chat.evaluation_criterion c
                    where c.id::text = k and c.organization_id = v_org and c.is_active) then
      raise exception 'an evaluation scores the organization''s active criteria' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not in (1, 2, 3, 4, 5) then
      raise exception 'a score is a whole number from 1 to 5' using errcode = 'check_violation';
    end if;
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'an evaluation scores at least one criterion' using errcode = 'check_violation';
  end if;
  if new.supersedes_id is not null and not exists (
    select 1 from chat.teacher_evaluation e where e.id = new.supersedes_id and e.teacher_id = new.teacher_id
  ) then
    raise exception 'an evaluation supersedes one of the same teacher' using errcode = 'check_violation';
  end if;
  new.organization_id := v_org;
  new.created_at := now();
  return new;
end;
$$;

create trigger teacher_evaluation_is_coherent before insert on chat.teacher_evaluation
  for each row execute function chat.guard_teacher_evaluation();
create trigger teacher_evaluation_is_append_only before update or delete on chat.teacher_evaluation
  for each row execute function chat.forbid_change();

create table chat.teacher_evaluation_share (
  evaluation_id uuid primary key references chat.teacher_evaluation (id),
  shared_by     uuid not null references chat.staff (id),
  shared_at     timestamptz not null default now()
);

create trigger teacher_evaluation_share_is_append_only before update or delete on chat.teacher_evaluation_share
  for each row execute function chat.forbid_change();

-- ===========================================================================
-- 4. Improvement plans
-- ===========================================================================

create table chat.teacher_improvement_plan (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references chat.organization (id),
  teacher_id       uuid not null references chat.teacher (id),
  evaluation_id    uuid references chat.teacher_evaluation (id),
  title            text not null check (length(btrim(title)) between 1 and 200),
  author_id        uuid not null references chat.staff (id),
  created_at       timestamptz not null default now()
);

create index teacher_improvement_plan_teacher_idx on chat.teacher_improvement_plan (teacher_id, created_at desc);

create or replace function chat.guard_teacher_improvement_plan()
returns trigger
language plpgsql
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from chat.teacher where id = new.teacher_id;
  if v_org is null then
    raise exception 'a plan is about a teacher' using errcode = 'foreign_key_violation';
  end if;
  if not chat.is_lesson_manager(new.author_id, v_org) then
    raise exception 'an improvement plan is written by the Teachers department' using errcode = 'insufficient_privilege';
  end if;
  if new.evaluation_id is not null and not exists (
    select 1 from chat.teacher_evaluation e where e.id = new.evaluation_id and e.teacher_id = new.teacher_id
  ) then
    raise exception 'a plan follows an evaluation of the same teacher' using errcode = 'check_violation';
  end if;
  new.organization_id := v_org;
  new.created_at := now();
  return new;
end;
$$;

create trigger teacher_improvement_plan_is_coherent before insert on chat.teacher_improvement_plan
  for each row execute function chat.guard_teacher_improvement_plan();
create trigger teacher_improvement_plan_is_append_only before update or delete on chat.teacher_improvement_plan
  for each row execute function chat.forbid_change();

create table chat.teacher_improvement_plan_share (
  plan_id    uuid primary key references chat.teacher_improvement_plan (id),
  shared_by  uuid not null references chat.staff (id),
  shared_at  timestamptz not null default now()
);

create trigger teacher_improvement_plan_share_is_append_only before update or delete on chat.teacher_improvement_plan_share
  for each row execute function chat.forbid_change();

create table chat.teacher_improvement_goal (
  id        uuid primary key default gen_random_uuid(),
  plan_id   uuid not null references chat.teacher_improvement_plan (id),
  position  integer not null check (position between 1 and 50),
  body      text not null check (length(btrim(body)) between 1 and 1000),
  due_on    date,
  unique (plan_id, position)
);

create trigger teacher_improvement_goal_is_append_only before update or delete on chat.teacher_improvement_goal
  for each row execute function chat.forbid_change();

create table chat.teacher_improvement_goal_update (
  id       uuid primary key default gen_random_uuid(),
  goal_id  uuid not null references chat.teacher_improvement_goal (id),
  status   text not null check (status in ('open', 'met', 'missed', 'dropped')),
  note     text check (note is null or length(btrim(note)) between 1 and 1000),
  by_id    uuid not null references chat.staff (id),
  at       timestamptz not null default now()
);

create index teacher_improvement_goal_update_goal_idx on chat.teacher_improvement_goal_update (goal_id, at desc);

create trigger teacher_improvement_goal_update_is_append_only before update or delete on chat.teacher_improvement_goal_update
  for each row execute function chat.forbid_change();

-- ===========================================================================
-- 5. Cards
-- ===========================================================================

insert into chat.message_card_kind (kind) values
  ('report_correction_requested'), ('evaluation_shared'), ('improvement_plan_shared')
on conflict do nothing;

-- ===========================================================================
-- 6. Fail closed
-- ===========================================================================

alter table chat.report_correction_request      enable row level security;
alter table chat.evaluation_criterion           enable row level security;
alter table chat.teacher_evaluation             enable row level security;
alter table chat.teacher_evaluation_share       enable row level security;
alter table chat.teacher_improvement_plan       enable row level security;
alter table chat.teacher_improvement_plan_share enable row level security;
alter table chat.teacher_improvement_goal       enable row level security;
alter table chat.teacher_improvement_goal_update enable row level security;

revoke all on chat.report_correction_request, chat.evaluation_criterion, chat.teacher_evaluation,
              chat.teacher_evaluation_share, chat.teacher_improvement_plan, chat.teacher_improvement_plan_share,
              chat.teacher_improvement_goal, chat.teacher_improvement_goal_update
  from public, anon, authenticated, chat_app;

revoke all on function chat.guard_report_correction_request() from public;
revoke all on function chat.resolve_report_correction() from public;
revoke all on function chat.forbid_criterion_delete() from public;
revoke all on function chat.ensure_evaluation_criteria(uuid) from public;
revoke all on function chat.guard_teacher_evaluation() from public;
revoke all on function chat.guard_teacher_improvement_plan() from public;
