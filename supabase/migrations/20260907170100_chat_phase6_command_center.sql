-- Jawwid Chat -- Phase 6B: the Manager Command Center.
--
-- Canonical design: docs/recovery/PHASE-6-REPORT.md.
--
-- WHAT THIS IS, AND WHAT IT IS REPLACING
--
-- The brief-era CRM dashboard (`apps/admin-web/src/features/dashboard`) is
-- FROZEN and unrouted: every query behind it calls an endpoint the API does not
-- serve, and Phase 0 scheduled its deletion to a later removal migration
-- (PHASE-0-ADMIN-WEB-RECONCILIATION §2.7). So there is nothing here to rework
-- in place. The Command Center is a new surface built on live data, and the
-- frozen page stays frozen; removing it is not this phase's business.
--
-- THE ONE CONSTRAINT THAT SHAPED EVERY QUERY BELOW
--
-- Workload and attention scoring are DEPRECATED machinery (PD-3, Phase 0):
-- `workload_*`, `attention_*`, `family_state_cache` and the buckets built on
-- them are frozen, and NO NEW CODE MAY DEPEND ON THEM. "Overloaded supervisors"
-- therefore cannot be `workload_units()` with a nicer name.
--
-- It is computed instead from facts that are live and canonical:
--
--   who supervises whom     chat.family_assignment, read live (ScopeService
--                           reads the same table for scope, so the board and
--                           the permission system can never disagree about
--                           whose families these are)
--   what is unanswered      chat.conversation.last_customer_message_at >
--                           last_staff_message_at -- `needsReply()` in
--                           contracts/dto.ts, the console's own definition
--   what awaits a decision  chat.message_approval, decision = 'pending'
--
-- and the thresholds are CONFIG ROWS, not numbers in a component.
--
-- WHY THESE ARE SQL FUNCTIONS AND NOT PRISMA QUERIES
--
-- Eight KPIs and a per-supervisor table over every family in the academy is an
-- aggregation, and doing it in the API means either N+1 queries or pulling the
-- conversation table into Node to count it. Both are the thing the Phase 6
-- brief names outright ("do not load every message/conversation into the
-- browser"). One function per surface, each a single scan, each returning rows
-- the API only has to authorize and serialise.

-- ---------------------------------------------------------------------------
-- 1. Indexes the Command Center's queries actually need
-- ---------------------------------------------------------------------------
--
-- Three, and each supports a query on this page. None is speculative.

-- THE unanswered predicate. A partial index whose predicate IS the definition
-- of "needs a reply", so the KPI is an index scan of the conversations that
-- qualify rather than a scan of every conversation ever created.
create index if not exists conversation_needs_reply_idx
  on chat.conversation (family_id, last_customer_message_at desc)
  where resolved_at is null
    and archived_at is null
    and last_customer_message_at is not null;

-- Open vs closed, per family. `resolved_at is null` is the open half; the index
-- carries the family so the per-supervisor rollup joins on it.
create index if not exists conversation_open_state_idx
  on chat.conversation (family_id)
  where resolved_at is null and archived_at is null;

-- The call KPIs are always "in the last N hours", so the window is the leading
-- column. Outcome is carried so the missed-class-call count is answered from
-- the index alone.
create index if not exists call_window_outcome_idx
  on chat.call (started_at desc, type, outcome);

-- ---------------------------------------------------------------------------
-- 2. Config -- the overload thresholds
-- ---------------------------------------------------------------------------
--
-- TWO thresholds per axis rather than one. "Over the line" and "about to be"
-- need different treatment on a board a manager reads in five seconds: they act
-- on the first and watch the second. One threshold would collapse them and the
-- board would only ever say "fine" or "on fire".
--
-- THE NUMBERS ARE INITIAL HYPOTHESES, NOT THE ACADEMY'S POLICY. Neither the PRD
-- nor any audit states a supervisor's capacity, and the workload engine that
-- once guessed at it is frozen. They are rows precisely so operations can set
-- the real figures from the Command Center's own settings, without a deploy --
-- the same treatment `recording.retention_days` received in Phase 5, and for
-- the same reason.

insert into chat.config (key, value, scope, description) values
  ('command_center.overload_unanswered_warning', '6'::jsonb, 'communication',
   'Conversations awaiting a reply at which a supervisor is shown as at risk. INITIAL HYPOTHESIS -- set the real figure here.'),
  ('command_center.overload_unanswered_high', '12'::jsonb, 'communication',
   'Conversations awaiting a reply at which a supervisor is shown as overloaded. INITIAL HYPOTHESIS.'),
  ('command_center.overload_pending_warning', '3'::jsonb, 'communication',
   'Moderation items awaiting this supervisor at which they are shown as at risk. INITIAL HYPOTHESIS.'),
  ('command_center.overload_pending_high', '6'::jsonb, 'communication',
   'Moderation items awaiting this supervisor at which they are shown as overloaded. INITIAL HYPOTHESIS.'),
  ('command_center.window_hours', '24'::jsonb, 'communication',
   'Trailing window the call and missed-class-call KPIs are counted over.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The KPI header
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER, and the reason matters. Every count here is an aggregate
-- over the WHOLE organization -- that is what makes it a manager's number --
-- and the caller connects as `chat_app`, under RLS. Left to the invoker, the
-- counts would silently narrow to whatever the connection could read and the
-- board would quietly under-report.
--
-- The organization is therefore taken as an ARGUMENT and the API is
-- responsible for the permission check before it calls -- which is exactly the
-- division RLS-STRATEGY.md §2 sets out: AuthorizationService decides, RLS is
-- defence in depth. `search_path` is pinned so a definer function cannot be
-- redirected at a shadowed table.

create or replace function chat.command_center_kpis(
  p_organization_id uuid,
  p_window_hours    integer default 24,
  p_now             timestamptz default now()
)
returns table (
  unanswered_messages   bigint,
  pending_approvals     bigint,
  escalated_approvals   bigint,
  open_conversations    bigint,
  closed_conversations  bigint,
  active_families       bigint,
  calls                 bigint,
  missed_class_calls    bigint
)
language sql
stable
security definer
set search_path = chat, pg_catalog
as $$
  select
    -- UNANSWERED: the console's own definition of "needs a reply", not a new
    -- one. contracts/dto.ts needsReply(): the customer has spoken more
    -- recently than Jawwid has. A conversation nobody has ever replied to
    -- counts, which is the case that matters most.
    (select count(*) from chat.conversation c
      where c.organization_id = p_organization_id
        and c.resolved_at is null
        and c.archived_at is null
        and c.last_customer_message_at is not null
        and (c.last_staff_message_at is null
             or c.last_customer_message_at > c.last_staff_message_at)),

    -- PENDING APPROVALS: items awaiting a moderation decision.
    (select count(*) from chat.message_approval a
       join chat.conversation c on c.id = a.conversation_id
      where c.organization_id = p_organization_id
        and a.decision = 'pending'),

    -- ESCALATED: the subset that has already waited past the threshold. Shown
    -- beside the total rather than instead of it, because "40 pending" and
    -- "40 pending, 12 escalated" call for different actions.
    (select count(*) from chat.message_approval a
       join chat.conversation c on c.id = a.conversation_id
      where c.organization_id = p_organization_id
        and a.decision = 'pending'
        and a.escalated_at is not null),

    -- OPEN: not resolved and not archived. `state` on the row is NOT used --
    -- conversationState() derives it from the timestamps and the column is a
    -- legacy default nothing maintains, so trusting it would report a number
    -- that disagrees with every list in the console.
    (select count(*) from chat.conversation c
      where c.organization_id = p_organization_id
        and c.resolved_at is null and c.archived_at is null),

    -- CLOSED: resolved. Archived is a third thing (the conversation is gone
    -- from the operator's view entirely) and is deliberately in neither count.
    (select count(*) from chat.conversation c
      where c.organization_id = p_organization_id
        and c.resolved_at is not null),

    -- ACTIVE FAMILIES: chat.family_state_is_active() is THE definition
    -- (20260907130000 §2) and is called rather than restated. A second
    -- definition of "active" is how a dashboard starts disagreeing with the
    -- directory.
    (select count(*) from chat.family f
      where f.organization_id = p_organization_id
        and chat.family_state_is_active(f.state)),

    -- CALLS in the window. Real rows from the Phase 5 call table.
    (select count(*) from chat.call cl
      where cl.organization_id = p_organization_id
        and cl.started_at >= p_now - make_interval(hours => p_window_hours)),

    -- MISSED CLASS CALLS: type = 'class' and outcome = 'missed'. Both columns
    -- are written by the Phase 5 missed-call sweeper, so this is a count of
    -- classes where the teacher opened the room and the family never joined --
    -- which is the operational event a manager needs, and not an estimate.
    (select count(*) from chat.call cl
      where cl.organization_id = p_organization_id
        and cl.type = 'class'
        and cl.outcome = 'missed'
        and cl.started_at >= p_now - make_interval(hours => p_window_hours));
$$;

comment on function chat.command_center_kpis is
  'The eight Command Center KPIs, aggregated in one pass per organization. '
  'SECURITY DEFINER because every figure is organization-wide by definition; '
  'the API authorizes the caller before invoking it (RLS-STRATEGY.md 2).';

revoke all on function chat.command_center_kpis(uuid, integer, timestamptz) from public;
grant execute on function chat.command_center_kpis(uuid, integer, timestamptz)
  to chat_app, service_role;

-- ---------------------------------------------------------------------------
-- 4. Supervisor workload
-- ---------------------------------------------------------------------------
--
-- One row per family-facing supervisor, with the numbers a manager needs to
-- see who is drowning -- and, critically, WHY, because a level with no
-- breakdown is an accusation rather than a description
-- (design/screens/manager-dashboard.md §5, and it was right).
--
-- FAMILY COUNT IS REPORTED BUT IS NOT AN OVERLOAD INPUT. The brief-era rule
-- ("family count is never a workload input") survives the deletion of the
-- engine that stated it, and it is still correct: a supervisor with 200 quiet
-- families is not overloaded and one with 20 noisy ones may be.
--
-- The LIVE assignment predicate is copied from ScopeService deliberately --
-- `ended_at is null and (ends_at is null or ends_at > now)` -- so the families
-- counted here are exactly the families that supervisor can actually open.

create or replace function chat.command_center_supervisors(
  p_organization_id uuid,
  p_now             timestamptz default now()
)
returns table (
  staff_id           uuid,
  staff_name         text,
  staff_role         text,
  presence           text,
  families           bigint,
  open_conversations bigint,
  unanswered         bigint,
  unread_messages    bigint,
  pending_approvals  bigint,
  escalated          bigint,
  oldest_wait_ms     bigint
)
language sql
stable
security definer
set search_path = chat, pg_catalog
as $$
  with supervisor as (
    select s.id, s.name, s.role, s.presence
      from chat.staff s
     where s.organization_id = p_organization_id
       and s.is_active
       and s.left_at is null
       -- Departmental staff take no part in family communication (PD-5), so
       -- they have no caseload and would show as permanently idle.
       and s.department is null
       and s.role in ('admin', 'coverage_admin', 'manager', 'super_admin')
  ),
  assigned as (
    select fa.staff_id, fa.family_id
      from chat.family_assignment fa
     where fa.ended_at is null
       and (fa.ends_at is null or fa.ends_at > p_now)
     group by fa.staff_id, fa.family_id
  ),
  conv as (
    select a.staff_id,
           c.id as conversation_id,
           (c.resolved_at is null and c.archived_at is null) as is_open,
           (c.resolved_at is null
            and c.archived_at is null
            and c.last_customer_message_at is not null
            and (c.last_staff_message_at is null
                 or c.last_customer_message_at > c.last_staff_message_at)) as needs_reply,
           c.last_customer_message_at,
           c.last_staff_message_at
      from assigned a
      join chat.conversation c on c.family_id = a.family_id
     where c.organization_id = p_organization_id
  ),
  approvals as (
    select a.staff_id, ap.escalated_at, ap.created_at
      from assigned a
      join chat.conversation c on c.family_id = a.family_id
      join chat.message_approval ap on ap.conversation_id = c.id
     where ap.decision = 'pending'
  )
  select
    s.id, s.name, s.role, s.presence,
    (select count(*) from assigned a where a.staff_id = s.id),
    (select count(*) from conv v where v.staff_id = s.id and v.is_open),
    (select count(*) from conv v where v.staff_id = s.id and v.needs_reply),
    -- UNREAD, defined as messages this supervisor has no read receipt for in
    -- conversations they hold. Counted from chat.message_receipt, which is the
    -- only record of what anyone has actually read -- there is no separate
    -- unread counter to drift from it.
    (select count(*)
       from conv v
       join chat.message m on m.conversation_id = v.conversation_id
       left join chat.message_receipt r
              on r.message_id = m.id and r.actor_id = s.id
      where v.staff_id = s.id
        and m.moderation = 'published'
        and m.deleted_for_all = false
        and m.author_id is distinct from s.id
        and (r.id is null or r.state <> 'read')),
    (select count(*) from approvals ap where ap.staff_id = s.id),
    (select count(*) from approvals ap where ap.staff_id = s.id and ap.escalated_at is not null),
    -- THE OLDEST THING WAITING ON THIS PERSON, in milliseconds. A count says
    -- how much; this says how bad, and they are not the same: seven
    -- conversations from the last ten minutes and one from yesterday morning
    -- are different mornings for a manager.
    (select coalesce(max(
        greatest(
          extract(epoch from (p_now - v.last_customer_message_at)) * 1000,
          0
        )
      )::bigint, 0)
       from conv v where v.staff_id = s.id and v.needs_reply)
  from supervisor s
  order by s.name;
$$;

comment on function chat.command_center_supervisors is
  'Per-supervisor operational load from LIVE data: assignments, unanswered '
  'conversations, unread messages and pending moderation. Deliberately does '
  'NOT read the frozen workload_* engine (PD-3), and deliberately does not '
  'treat family count as a load input.';

revoke all on function chat.command_center_supervisors(uuid, timestamptz) from public;
grant execute on function chat.command_center_supervisors(uuid, timestamptz)
  to chat_app, service_role;

-- ---------------------------------------------------------------------------
-- 5. The drill-down
-- ---------------------------------------------------------------------------
--
-- THE POINT OF THE WHOLE SURFACE. A number a manager cannot open is a vanity
-- metric, and the design rejects them outright: "if a metric has no filtered
-- list behind it, it does not go on this screen".
--
-- This is the list behind "unanswered" and "unread" for one supervisor:
-- the actual conversations, worst wait first, each carrying the family it
-- belongs to so the console can be opened straight at it.

create or replace function chat.command_center_attention(
  p_organization_id uuid,
  p_staff_id        uuid default null,
  p_limit           integer default 50,
  p_now             timestamptz default now()
)
returns table (
  conversation_id       uuid,
  family_id             uuid,
  family_name           text,
  conversation_type     text,
  conversation_title    text,
  supervisor_id         uuid,
  supervisor_name       text,
  waiting_since         timestamptz,
  waiting_ms            bigint,
  pending_approvals     bigint
)
language sql
stable
security definer
set search_path = chat, pg_catalog
as $$
  with assigned as (
    select fa.staff_id, fa.family_id
      from chat.family_assignment fa
     where fa.ended_at is null
       and (fa.ends_at is null or fa.ends_at > p_now)
       and (p_staff_id is null or fa.staff_id = p_staff_id)
     group by fa.staff_id, fa.family_id
  )
  select
    c.id, f.id, f.display_name, c.type, c.title,
    s.id, s.name,
    c.last_customer_message_at,
    (extract(epoch from (p_now - c.last_customer_message_at)) * 1000)::bigint,
    (select count(*) from chat.message_approval ap
      where ap.conversation_id = c.id and ap.decision = 'pending')
  from assigned a
  join chat.family f       on f.id = a.family_id
  join chat.staff s        on s.id = a.staff_id
  join chat.conversation c on c.family_id = a.family_id
 where c.organization_id = p_organization_id
   and c.resolved_at is null
   and c.archived_at is null
   and c.last_customer_message_at is not null
   and (c.last_staff_message_at is null
        or c.last_customer_message_at > c.last_staff_message_at)
 -- Longest wait first. This is the order the manager needs and it is the same
 -- order the approvals queue uses, for the same reason: somebody is waiting on
 -- every one of these and the one who has waited longest is the worst failure.
 order by c.last_customer_message_at asc
 limit least(coalesce(p_limit, 50), 200);
$$;

comment on function chat.command_center_attention is
  'The conversations behind the unanswered KPI, optionally for one supervisor. '
  'Longest wait first. This is what makes a Command Center number clickable '
  'rather than decorative.';

revoke all on function chat.command_center_attention(uuid, uuid, integer, timestamptz) from public;
grant execute on function chat.command_center_attention(uuid, uuid, integer, timestamptz)
  to chat_app, service_role;
