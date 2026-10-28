-- =============================================================================
-- PD-41 · Appreciation certificates: the Certificates page (PR-1, API + data)
--
-- Design (owner-approved 2026-10-28, seven safeguards):
--   docs/product/pd041-certificates-design.md §0, §3, §4, §14
--
-- PD-12's chat.learner_certificate becomes chat.appreciation_certificate. It is
-- the ONE certificate record (boundary doc §4 PD-12, "the only certificate
-- model"), now for two categories -- a student's and a teacher's -- with a type
-- catalogue the super admin keeps, a design workflow, a review that approves one
-- exact revision, one delivery, and an optional Story behind recorded family
-- consent:
--
--   proposed (a teacher's suggestion) -> requested -> in_design -> uploaded
--     -> approved -> sent;  side paths changes_requested, cancelled, declined.
--
-- EVERY write to a certificate carries the act that made it (last_action, its
-- note, its actor) and bumps action_seq by exactly one. The BEFORE trigger
-- refuses an act the state machine, the actor or the record does not allow; the
-- AFTER trigger writes the act into the append-only history. No transition, no
-- edit and no consent change can therefore happen without its history row --
-- not even by a direct SQL write.
--
-- Server-only, as PD-12 was: RLS on, no grant to any request role. Jawwid Core
-- is not touched.
-- =============================================================================

-- ===========================================================================
-- 1. Categories (fixed, code-coupled) and types (per organization, data)
-- ===========================================================================

create table chat.certificate_category (
  key            text primary key check (key ~ '^[a-z][a-z_]{1,30}$'),
  recipient_kind text not null check (recipient_kind in ('learner', 'teacher')),
  -- Where a certificate of the category is delivered (the server picks it):
  --   learner_group        the learner's student group, else a family group about them (PD-12)
  --   teacher_supervision  the teacher's own supervision conversation (no teachers' group exists)
  delivery_rule  text not null check (delivery_rule in ('learner_group', 'teacher_supervision')),
  -- The Stories v2 audience of the category's optional Story.
  story_audience text not null check (story_audience in ('all_families', 'all_teachers')),
  -- A student Story needs recorded family consent (owner safeguard 4).
  story_needs_consent boolean not null,
  label_en       text not null,
  label_ar       text not null,
  sort           smallint not null
);

comment on table chat.certificate_category is
  'PD-41: who a certificate is for. A new category is a row here plus its permission and its delivery rule in code.';

insert into chat.certificate_category (key, recipient_kind, delivery_rule, story_audience, story_needs_consent, label_en, label_ar, sort) values
  ('student', 'learner', 'learner_group', 'all_families', true, 'Students', 'الطلاب', 1),
  ('teacher', 'teacher', 'teacher_supervision', 'all_teachers', false, 'Teachers', 'المعلمون', 2);

create table chat.certificate_type (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references chat.organization (id),
  category        text not null references chat.certificate_category (key),
  key             text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_en        text not null check (length(btrim(label_en)) between 1 and 80),
  label_ar        text not null check (length(btrim(label_ar)) between 1 and 80),
  -- What the request form asks for: the Juz' (1-30) and/or an award period.
  needs_juz       boolean not null default false,
  needs_period    text check (needs_period in ('month', 'term', 'year')),
  is_active       boolean not null default true,
  sort            smallint not null default 0,
  created_by      uuid references chat.staff (id),
  created_at      timestamptz not null default now(),
  disabled_at     timestamptz,
  disabled_by     uuid references chat.staff (id),
  unique (organization_id, category, key),
  constraint certificate_type_disabled_is_whole check (is_active = (disabled_at is null))
);

comment on table chat.certificate_type is
  'PD-41: a kind of recognition, per organization. The super admin enables and disables types (owner safeguard 6); a type is never deleted, so every certificate keeps its label.';

create or replace function chat.guard_certificate_type()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a certificate type is never deleted; disable it' using errcode = 'check_violation';
  end if;
  if (new.id, new.organization_id, new.category, new.key, new.created_by, new.created_at)
     is distinct from (old.id, old.organization_id, old.category, old.key, old.created_by, old.created_at) then
    raise exception 'a certificate type''s identity is written once' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger certificate_type_is_kept before update or delete on chat.certificate_type
  for each row execute function chat.guard_certificate_type();

-- The organizations that exist today start with the first-cut list; the
-- academic team's list (PD-12 open item 2) replaces it through the Admin Web.
insert into chat.certificate_type (organization_id, category, key, label_en, label_ar, needs_juz, needs_period, sort)
select o.id, t.category, t.key, t.label_en, t.label_ar, t.needs_juz, t.needs_period, t.sort
  from chat.organization o
 cross join (values
   ('student', 'juz_completed',      'Juz'' completed',          'إتمام جزء',             true,  null::text, 1),
   ('student', 'surah_memorised',    'Surah memorised',          'حفظ سورة',              false, null,       2),
   ('student', 'excellence',         'Excellence',               'تميّز',                 false, null,       3),
   ('student', 'perfect_attendance', 'Perfect attendance',       'انتظام في الحضور',      false, null,       4),
   ('student', 'good_conduct',       'Good conduct',             'حسن السلوك',            false, null,       5),
   ('teacher', 'teacher_of_month',   'Best Teacher of the Month', 'المعلم المثالي للشهر', false, 'month',    1),
   ('teacher', 'excellence',         'Excellence',               'تميّز',                 false, null,       2),
   ('teacher', 'years_of_service',   'Years of service',         'سنوات الخدمة',          false, null,       3)
 ) as t(category, key, label_en, label_ar, needs_juz, needs_period, sort);

-- ===========================================================================
-- 2. The certificate: PD-12's record, widened in place
-- ===========================================================================

drop trigger learner_certificate_is_coherent on chat.learner_certificate;
drop trigger learner_certificate_is_kept on chat.learner_certificate;
drop function chat.guard_learner_certificate();
drop function chat.forbid_learner_certificate_delete();

alter table chat.learner_certificate rename to appreciation_certificate;
alter index chat.learner_certificate_open_idx rename to appreciation_certificate_open_idx;
alter index chat.learner_certificate_learner_idx rename to appreciation_certificate_learner_idx;

alter table chat.appreciation_certificate
  drop constraint learner_certificate_decision_is_whole,
  drop constraint learner_certificate_declined_has_a_reason,
  drop constraint learner_certificate_issued_has_its_file,
  drop constraint learner_certificate_file_lives_in_its_conversation,
  drop constraint learner_certificate_issued_message_only_when_issued,
  drop constraint learner_certificate_state_check;

alter table chat.appreciation_certificate rename column requested_by to suggested_by_teacher;
alter table chat.appreciation_certificate rename column note to internal_note;
alter table chat.appreciation_certificate rename column issued_message_id to sent_message_id;

alter table chat.appreciation_certificate
  alter column learner_id drop not null,
  alter column suggested_by_teacher drop not null,
  alter column achieved_on drop not null,
  add column category              text not null default 'student' references chat.certificate_category (key),
  add column type_id               uuid references chat.certificate_type (id),
  add column recipient_teacher_id  uuid references chat.teacher (id),
  -- The student certificate's "teacher" line: the learner's teacher when it was requested.
  add column signatory_teacher_id  uuid references chat.teacher (id),
  add column requested_by_staff    uuid references chat.staff (id),
  add column request_key           uuid,
  add column juz                   smallint check (juz is null or juz between 1 and 30),
  add column period_start          date,
  add column period_end            date,
  add column designer_note         text check (designer_note is null or length(btrim(designer_note)) between 1 and 1000),
  add column publish_story         boolean not null default false,
  add column assigned_designer_id  uuid references chat.staff (id),
  add column design_started_at     timestamptz,
  add column current_file_id       uuid,
  add column approved_file_id      uuid,
  add column approved_by           uuid references chat.staff (id),
  add column approved_at           timestamptz,
  add column return_message        text check (return_message is null or length(btrim(return_message)) between 10 and 1000),
  add column sent_at               timestamptz,
  add column sent_by               uuid references chat.staff (id),
  add column story_id              uuid unique references chat.story (id),
  add column story_published_at    timestamptz,
  add column story_published_by    uuid references chat.staff (id),
  add column story_withdrawn_at    timestamptz,
  add column cancelled_by          uuid references chat.staff (id),
  add column cancelled_at          timestamptz,
  add column cancel_reason         text check (cancel_reason is null or length(btrim(cancel_reason)) between 10 and 1000),
  -- The act this write records (section 4). Every write bumps action_seq by one.
  add column action_seq            integer not null default 1,
  add column last_action           text,
  add column last_note             text check (last_note is null or length(btrim(last_note)) between 1 and 1000),
  add column last_actor_staff      uuid references chat.staff (id),
  add column last_actor_teacher    uuid references chat.teacher (id),
  add column updated_at            timestamptz not null default now();

comment on column chat.appreciation_certificate.decided_by is
  'PD-41: who accepted or declined a teacher''s suggestion (PD-12: who decided the ticket).';
comment on column chat.appreciation_certificate.decline_reason is
  'PD-41: why a teacher''s suggestion was declined.';
comment on column chat.appreciation_certificate.conversation_id is
  'PD-41: the group the certificate was sent into (the server picks it).';

-- ---------------------------------------------------------------------------
-- The design revisions. PD-12's issued file becomes revision 1 of its row.
-- ---------------------------------------------------------------------------
create table chat.appreciation_certificate_file (
  id                   uuid primary key default gen_random_uuid(),
  certificate_id       uuid not null references chat.appreciation_certificate (id),
  revision             integer not null check (revision >= 1),
  -- A pinned copy no upload grant can name (section 6); PD-12's delivered keys
  -- are kept as they were.
  object_key           text not null unique
    check (object_key ~ '^(certificates/[0-9a-f-]{36}/[0-9a-f-]{36}/v|conversations/[0-9a-f-]{36})/[^/]+$'),
  mime_type            text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  byte_size            integer not null check (byte_size between 1 and 20971520),
  file_name            text not null check (length(btrim(file_name)) between 1 and 200),
  uploaded_by          uuid references chat.staff (id),
  uploaded_at          timestamptz not null default now(),
  -- The copy in the delivery group's namespace, written once by the send.
  delivered_object_key text unique check (delivered_object_key is null or delivered_object_key ~ '^conversations/[0-9a-f-]{36}/[^/]+$'),
  unique (certificate_id, revision)
);

insert into chat.appreciation_certificate_file (certificate_id, revision, object_key, mime_type, byte_size, file_name, uploaded_by, uploaded_at, delivered_object_key)
select c.id, 1, c.object_key, c.mime_type, c.byte_size, c.file_name, c.decided_by, coalesce(c.decided_at, c.requested_at), c.object_key
  from chat.appreciation_certificate c
 where c.object_key is not null;

alter table chat.appreciation_certificate
  drop column object_key,
  drop column mime_type,
  drop column byte_size,
  drop column file_name;

-- Legacy rows, mapped (owner safeguard 5: a teacher's open ticket is a
-- SUGGESTION the learner's Operations supervisor decides):
--   requested -> proposed    issued -> sent (the issuer approved and sent it)    declined stays
update chat.appreciation_certificate c
   set category = 'student',
       signatory_teacher_id = c.suggested_by_teacher,
       state = case c.state when 'requested' then 'proposed' when 'issued' then 'sent' else c.state end,
       requested_by_staff = case when c.state = 'issued' then c.decided_by end,
       current_file_id  = (select f.id from chat.appreciation_certificate_file f where f.certificate_id = c.id and f.revision = 1),
       approved_file_id = (select f.id from chat.appreciation_certificate_file f where f.certificate_id = c.id and f.revision = 1),
       approved_by = case when c.state = 'issued' then c.decided_by end,
       approved_at = case when c.state = 'issued' then c.decided_at end,
       sent_by     = case when c.state = 'issued' then c.decided_by end,
       sent_at     = case when c.state = 'issued' then c.decided_at end,
       last_action = case c.state when 'requested' then 'proposed' when 'issued' then 'sent' else 'declined' end,
       last_actor_teacher = case when c.state = 'requested' then c.suggested_by_teacher end,
       last_actor_staff   = case when c.state <> 'requested' then c.decided_by end,
       updated_at = coalesce(c.decided_at, c.requested_at);

alter table chat.appreciation_certificate
  alter column last_action set not null,
  add constraint appreciation_certificate_current_file_fk foreign key (current_file_id) references chat.appreciation_certificate_file (id),
  add constraint appreciation_certificate_approved_file_fk foreign key (approved_file_id) references chat.appreciation_certificate_file (id),
  add constraint appreciation_certificate_state_check check (state in
    ('proposed', 'requested', 'in_design', 'changes_requested', 'uploaded', 'approved', 'sent', 'cancelled', 'declined')),
  add constraint appreciation_certificate_request_key_unique unique (organization_id, request_key),
  add constraint appreciation_certificate_period_is_ordered check (period_end is null or (period_start is not null and period_end >= period_start)),
  -- Who it is for follows the category.
  add constraint appreciation_certificate_recipient_by_category check (
    (category = 'student' and learner_id is not null and recipient_teacher_id is null)
    or (category = 'teacher' and recipient_teacher_id is not null and learner_id is null and suggested_by_teacher is null)),
  -- A suggestion has a teacher and no staff requester; anything a staff member owns has one.
  add constraint appreciation_certificate_requester_shape check (
    (state in ('proposed', 'declined')) = (requested_by_staff is null)
    and (state not in ('proposed', 'declined') or suggested_by_teacher is not null)),
  add constraint appreciation_certificate_has_its_file check (state not in ('uploaded', 'approved', 'sent') or current_file_id is not null),
  -- Approved means THIS revision, by someone.
  add constraint appreciation_certificate_approval_is_whole check (
    (approved_file_id is null) = (approved_by is null) and (approved_by is null) = (approved_at is null)
    -- A cancelled certificate keeps the approval it had, on the record.
    and (state not in ('approved', 'sent') or approved_file_id is not null)
    and (approved_file_id is null or state in ('approved', 'sent', 'cancelled'))
    and (approved_file_id is null or approved_file_id = current_file_id)),
  add constraint appreciation_certificate_send_is_whole check (
    (state = 'sent') = (sent_at is not null and sent_by is not null and conversation_id is not null and sent_message_id is not null)),
  add constraint appreciation_certificate_story_is_whole check (
    (story_id is null) = (story_published_at is null) and (story_id is null) = (story_published_by is null)
    -- A live Story belongs to an approved or sent certificate; take it down before anything else.
    and (story_id is null or (publish_story and (state in ('approved', 'sent') or story_withdrawn_at is not null)))
    and (story_withdrawn_at is null or story_id is not null)),
  add constraint appreciation_certificate_cancel_is_whole check (
    (state = 'cancelled') = (cancelled_at is not null and cancelled_by is not null and cancel_reason is not null)),
  add constraint appreciation_certificate_design_is_whole check (
    (assigned_designer_id is null) = (design_started_at is null)),
  add constraint appreciation_certificate_last_action_known check (last_action in (
    'proposed', 'requested', 'accepted', 'declined', 'edited', 'resubmitted', 'started', 'returned', 'released',
    'file_uploaded', 'approved', 'redesign_requested', 'approval_withdrawn', 'sent',
    'consent_granted', 'consent_withdrawn', 'story_published', 'story_withdrawn', 'cancelled')),
  add constraint appreciation_certificate_one_actor check ((last_actor_staff is null) <> (last_actor_teacher is null));

comment on table chat.appreciation_certificate is
  'PD-41 (was PD-12''s learner_certificate): a student''s or a teacher''s appreciation certificate, from request to delivery. Never deleted; every write is an act recorded in appreciation_certificate_event.';

drop index chat.appreciation_certificate_open_idx;
create index appreciation_certificate_queue_idx on chat.appreciation_certificate (organization_id, category, state, requested_at);
create index appreciation_certificate_teacher_idx on chat.appreciation_certificate (recipient_teacher_id, requested_at desc) where recipient_teacher_id is not null;

-- The same certificate requested twice: a type with a Juz' or a period can be
-- open (or sent) once per recipient, Juz' and period start (section 8).
create unique index appreciation_certificate_no_duplicate on chat.appreciation_certificate
  (organization_id, category, coalesce(learner_id, recipient_teacher_id), type_id, coalesce(juz, 0), coalesce(period_start, '-infinity'::date))
  where type_id is not null and state not in ('cancelled', 'declined') and (juz is not null or period_start is not null);

create table chat.certificate_upload (
  object_key      text primary key,
  certificate_id  uuid not null references chat.appreciation_certificate (id),
  mime_type       text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  byte_size       integer not null check (byte_size between 1 and 20971520),
  issued_to       uuid not null references chat.staff (id),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  file_id         uuid references chat.appreciation_certificate_file (id),
  constraint certificate_upload_key_in_its_namespace
    check (object_key ~ ('^certificate-uploads/[0-9a-f-]{36}/' || certificate_id::text || '/[^/]+$')),
  constraint certificate_upload_consumed_is_whole check ((consumed_at is null) = (file_id is null))
);

comment on table chat.certificate_upload is
  'PD-41: an upload grant the API issued to a Designer. Its key is never served: the confirmed bytes are copied to a pinned key (appreciation_certificate_file).';

-- ===========================================================================
-- 3. Family consent for a student Story (owner safeguard 4)
-- ===========================================================================

create table chat.certificate_story_consent (
  id                   uuid primary key default gen_random_uuid(),
  certificate_id       uuid not null references chat.appreciation_certificate (id),
  kind                 text not null check (kind in ('granted', 'withdrawn')),
  -- WHICH parent agreed: a contact of the learner's family.
  given_by_contact_id  uuid references chat.contact (id),
  method               text check (method in ('in_chat', 'phone', 'in_person', 'written')),
  -- Optional evidence: the parent's own message in a conversation about the learner.
  evidence_message_id  uuid references chat.message (id),
  note                 text check (note is null or length(btrim(note)) between 1 and 1000),
  recorded_by          uuid not null references chat.staff (id),
  recorded_at          timestamptz not null default clock_timestamp(),
  -- The certificate act that records it (section 4): written first, then the act.
  action_seq           integer not null,
  unique (certificate_id, action_seq),
  constraint certificate_consent_grant_is_documented check (
    kind <> 'granted' or (given_by_contact_id is not null and method is not null
      and (method in ('in_chat', 'written') or length(btrim(coalesce(note, ''))) >= 10)
      and (method <> 'in_chat' or evidence_message_id is not null or length(btrim(coalesce(note, ''))) >= 10))),
  constraint certificate_consent_withdrawal_has_a_reason check (
    kind <> 'withdrawn' or length(btrim(coalesce(note, ''))) >= 10)
);


comment on table chat.certificate_story_consent is
  'PD-41: a family''s consent to a student certificate''s Story, as recorded acts (append-only). Only the latest counts; missing or withdrawn means no Story.';

create trigger certificate_story_consent_is_append_only before update or delete on chat.certificate_story_consent
  for each row execute function chat.forbid_change();

create or replace function chat.guard_certificate_story_consent()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  c   chat.appreciation_certificate%rowtype;
  fam uuid;
  m   record;
begin
  select * into c from chat.appreciation_certificate where id = new.certificate_id;
  if c.category is distinct from 'student' then
    raise exception 'family consent is recorded for a student certificate only' using errcode = 'check_violation';
  end if;
  select family_id into fam from chat.learner where id = c.learner_id;
  if new.given_by_contact_id is not null and not exists (
       select 1 from chat.contact ct where ct.id = new.given_by_contact_id and ct.family_id = fam) then
    raise exception 'consent is given by a contact of the learner''s family' using errcode = 'check_violation';
  end if;
  if new.evidence_message_id is not null then
    select msg.author_type, msg.author_id, cv.type, cv.learner_id, cv.family_id, cv.id as conv into m
      from chat.message msg join chat.conversation cv on cv.id = msg.conversation_id
     where msg.id = new.evidence_message_id;
    if m.conv is null or m.author_type <> 'contact' or m.author_id is distinct from new.given_by_contact_id
       or not ((m.type = 'student_group' and m.learner_id = c.learner_id)
               or (m.type = 'family_group' and exists (select 1 from chat.conversation_learner cl where cl.conversation_id = m.conv and cl.learner_id = c.learner_id))
               or coalesce(m.type = 'direct' and m.family_id = fam, false)) then
      raise exception 'the evidence is the consenting parent''s own message about this learner' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger certificate_story_consent_is_coherent before insert on chat.certificate_story_consent
  for each row execute function chat.guard_certificate_story_consent();

-- ===========================================================================
-- 4. The history, and the state machine that writes it
-- ===========================================================================

create table chat.appreciation_certificate_event (
  id             uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references chat.appreciation_certificate (id),
  seq            integer not null,
  kind           text not null,
  from_state     text,
  to_state       text not null,
  actor_staff_id   uuid references chat.staff (id),
  actor_teacher_id uuid references chat.teacher (id),
  before         jsonb,
  after          jsonb,
  note           text,
  at             timestamptz not null default clock_timestamp(),
  unique (certificate_id, seq),
  constraint certificate_event_one_actor check ((actor_staff_id is null) <> (actor_teacher_id is null)),
  -- Owner safeguard 2: a return, a redesign, a withdrawn approval, a declined
  -- suggestion, a cancellation and a withdrawn consent each say why.
  constraint certificate_event_says_why check (
    kind not in ('returned', 'redesign_requested', 'approval_withdrawn', 'declined', 'cancelled', 'consent_withdrawn')
    or length(btrim(coalesce(note, ''))) >= 10)
);

create index appreciation_certificate_event_actor_idx on chat.appreciation_certificate_event (actor_staff_id, at desc);

comment on table chat.appreciation_certificate_event is
  'PD-41: the append-only history of a certificate, written by its trigger for every act (owner safeguards 2 and 7).';

create trigger appreciation_certificate_event_is_append_only before update or delete on chat.appreciation_certificate_event
  for each row execute function chat.forbid_change();

-- PD-12's rows enter the history as the act that left them where they are.
insert into chat.appreciation_certificate_event (certificate_id, seq, kind, from_state, to_state, actor_staff_id, actor_teacher_id, note, at)
select c.id, 1, c.last_action, null, c.state, c.last_actor_staff, c.last_actor_teacher,
       case when c.state = 'declined' then 'declined under PD-12: ' || coalesce(c.decline_reason, 'no reason recorded') end,
       c.updated_at
  from chat.appreciation_certificate c;

-- Is the staff member live, of the organization?
create or replace function chat.certificate_live_staff(p_staff uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select exists (select 1 from chat.staff s where s.id = p_staff and s.organization_id = p_org and s.is_active and s.left_at is null);
$$;

-- Does the staff member act as the requester of record: the requester
-- themself, or their active PD-33 backup? (A manager oversees; it does not
-- act as the requester -- owner safeguard 1.)
create or replace function chat.certificate_acts_as(p_staff uuid, p_principal uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select p_principal is not null and coalesce(chat.staff_acts_for(p_staff, p_principal, now()) in ('self', 'backup'), false);
$$;

-- The request permission of a category.
create or replace function chat.certificate_request_key(p_category text)
returns text
language sql
immutable
as $$
  select 'certificates.request.' || p_category;
$$;

-- The state machine: may `action` move a certificate from `from_state` to `to_state`?
create or replace function chat.certificate_transition_ok(p_action text, p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_action
    when 'edited'             then p_from in ('requested', 'changes_requested') and p_to = p_from
    when 'accepted'           then p_from = 'proposed' and p_to = 'requested'
    when 'declined'           then p_from = 'proposed' and p_to = 'declined'
    when 'resubmitted'        then p_from = 'changes_requested' and p_to = 'requested'
    when 'started'            then p_from = 'requested' and p_to = 'in_design'
    when 'returned'           then p_from in ('requested', 'in_design') and p_to = 'changes_requested'
    when 'released'           then p_from = 'in_design' and p_to = 'requested'
    when 'file_uploaded'      then p_from in ('in_design', 'uploaded') and p_to = 'uploaded'
    when 'approved'           then p_from = 'uploaded' and p_to = 'approved'
    when 'redesign_requested' then p_from = 'uploaded' and p_to = 'in_design'
    when 'approval_withdrawn' then p_from = 'approved' and p_to = 'in_design'
    when 'sent'               then p_from = 'approved' and p_to = 'sent'
    when 'consent_granted'    then p_from in ('requested', 'in_design', 'changes_requested', 'uploaded', 'approved', 'sent') and p_to = p_from
    when 'consent_withdrawn'  then p_from in ('requested', 'in_design', 'changes_requested', 'uploaded', 'approved', 'sent') and p_to = p_from
    when 'story_published'    then p_from in ('approved', 'sent') and p_to = p_from
    when 'story_withdrawn'    then p_from in ('approved', 'sent') and p_to = p_from
    when 'cancelled'          then p_from in ('requested', 'in_design', 'changes_requested', 'uploaded', 'approved') and p_to = 'cancelled'
    else false
  end;
$$;

-- The latest consent act recorded for a certificate.
create or replace function chat.certificate_consent_granted(p_certificate uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select coalesce((select kind = 'granted' from chat.certificate_story_consent
                    where certificate_id = p_certificate order by action_seq desc limit 1), false);
$$;

create or replace function chat.guard_appreciation_certificate()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  a        text := new.last_action;
  actor    uuid := new.last_actor_staff;
  v_learner chat.learner%rowtype;
  v_teacher chat.teacher%rowtype;
  v_type   chat.certificate_type%rowtype;
  v_file   chat.appreciation_certificate_file%rowtype;
  v_conv   record;
  v_super  uuid;
begin
  if (new.last_actor_staff is null) = (new.last_actor_teacher is null) then
    raise exception 'a certificate act names exactly one actor' using errcode = 'check_violation';
  end if;
  if actor is not null and not chat.certificate_live_staff(actor, new.organization_id) then
    raise exception 'a certificate act is done by live staff of its organization' using errcode = 'insufficient_privilege';
  end if;
  if a in ('returned', 'redesign_requested', 'approval_withdrawn', 'declined', 'cancelled', 'consent_withdrawn')
     and length(btrim(coalesce(new.last_note, ''))) < 10 then
    raise exception 'this act says why, in at least 10 characters' using errcode = 'check_violation';
  end if;

  -- -------------------------------------------------------------------------
  if tg_op = 'INSERT' then
    if new.action_seq <> 1 or new.state is distinct from a or a not in ('proposed', 'requested') then
      raise exception 'a certificate is born proposed or requested, by its first act' using errcode = 'check_violation';
    end if;
    if (new.assigned_designer_id, new.current_file_id, new.approved_file_id, new.sent_at, new.story_id, new.cancelled_at,
        new.decided_by, new.conversation_id, new.sent_message_id)
       is distinct from (null::uuid, null::uuid, null::uuid, null::timestamptz, null::uuid, null::timestamptz,
                         null::uuid, null::uuid, null::uuid) then
      raise exception 'a new certificate has no design, file, delivery or decision yet' using errcode = 'check_violation';
    end if;
    if new.type_id is not null then
      select * into v_type from chat.certificate_type where id = new.type_id;
      if v_type.organization_id is distinct from new.organization_id or v_type.category is distinct from new.category then
        raise exception 'a certificate''s type is one of its organization and category' using errcode = 'check_violation';
      end if;
      if not v_type.is_active then
        raise exception 'this certificate type is disabled' using errcode = 'check_violation';
      end if;
      if v_type.needs_juz and new.juz is null then
        raise exception 'this certificate type needs the Juz''' using errcode = 'check_violation';
      end if;
      if v_type.needs_period is not null and new.period_start is null then
        raise exception 'this certificate type needs its period' using errcode = 'check_violation';
      end if;
    elsif a = 'requested' then
      raise exception 'a staff request names its certificate type' using errcode = 'check_violation';
    end if;
    if a = 'requested' and new.request_key is null then
      raise exception 'a staff request carries its request key' using errcode = 'check_violation';
    end if;

    if new.category = 'student' then
      select * into v_learner from chat.learner where id = new.learner_id;
      if v_learner.organization_id is distinct from new.organization_id then
        raise exception 'a certificate and its learner share one organization' using errcode = 'insufficient_privilege';
      end if;
      if new.signatory_teacher_id is distinct from v_learner.teacher_id then
        raise exception 'a student certificate is signed by the learner''s teacher' using errcode = 'check_violation';
      end if;
    else
      select * into v_teacher from chat.teacher where id = new.recipient_teacher_id;
      if v_teacher.organization_id is distinct from new.organization_id or not v_teacher.is_active then
        raise exception 'a teacher certificate is for a live teacher of its organization' using errcode = 'check_violation';
      end if;
    end if;

    if a = 'proposed' then
      -- PD-12: the learner's assigned teacher suggests it.
      select * into v_teacher from chat.teacher where id = new.last_actor_teacher;
      if new.category <> 'student' or new.suggested_by_teacher is distinct from new.last_actor_teacher
         or v_learner.teacher_id is distinct from new.suggested_by_teacher
         or v_teacher.organization_id is distinct from new.organization_id or not v_teacher.is_active or v_teacher.left_at is not null then
        raise exception 'a certificate is suggested by the learner''s live, assigned teacher' using errcode = 'insufficient_privilege';
      end if;
    else
      if new.requested_by_staff is distinct from actor or new.suggested_by_teacher is not null
         or not chat.staff_has_permission(actor, chat.certificate_request_key(new.category)) then
        raise exception 'a certificate is requested by staff holding its category''s request permission' using errcode = 'insufficient_privilege';
      end if;
    end if;
    new.requested_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- -------------------------------------------------------------------------
  -- UPDATE: exactly one new act.
  if new.action_seq <> old.action_seq + 1 then
    raise exception 'every certificate write is one act (action_seq + 1)' using errcode = 'check_violation';
  end if;
  if not chat.certificate_transition_ok(a, old.state, new.state) then
    raise exception 'a certificate does not move from % to % by %', old.state, new.state, a using errcode = 'check_violation';
  end if;
  if (new.id, new.organization_id, new.category, new.learner_id, new.recipient_teacher_id, new.suggested_by_teacher,
      new.signatory_teacher_id, new.request_key, new.requested_at)
     is distinct from
     (old.id, old.organization_id, old.category, old.learner_id, old.recipient_teacher_id, old.suggested_by_teacher,
      old.signatory_teacher_id, old.request_key, old.requested_at) then
    raise exception 'who a certificate is for, and who asked, is written once' using errcode = 'check_violation';
  end if;
  if new.request_message_id is distinct from old.request_message_id then
    raise exception 'a suggestion is born with its request card' using errcode = 'check_violation';
  end if;
  -- The request's words change only by an edit (owner safeguard 2's history keeps them).
  if a not in ('edited', 'accepted') and (new.type_id, new.title, new.achievement, new.achieved_on, new.grade, new.printed_name, new.internal_note,
      new.designer_note, new.juz, new.period_start, new.period_end, new.publish_story)
     is distinct from (old.type_id, old.title, old.achievement, old.achieved_on, old.grade, old.printed_name, old.internal_note,
      old.designer_note, old.juz, old.period_start, old.period_end, old.publish_story) then
    raise exception 'what a certificate request says changes only by an edit' using errcode = 'check_violation';
  end if;
  if a in ('edited', 'accepted') then
    if new.publish_story is distinct from old.publish_story and old.story_id is not null then
      raise exception 'a certificate that had its Story keeps its Story choice' using errcode = 'check_violation';
    end if;
    select * into v_type from chat.certificate_type where id = new.type_id;
    if new.type_id is distinct from old.type_id
       and (v_type.organization_id is distinct from new.organization_id or v_type.category is distinct from new.category or not v_type.is_active) then
      raise exception 'a certificate''s type is an active one of its organization and category' using errcode = 'check_violation';
    end if;
    if v_type.id is not null and ((v_type.needs_juz and new.juz is null) or (v_type.needs_period is not null and new.period_start is null)) then
      raise exception 'this certificate type needs its Juz'' or period' using errcode = 'check_violation';
    end if;
  end if;
  if new.requested_by_staff is distinct from old.requested_by_staff and not (a = 'accepted' and old.requested_by_staff is null) then
    raise exception 'a certificate''s requester is set once, when a suggestion is accepted' using errcode = 'check_violation';
  end if;
  if (new.decided_by, new.decided_at, new.decline_reason) is distinct from (old.decided_by, old.decided_at, old.decline_reason)
     and a not in ('accepted', 'declined') then
    raise exception 'a suggestion is decided once' using errcode = 'check_violation';
  end if;
  if (new.assigned_designer_id, new.design_started_at) is distinct from (old.assigned_designer_id, old.design_started_at)
     and a not in ('started', 'released') then
    raise exception 'the designer is set by start and cleared by release' using errcode = 'check_violation';
  end if;
  if new.current_file_id is distinct from old.current_file_id and a <> 'file_uploaded' then
    raise exception 'the current file changes only by an upload' using errcode = 'check_violation';
  end if;
  if (new.approved_file_id, new.approved_by, new.approved_at) is distinct from (old.approved_file_id, old.approved_by, old.approved_at)
     and a not in ('approved', 'approval_withdrawn') then
    raise exception 'an approval is given or withdrawn, never edited' using errcode = 'check_violation';
  end if;
  if (new.sent_at, new.sent_by, new.conversation_id, new.sent_message_id) is distinct from
     (old.sent_at, old.sent_by, old.conversation_id, old.sent_message_id) and a <> 'sent' then
    raise exception 'a certificate is sent once' using errcode = 'check_violation';
  end if;
  if (new.story_id, new.story_published_at, new.story_published_by) is distinct from
     (old.story_id, old.story_published_at, old.story_published_by) and not (a = 'story_published' and old.story_id is null) then
    raise exception 'a certificate''s Story is published once' using errcode = 'check_violation';
  end if;
  if new.story_withdrawn_at is distinct from old.story_withdrawn_at and not (a = 'story_withdrawn' and old.story_withdrawn_at is null) then
    raise exception 'a certificate''s Story is withdrawn once' using errcode = 'check_violation';
  end if;
  if (new.cancelled_by, new.cancelled_at, new.cancel_reason) is distinct from (old.cancelled_by, old.cancelled_at, old.cancel_reason)
     and a <> 'cancelled' then
    raise exception 'a certificate is cancelled once' using errcode = 'check_violation';
  end if;
  if new.return_message is distinct from old.return_message and a not in ('returned', 'redesign_requested', 'approval_withdrawn') then
    raise exception 'the return message is written by a return' using errcode = 'check_violation';
  end if;
  if a <> 'proposed' and new.last_actor_teacher is not null then
    raise exception 'after the suggestion, a certificate is acted on by staff' using errcode = 'insufficient_privilege';
  end if;

  -- Who may do each act, and what it must leave behind.
  case a
    when 'accepted', 'declined' then
      -- Owner safeguard 5: the learner's assigned Operations supervisor, or their active cover.
      select ls.supervisor_id into v_super from chat.learner_supervision ls where ls.learner_id = new.learner_id;
      if not chat.certificate_acts_as(actor, v_super) or not chat.staff_has_permission(actor, 'certificates.request.student') then
        raise exception 'a teacher''s suggestion is decided by the learner''s Operations supervisor' using errcode = 'insufficient_privilege';
      end if;
      if new.decided_by is distinct from actor or new.decided_at is null then
        raise exception 'the decision names who made it' using errcode = 'check_violation';
      end if;
      if a = 'accepted' and (new.requested_by_staff is distinct from actor or new.type_id is null) then
        raise exception 'an accepted suggestion is owned by who accepted it, with its type' using errcode = 'check_violation';
      end if;
      if a = 'declined' and new.decline_reason is null then
        raise exception 'a declined suggestion has its reason' using errcode = 'check_violation';
      end if;
    when 'started', 'returned', 'file_uploaded' then
      if not chat.staff_has_permission(actor, 'certificates.design') then
        raise exception 'only a designer designs, uploads and returns a certificate' using errcode = 'insufficient_privilege';
      end if;
      if a = 'started' and (new.assigned_designer_id is distinct from actor or new.design_started_at is null) then
        raise exception 'a design is started by the designer who takes it' using errcode = 'check_violation';
      end if;
      if a = 'returned' then
        if old.state = 'in_design' and old.assigned_designer_id is distinct from actor then
          raise exception 'a design is returned by the designer working on it' using errcode = 'insufficient_privilege';
        end if;
        if new.return_message is distinct from new.last_note then
          raise exception 'a return keeps its message' using errcode = 'check_violation';
        end if;
      end if;
      if a = 'file_uploaded' then
        if old.assigned_designer_id is distinct from actor then
          raise exception 'a file is uploaded by the designer working on it' using errcode = 'insufficient_privilege';
        end if;
        select * into v_file from chat.appreciation_certificate_file where id = new.current_file_id;
        if v_file.certificate_id is distinct from new.id or v_file.uploaded_by is distinct from actor
           or v_file.revision <= coalesce((select revision from chat.appreciation_certificate_file where id = old.current_file_id), 0) then
          raise exception 'an upload is a newer revision of this certificate, by its designer' using errcode = 'check_violation';
        end if;
      end if;
    when 'released' then
      if not ((old.assigned_designer_id is not distinct from actor and chat.staff_has_permission(actor, 'certificates.design'))
              or chat.staff_has_permission(actor, 'certificates.oversee')) then
        raise exception 'a design is released by its designer or an overseer' using errcode = 'insufficient_privilege';
      end if;
      if new.assigned_designer_id is not null then
        raise exception 'a released design has no designer' using errcode = 'check_violation';
      end if;
    when 'edited', 'resubmitted', 'approved', 'redesign_requested', 'approval_withdrawn' then
      if not chat.certificate_acts_as(actor, new.requested_by_staff)
         or not chat.staff_has_permission(actor, chat.certificate_request_key(new.category)) then
        raise exception 'only the requester of record does this' using errcode = 'insufficient_privilege';
      end if;
      if a = 'approved' then
        -- Owner safeguard 1: the reviewer approves THIS revision, and is not who uploaded it.
        select * into v_file from chat.appreciation_certificate_file where id = new.current_file_id;
        if new.approved_file_id is distinct from new.current_file_id or new.approved_by is distinct from actor or new.approved_at is null then
          raise exception 'an approval names the revision and the reviewer' using errcode = 'check_violation';
        end if;
        if v_file.uploaded_by is not distinct from actor then
          raise exception 'the person who uploaded a design does not approve it' using errcode = 'insufficient_privilege';
        end if;
      end if;
      if a = 'approval_withdrawn' and (new.approved_file_id, new.approved_by, new.approved_at) is distinct from (null::uuid, null::uuid, null::timestamptz) then
        raise exception 'a withdrawn approval is cleared' using errcode = 'check_violation';
      end if;
      if a in ('redesign_requested', 'approval_withdrawn') and new.return_message is distinct from new.last_note then
        raise exception 'a redesign keeps its message' using errcode = 'check_violation';
      end if;
    when 'sent' then
      if not chat.certificate_acts_as(actor, new.requested_by_staff) or not chat.staff_has_permission(actor, 'certificates.deliver') then
        raise exception 'only the requester of record sends a certificate' using errcode = 'insufficient_privilege';
      end if;
      if new.sent_by is distinct from actor or new.approved_file_id is distinct from new.current_file_id then
        raise exception 'the approved revision is sent, by its sender' using errcode = 'check_violation';
      end if;
      select id, type, learner_id, supervised_teacher_id, organization_id, archived_at into v_conv
        from chat.conversation where id = new.conversation_id;
      if v_conv.id is null or v_conv.organization_id <> new.organization_id or v_conv.archived_at is not null
         or not (
           (new.category = 'student' and ((v_conv.type = 'student_group' and v_conv.learner_id = new.learner_id)
             or (v_conv.type = 'family_group' and exists (
                   select 1 from chat.conversation_learner cl where cl.conversation_id = v_conv.id and cl.learner_id = new.learner_id))))
           or (new.category = 'teacher' and v_conv.type = 'teacher_supervision' and v_conv.supervised_teacher_id = new.recipient_teacher_id)) then
        raise exception 'a certificate is sent into a live group of its recipient' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from chat.message msg where msg.id = new.sent_message_id and msg.conversation_id = new.conversation_id) then
        raise exception 'a sent certificate points at its card in that group' using errcode = 'check_violation';
      end if;
    when 'consent_granted', 'consent_withdrawn' then
      if not chat.certificate_acts_as(actor, new.requested_by_staff) or not chat.staff_has_permission(actor, 'certificates.story') then
        raise exception 'only the requester of record records consent' using errcode = 'insufficient_privilege';
      end if;
      if not exists (select 1 from chat.certificate_story_consent sc where sc.certificate_id = new.id and sc.recorded_by = actor
                        and sc.kind = substr(a, 9) and sc.action_seq = new.action_seq) then
        raise exception 'a consent act records its consent row, written first under the same act' using errcode = 'check_violation';
      end if;
    when 'story_published', 'story_withdrawn' then
      if not chat.certificate_acts_as(actor, new.requested_by_staff) or not chat.staff_has_permission(actor, 'certificates.story') then
        raise exception 'only the requester of record publishes a Story' using errcode = 'insufficient_privilege';
      end if;
      if a = 'story_published' then
        -- Owner safeguards 3 and 4: opted in, approved, and (for a student) consented.
        if not new.publish_story or new.story_published_by is distinct from actor then
          raise exception 'a Story is published only for a request that opted in, by its publisher' using errcode = 'check_violation';
        end if;
        if (select story_needs_consent from chat.certificate_category where key = new.category)
           and not chat.certificate_consent_granted(new.id) then
          raise exception 'a student certificate''s Story needs the family''s recorded consent' using errcode = 'check_violation';
        end if;
      end if;
    when 'cancelled' then
      if not ((chat.certificate_acts_as(actor, new.requested_by_staff)
               and chat.staff_has_permission(actor, chat.certificate_request_key(new.category)))
              or chat.staff_has_permission(actor, 'certificates.oversee')) then
        raise exception 'a certificate is cancelled by its requester or an overseer' using errcode = 'insufficient_privilege';
      end if;
      if new.cancelled_by is distinct from actor or new.cancel_reason is distinct from new.last_note then
        raise exception 'a cancellation names who and why' using errcode = 'check_violation';
      end if;
    else
      raise exception 'unknown certificate act %', a using errcode = 'check_violation';
  end case;

  new.updated_at := now();
  return new;
end;
$$;

create trigger appreciation_certificate_is_coherent before insert or update on chat.appreciation_certificate
  for each row execute function chat.guard_appreciation_certificate();

-- The history row of every act. Edits keep before/after of what changed.
create or replace function chat.record_appreciation_certificate_event()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  b jsonb;
  f jsonb;
begin
  if tg_op = 'UPDATE' and new.last_action = 'edited' then
    b := jsonb_strip_nulls(jsonb_build_object('typeId', old.type_id, 'title', old.title, 'achievement', old.achievement,
           'achievedOn', old.achieved_on, 'grade', old.grade, 'printedName', old.printed_name, 'internalNote', old.internal_note,
           'designerNote', old.designer_note, 'juz', old.juz, 'periodStart', old.period_start, 'periodEnd', old.period_end,
           'publishStory', old.publish_story));
    f := jsonb_strip_nulls(jsonb_build_object('typeId', new.type_id, 'title', new.title, 'achievement', new.achievement,
           'achievedOn', new.achieved_on, 'grade', new.grade, 'printedName', new.printed_name, 'internalNote', new.internal_note,
           'designerNote', new.designer_note, 'juz', new.juz, 'periodStart', new.period_start, 'periodEnd', new.period_end,
           'publishStory', new.publish_story));
  elsif new.last_action = 'file_uploaded' then
    select jsonb_build_object('fileId', x.id, 'revision', x.revision, 'mimeType', x.mime_type, 'byteSize', x.byte_size, 'fileName', x.file_name)
      into f from chat.appreciation_certificate_file x where x.id = new.current_file_id;
  elsif new.last_action = 'approved' then
    f := jsonb_build_object('fileId', new.approved_file_id);
  end if;
  insert into chat.appreciation_certificate_event
    (certificate_id, seq, kind, from_state, to_state, actor_staff_id, actor_teacher_id, before, after, note)
  values
    (new.id, new.action_seq, new.last_action, case when tg_op = 'UPDATE' then old.state end, new.state,
     new.last_actor_staff, new.last_actor_teacher, b, f, new.last_note);
  return null;
end;
$$;

create trigger appreciation_certificate_has_history after insert or update on chat.appreciation_certificate
  for each row execute function chat.record_appreciation_certificate_event();

create or replace function chat.forbid_appreciation_certificate_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'a certificate is never deleted; cancel it' using errcode = 'check_violation';
end;
$$;

create trigger appreciation_certificate_is_kept before delete on chat.appreciation_certificate
  for each row execute function chat.forbid_appreciation_certificate_delete();

-- A design revision: append-only, except the delivered copy written once by the send.
create or replace function chat.guard_appreciation_certificate_file()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a certificate file is never deleted' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if new.uploaded_by is null or new.object_key !~ ('^certificates/[0-9a-f-]{36}/' || new.certificate_id::text || '/v/') then
      raise exception 'a new design revision is a pinned copy, by its designer' using errcode = 'check_violation';
    end if;
    if new.delivered_object_key is not null then
      raise exception 'a new revision has not been delivered' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (new.id, new.certificate_id, new.revision, new.object_key, new.mime_type, new.byte_size, new.file_name, new.uploaded_by, new.uploaded_at)
     is distinct from (old.id, old.certificate_id, old.revision, old.object_key, old.mime_type, old.byte_size, old.file_name, old.uploaded_by, old.uploaded_at)
     or old.delivered_object_key is not null then
    raise exception 'a certificate file is written once; its delivered copy once' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger appreciation_certificate_file_is_kept before insert or update or delete on chat.appreciation_certificate_file
  for each row execute function chat.guard_appreciation_certificate_file();

-- ===========================================================================
-- 5. Cards and notifications
-- ===========================================================================

insert into chat.message_card_kind (kind) values
  -- A teacher's certificate, delivered with its file into their supervision conversation.
  ('certificate_awarded'),
  -- A teacher's suggestion accepted by the learner's supervisor (declined reuses certificate_declined).
  ('certificate_accepted')
on conflict do nothing;

insert into chat.notification_template (key, locale, title, body) values
  ('certificate_requested', 'ar', 'جَوِّد', 'طلب شهادة جديد بانتظار التصميم: {type} — {printed_name}.'),
  ('certificate_requested', 'en', 'Jawwid', 'A new certificate is waiting for its design: {type} — {printed_name}.'),
  ('certificate_returned', 'ar', 'جَوِّد', 'أعاد المصمم طلب الشهادة ({type} — {printed_name}) لإجراء تعديل.'),
  ('certificate_returned', 'en', 'Jawwid', 'The designer returned the certificate ({type} — {printed_name}) for changes.'),
  ('certificate_uploaded', 'ar', 'جَوِّد', 'تصميم الشهادة جاهز للمراجعة: {type} — {printed_name}.'),
  ('certificate_uploaded', 'en', 'Jawwid', 'The certificate design is ready for your review: {type} — {printed_name}.'),
  ('certificate_suggestion_decided', 'ar', 'جَوِّد', 'تمّ البتّ في اقتراح شهادة {printed_name}.'),
  ('certificate_suggestion_decided', 'en', 'Jawwid', 'Your certificate suggestion for {printed_name} was decided.')
on conflict (key, locale, version) do nothing;

-- ===========================================================================
-- 6. Permissions (PD-40 catalogue): the certificate keys PD-41 adds
-- ===========================================================================
-- The rows are generated from catalogue.ts and legacy-bundles.ts by
-- test/unit/authorization/pd040-catalogue-seed.spec.ts.

select set_config('chat.pd040_catalogue_change', 'on', true);

-- BEGIN GENERATED pd041 catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values
  ('certificates.request.student', 'certificates', 'request.student', 'Request student certificates', 'طلب شهادات الطلاب', 'pii', false, 'PD-41'),
  ('certificates.request.teacher', 'certificates', 'request.teacher', 'Request teacher certificates', 'طلب شهادات المعلمين', 'pii', false, 'PD-41'),
  ('certificates.story', 'certificates', 'story', 'Record consent and publish certificate Stories', 'تسجيل الموافقة ونشر الشهادات في القصص', 'family_contact', false, 'PD-41'),
  ('certificates.oversee', 'certificates', 'oversee', 'Oversee every certificate request of the department', 'الإشراف على جميع طلبات شهادات القسم', 'pii', false, 'PD-41'),
  ('certificates.types', 'certificates', 'types', 'Manage certificate types', 'إدارة أنواع الشهادات', 'admin', false, 'PD-41');

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'operations', 'certificates.deliver'),
  ('manager', 'operations', 'certificates.oversee'),
  ('manager', 'operations', 'certificates.request.student'),
  ('manager', 'operations', 'certificates.story'),
  ('manager', 'operations', 'certificates.view'),
  ('manager', 'teachers', 'certificates.oversee'),
  ('manager', 'teachers', 'certificates.request.teacher'),
  ('manager', 'teachers', 'certificates.story'),
  ('supervisor', 'operations', 'certificates.deliver'),
  ('supervisor', 'operations', 'certificates.request.student'),
  ('supervisor', 'operations', 'certificates.story'),
  ('supervisor', 'operations', 'certificates.view'),
  ('supervisor', 'teachers', 'certificates.request.teacher'),
  ('supervisor', 'teachers', 'certificates.story');
-- END GENERATED pd041 catalogue rows

select set_config('chat.pd040_catalogue_change', 'off', true);

-- ===========================================================================
-- 7. Fail closed
-- ===========================================================================

alter table chat.certificate_category            enable row level security;
alter table chat.certificate_type                enable row level security;
alter table chat.appreciation_certificate_file   enable row level security;
alter table chat.certificate_upload              enable row level security;
alter table chat.certificate_story_consent       enable row level security;
alter table chat.appreciation_certificate_event  enable row level security;

revoke all on chat.certificate_category, chat.certificate_type, chat.appreciation_certificate_file,
              chat.certificate_upload, chat.certificate_story_consent, chat.appreciation_certificate_event
  from public, anon, authenticated, chat_app;

revoke all on function chat.guard_certificate_type() from public;
revoke all on function chat.guard_certificate_story_consent() from public;
revoke all on function chat.certificate_live_staff(uuid, uuid) from public;
revoke all on function chat.certificate_acts_as(uuid, uuid) from public;
revoke all on function chat.certificate_consent_granted(uuid) from public;
revoke all on function chat.guard_appreciation_certificate() from public;
revoke all on function chat.record_appreciation_certificate_event() from public;
revoke all on function chat.forbid_appreciation_certificate_delete() from public;
revoke all on function chat.guard_appreciation_certificate_file() from public;
revoke all on function chat.certificate_transition_ok(text, text, text) from public;
revoke all on function chat.certificate_request_key(text) from public;
