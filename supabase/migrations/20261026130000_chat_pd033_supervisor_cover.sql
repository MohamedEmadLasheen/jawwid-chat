-- PD-33 (2026-10-26) -- "Hand over to backup": a supervisor's temporary cover
-- with an automatic return.
--
-- Record: docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md §4 PD-33 and
-- docs/architecture/ORG-SCOPE-PD8.md §8.
--
-- A COVER IS AN ACTIVATION OF THE EXISTING BACKUP LINK. Starting one sets the
-- pair's chat.supervisor_backup row to activated_at = starts_at and
-- active_until = ends_at, in the same transaction as the cover row, so
-- chat.backup_is_active -> staff_acts_for -> staff_principals already make the
-- backup a principal for the covered supervisor's caseload during the window and
-- not a second after it. Nothing in the PD-8 access chain changes here.
--
-- What this table adds is what the link alone never had: the window as an event
-- with a note and a history, ONE open cover per supervisor, who may be chosen
-- (the eligibility trigger), and the routing input chat.cover_of() -- the away
-- supervisor's pushes go to the backup while it is live (OutboxWorker).
--
-- The return needs no job to end access: active_until does that to the second.
-- The worker's cover sweep only posts the return lines and closes the row.

create table chat.supervisor_cover (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references chat.organization (id),
  primary_id         uuid not null references chat.staff (id),
  backup_id          uuid not null references chat.staff (id),
  backup_link_id     uuid not null references chat.supervisor_backup (id),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  -- The first window's length: "Extend" adds the same again.
  window_seconds     integer not null check (window_seconds > 0),
  note               text check (note is null or length(note) <= 500),
  started_by         uuid not null references chat.staff (id),
  created_at         timestamptz not null default now(),
  -- When the start lines were posted (at once, or by the sweep for a cover
  -- that begins later). NULL = not announced yet.
  start_announced_at timestamptz,
  ended_at           timestamptz,
  ended_by           uuid references chat.staff (id),
  end_kind           text check (end_kind in ('returned', 'ended_early', 'link_ended')),
  constraint supervisor_cover_not_self check (primary_id <> backup_id),
  constraint supervisor_cover_window_is_ordered check (ends_at > starts_at),
  constraint supervisor_cover_end_is_complete
    check ((ended_at is null) = (end_kind is null))
);

comment on table chat.supervisor_cover is
  'PD-33: a supervisor away, their backup covering from starts_at to ends_at. Access is the backup link''s activation (same window); this row is the event, the routing input (chat.cover_of) and the history.';

-- One open cover per supervisor (a future-dated one counts: it is open).
create unique index supervisor_cover_one_open on chat.supervisor_cover (primary_id)
  where ended_at is null;
create index supervisor_cover_backup_open on chat.supervisor_cover (backup_id)
  where ended_at is null;
create index supervisor_cover_due on chat.supervisor_cover (ends_at)
  where ended_at is null;

insert into chat.config (key, value, scope, description) values
('cover.max_concurrent', '2'::jsonb, 'org',
 'PD-33: how many supervisors one backup may cover at the same time. PD-8''s '
 'arrangement is one backup for two primaries, so two at once is the most a '
 'backup is ever expected to carry.'),
('cover.max_days', '30'::jsonb, 'org',
 'PD-33: the longest a cover may run. Longer than this is a change of '
 'supervisor (PD-24), not a cover.')
on conflict (key) do nothing;

-- Who may be chosen, re-checked by the database whatever the API decided:
--   * the supervisor is a primary supervisor of the Operations department;
--   * the backup is an active backup supervisor of THAT department;
--   * the link is this pair's;
--   * the backup is not away themselves and is not already covering
--     cover.max_concurrent supervisors in an overlapping window.
-- The backup's staff row is locked so two covers started at once for the same
-- backup are counted one after the other.
create or replace function chat.guard_supervisor_cover()
returns trigger
language plpgsql
as $$
declare
  v_primary record;
  v_backup  record;
  v_link    record;
  v_max     integer := chat.config_int('cover.max_concurrent');
  v_days    integer := chat.config_int('cover.max_days');
  v_busy    integer;
begin
  if tg_op = 'UPDATE' then
    if new.primary_id <> old.primary_id or new.backup_id <> old.backup_id
       or new.backup_link_id <> old.backup_link_id or new.starts_at <> old.starts_at then
      raise exception 'a cover never changes its people or its start; end it and start another'
        using errcode = 'check_violation';
    end if;
    if old.ended_at is not null then
      raise exception 'an ended cover is history and is never edited' using errcode = 'check_violation';
    end if;
    if new.ends_at <> old.ends_at and new.ends_at > greatest(new.starts_at, now()) + make_interval(days => v_days) then
      raise exception 'a cover runs at most % days', v_days using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select s.id, s.organization_id, d.id as department_id into v_primary
    from chat.staff s
    join chat.department_member m on m.staff_id = s.id and m.position = 'supervisor'
    join chat.department d on d.id = m.department_id and d.kind = 'operations'
   where s.id = new.primary_id;
  if v_primary.id is null then
    raise exception 'only a primary supervisor of the Operations department hands over to a backup'
      using errcode = 'check_violation';
  end if;

  perform 1 from chat.staff where id = new.backup_id for update;
  select s.id, s.organization_id, (s.is_active and s.left_at is null) as live, m.department_id into v_backup
    from chat.staff s
    join chat.department_member m on m.staff_id = s.id and m.position = 'backup_supervisor'
   where s.id = new.backup_id;
  if v_backup.id is null or v_backup.department_id is distinct from v_primary.department_id then
    raise exception 'the cover is a backup supervisor of the same department'
      using errcode = 'check_violation';
  end if;
  if not v_backup.live then
    raise exception 'an inactive staff member cannot cover' using errcode = 'check_violation';
  end if;
  if v_backup.organization_id <> v_primary.organization_id then
    raise exception 'a cover cannot cross organizations' using errcode = 'insufficient_privilege';
  end if;

  select * into v_link from chat.supervisor_backup where id = new.backup_link_id;
  if v_link.id is null or v_link.primary_id <> new.primary_id or v_link.backup_id <> new.backup_id
     or v_link.ended_at is not null then
    raise exception 'a cover runs on this pair''s live backup link' using errcode = 'check_violation';
  end if;

  if new.ends_at > greatest(new.starts_at, now()) + make_interval(days => v_days) then
    raise exception 'a cover runs at most % days', v_days using errcode = 'check_violation';
  end if;

  if exists (select 1 from chat.supervisor_cover c where c.primary_id = new.backup_id and c.ended_at is null) then
    raise exception 'the backup is away themselves' using errcode = 'check_violation';
  end if;
  select count(*) into v_busy
    from chat.supervisor_cover c
   where c.backup_id = new.backup_id and c.ended_at is null
     and tstzrange(c.starts_at, c.ends_at) && tstzrange(new.starts_at, new.ends_at);
  if v_busy >= v_max then
    raise exception 'the backup already covers % supervisors at that time', v_busy
      using errcode = 'check_violation';
  end if;

  new.organization_id := v_primary.organization_id;
  return new;
end;
$$;

create trigger supervisor_cover_is_eligible before insert or update on chat.supervisor_cover
  for each row execute function chat.guard_supervisor_cover();

-- Who covers p_primary at p_at: the backup of a cover whose window holds p_at,
-- not ended by then, AND whose backup link is live (chat.backup_is_active). The
-- link test keeps routing and access one decision: a link deactivated or ended
-- by any path stops the routing at the same moment it stops the access.
create or replace function chat.cover_of(p_primary uuid, p_at timestamptz default now())
returns uuid
language sql
stable
as $$
  select c.backup_id
    from chat.supervisor_cover c
   where c.primary_id = p_primary
     and c.starts_at <= p_at and c.ends_at > p_at
     and (c.ended_at is null or c.ended_at > p_at)
     and chat.backup_is_active(c.primary_id, c.backup_id, p_at)
   limit 1;
$$;

-- Every cover live at p_at, for batch readers (push routing, the chat list's
-- cover line, the Instalments "mine" filter).
create or replace function chat.live_covers(p_at timestamptz default now())
returns table (cover_id uuid, primary_id uuid, backup_id uuid, ends_at timestamptz)
language sql
stable
as $$
  select c.id, c.primary_id, c.backup_id, c.ends_at
    from chat.supervisor_cover c
   where c.starts_at <= p_at and c.ends_at > p_at
     and (c.ended_at is null or c.ended_at > p_at)
     and chat.backup_is_active(c.primary_id, c.backup_id, p_at);
$$;

revoke all on function chat.cover_of(uuid, timestamptz) from public;
revoke all on function chat.live_covers(timestamptz) from public;
revoke all on function chat.guard_supervisor_cover() from public;

alter table chat.supervisor_cover enable row level security;
revoke all on chat.supervisor_cover from public, anon, authenticated, chat_app;

-- Two pushes, staff to staff: the backup when the cover starts, the supervisor
-- when it ends. {day} is the end date in the recipient's own zone
-- (NotificationService.inRecipientZone reads `startsAt`).
insert into chat.notification_template (key, locale, version, title, body)
select v.key, v.locale, 1, v.title, v.body
  from (values
    ('cover_started', 'en', 'Jawwid', 'You''re covering {supervisor}''s {families} families until {day}.'),
    ('cover_started', 'ar', 'جَوِّد', 'أنت تغطي عائلات {supervisor} ({families}) حتى {day}.'),
    ('cover_ended',   'en', 'Jawwid', 'Welcome back: {cover}''s cover has ended and your families are yours again.'),
    ('cover_ended',   'ar', 'جَوِّد', 'مرحبًا بعودتك: انتهت تغطية {cover} وعادت إليك عائلاتك.')
  ) as v(key, locale, title, body)
 where not exists (
   select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale and t.version = 1);
