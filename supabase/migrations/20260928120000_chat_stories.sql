-- Jawwid Chat -- Stories: a short-lived publication from the academy to a
-- resolved slice of its people.
--
-- Canonical design: docs/product/STORIES.md.
--
-- WHAT THIS IS NOT
-- ----------------
-- This is NOT a port of the abandoned Phase 5 lineage
-- (`phase5/calls-stories-broadcast`, 38d3a33). That implementation was written
-- against a permission-key authorization model (`chat.permission`,
-- `chat.role_permission`, `chat.current_has_permission()`) and against tables
-- that do not exist here (`chat.family_label`, `chat.group_member`,
-- `chat.learner_teacher_assignment`). None of that is on main, and importing it
-- would give this database TWO authorization models. The old lineage was read
-- as a design reference; every predicate below is written against the
-- authorization model this database actually has:
--
--   who the caller is   -> chat.current_staff_id() / chat.current_account_id()
--   what role they hold -> chat.current_staff_role()
--   which tenant        -> chat.current_organization_id()
--
-- THE ONE DECISION THAT SHAPES EVERYTHING ELSE: THE AUDIENCE IS MATERIALISED.
--
-- An audience is authored as INTENT -- "all families, plus this class group,
-- plus these two teachers". That intent could be resolved to people at read
-- time or at write time, and the choice is not a matter of taste:
--
--   READ TIME (the tempting one) means every reader's feed runs a union of
--   subqueries across chat.contact, chat.learner and chat.conversation_member,
--   per story, per pull. It cannot be usefully indexed, and -- worse -- it makes
--   "who was this published to?" unanswerable after the fact, because the answer
--   changes every time somebody joins a group.
--
--   WRITE TIME (this design) resolves the intent ONCE, server-side, into
--   chat.story_recipient. A feed is then a single indexed join. "Who was this
--   published to" is a query. Deduplication across overlapping audiences is the
--   primary key, not a code path that can be forgotten.
--
-- What write-time resolution costs is that the audience is a SNAPSHOT: a family
-- enrolled tomorrow does not retroactively receive a story published today.
-- That is the correct semantics for a publication -- it went out to the people
-- it went out to -- and it is stated here so that it is a decision rather than a
-- surprise.
--
-- WHERE AUTHORIZATION ACTUALLY HAPPENS
-- ------------------------------------
-- In StoryService, like every other feature in this engine. RLS here is the
-- SECOND layer, exactly as docs/security/RLS-STRATEGY.md section 2 requires:
-- "defence in depth behind AuthorizationService ... never the primary
-- authorization path". The policies below are inert today for the same reason
-- every other table's are -- the API connects as the owner and sets no actor
-- context -- and they become live unchanged when RLS-STRATEGY section 3 lands.
-- They are written to be correct on that day, not to be decorative now.

-- ---------------------------------------------------------------------------
-- 0. Identity helpers
-- ---------------------------------------------------------------------------
--
-- Stories are addressed to an ACTOR -- which on this schema is a staff id, a
-- contact id or a teacher id, drawn from three different tables. Every existing
-- helper answers a narrower question (`current_staff_id()`,
-- `current_contact_family_ids()`), so a story policy has no way to ask "is this
-- recipient row mine?". This adds that one question and nothing else: no new
-- table, no new role vocabulary, no change to any existing helper or policy.

create or replace function chat.current_actor_ids()
returns setof uuid
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  -- Staff. Reuses current_staff_id() so the chat.actor_staff_id override that
  -- the integration harnesses already rely on keeps working here too.
  select chat.current_staff_id()
   where chat.current_staff_id() is not null
  union
  -- Family contacts. A person may hold more than one contact row, so this is a
  -- set and not a scalar.
  select c.id from chat.contact c
   where c.account_id = chat.current_account_id() and c.is_active
  union
  select t.id from chat.teacher t
   where t.account_id = chat.current_account_id() and t.is_active
  union
  -- The explicit per-transaction override RLS-STRATEGY section 3 specifies
  -- (`set_config('chat.actor_id', ...)`). Present so these policies need no
  -- edit on the day the API starts setting it.
  select nullif(current_setting('chat.actor_id', true), '')::uuid
   where nullif(current_setting('chat.actor_id', true), '') is not null
$$;

comment on function chat.current_actor_ids() is
  'Every actor id the current caller IS -- staff, contact(s), teacher. The set a '
  'story recipient/view row is matched against. NULL-safe: an unresolved caller '
  'yields the empty set, which policies treat as "see nothing".';

-- WHO MAY PUBLISH. The brief says Manager / Admin. This database''s staff roles
-- are admin, coverage, manager, finance, technical and academic, and the three
-- that take part in family communication at all are exactly
-- FAMILY_FACING_STAFF_ROLES in contracts/vocab.ts: admin, coverage, manager.
-- Department staff (finance, technical, academic) complete tasks and never
-- address families, so they do not publish either.
--
-- There is deliberately no `super_admin` or `coverage_admin` here. Those are the
-- OLD lineage''s role names; inventing them on this schema to match a migration
-- that was never merged would add two roles nothing else in the product knows.
--
-- Holding this is NECESSARY and not SUFFICIENT: the audience resolver
-- independently refuses every clause outside the author''s own scope, so a
-- coverage admin reaches the families they cover and nobody else.
create or replace function chat.current_can_publish_story()
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select coalesce(chat.current_staff_role() in ('admin', 'coverage', 'manager'), false)
$$;

comment on function chat.current_can_publish_story() is
  'Publisher predicate for stories: the family-facing staff roles (admin, '
  'coverage, manager). Mirrors FAMILY_FACING_STAFF_ROLES in contracts/vocab.ts.';

-- ---------------------------------------------------------------------------
-- 1. The story
-- ---------------------------------------------------------------------------

create table if not exists chat.story (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default chat.default_organization_id()
                     references chat.organization (id),

  title            text,
  body             text,

  -- Media reuses the existing object-storage seam exactly: a key into private
  -- storage, read through a short-lived signed URL minted per request. There is
  -- no second upload pipeline and no public bucket. The key is a name, never a
  -- capability (see 961184f) -- possession of it grants nothing.
  media_object_key text,
  media_kind       text,
  media_mime       text,

  state            text not null default 'draft',
  published_at     timestamptz,
  expires_at       timestamptz,

  created_by       uuid not null references chat.staff (id),
  published_by     uuid references chat.staff (id),

  deleted_at       timestamptz,
  deleted_by       uuid references chat.staff (id),
  deleted_reason   text,

  -- Stamped when the sweep has actually removed the bytes from object storage.
  -- Distinct from deleted_at/expires_at because access ends immediately while
  -- the bytes survive a retention window (section 7).
  media_purged_at  timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint story_state_check
    check (state in ('draft', 'published', 'expired', 'deleted')),
  constraint story_media_kind_check
    check (media_kind is null or media_kind in ('image', 'video')),
  -- Media is a key plus its kind, or neither. A key with no kind cannot be
  -- rendered and a kind with no key describes nothing.
  --
  -- The third branch is the PURGED story: retention clears the key, and the kind
  -- and mime stay so the publication record still says what kind of thing went
  -- out. Without it the retention sweep could not clear a key without also
  -- erasing what the story was -- which would make chat.story a worse audit trail
  -- every time it ran.
  constraint story_media_is_complete
    check ((media_object_key is null and media_kind is null and media_mime is null)
        or (media_object_key is not null and media_kind is not null)
        or (media_object_key is null and media_purged_at is not null
            and media_kind is not null)),
  -- A story with neither words nor a picture is not a story.
  constraint story_has_content
    check (coalesce(btrim(body), '') <> '' or media_object_key is not null),
  -- A published story knows when it went out, who published it, and when it
  -- stops. All three or none: an expiring publication with no expiry is how a
  -- "story" quietly becomes a permanent notice board.
  constraint story_published_is_complete
    check (state <> 'published'
           or (published_at is not null and published_by is not null and expires_at is not null)),
  -- An expired story keeps its publication facts: it was published once.
  constraint story_expired_was_published
    check (state <> 'expired' or (published_at is not null and expires_at is not null)),
  constraint story_deletion_is_stamped
    check (state <> 'deleted' or (deleted_at is not null and deleted_reason is not null)),
  -- Media cannot be recorded as purged while a key still points at it.
  constraint story_purge_clears_key
    check (media_purged_at is null or media_object_key is null)
);

comment on table chat.story is
  'A short-lived publication to a server-resolved audience. Publishing is '
  'restricted to the family-facing staff roles; the audience is resolved into '
  'chat.story_recipient server-side -- a client never states who may see a '
  'story and never filters a feed.';

comment on column chat.story.expires_at is
  'When access ends. Part of the read invariant in story_visible_to_audience, '
  'not merely an input to the sweep: a story past this instant is unreadable '
  'even if no sweep has run.';

-- The feed and publisher-list query: live stories, newest first.
create index if not exists story_live_idx
  on chat.story (organization_id, published_at desc)
  where state = 'published';

-- The expiry sweep.
create index if not exists story_expiry_idx
  on chat.story (expires_at) where state = 'published';

-- The media-retention sweep: rows whose bytes are still in storage.
create index if not exists story_media_purge_idx
  on chat.story (expires_at)
  where media_object_key is not null and media_purged_at is null;

drop trigger if exists story_set_updated_at on chat.story;
create trigger story_set_updated_at
  before update on chat.story
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The state machine
-- ---------------------------------------------------------------------------
--
--    draft ----> published ----> expired
--      |             |              |
--      +-------------+--------------+----> deleted
--
-- Allowed:  draft->published, draft->deleted, published->expired,
--           published->deleted, expired->deleted, and X->X (idempotent writes).
-- Refused:  anything out of `deleted` (it is terminal), published->draft,
--           expired->published, expired->draft, draft->expired.
--
-- Enforced by a trigger rather than left to the service, because "deterministic
-- and server-controlled" has to mean the database refuses it too. A resurrected
-- story is the one transition with a real security consequence: it would make a
-- publication readable again after its audience snapshot had gone stale.

create or replace function chat.guard_story_transition()
returns trigger
language plpgsql
as $$
begin
  if new.state = old.state then
    return new;
  end if;

  if old.state = 'deleted' then
    raise exception 'story % is deleted; deletion is terminal', old.id
      using errcode = 'check_violation';
  end if;

  if new.state = 'deleted' then
    return new;  -- reachable from draft, published and expired
  end if;

  if old.state = 'draft' and new.state = 'published' then
    return new;
  end if;

  if old.state = 'published' and new.state = 'expired' then
    return new;
  end if;

  raise exception 'story % may not move from % to %', old.id, old.state, new.state
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists story_transition_guard on chat.story;
create trigger story_transition_guard
  before update of state on chat.story
  for each row execute function chat.guard_story_transition();

-- ---------------------------------------------------------------------------
-- 3. The audience, as authored
-- ---------------------------------------------------------------------------
--
-- Kept alongside the resolved recipients rather than discarded, because "this
-- went to 412 people" is not an answer to "who did you send this to?". The
-- intent is what an operator reviews, reuses and explains.
--
-- THE VOCABULARY IS THIS SCHEMA'S, NOT THE OLD LINEAGE'S:
--
--   all_families       every family in the organization
--   all_teachers       every active teacher
--   assigned_families  the families this staff member SUPERVISES, resolved
--                      through chat.family.owner_id (SUPERVISOR-OWNERSHIP.md).
--                      NOT chat.learner.teacher_id: that links TEACHERS to
--                      families, and the author of a story is always staff
--   family             one chat.family
--   teacher            one chat.teacher
--   contact            one chat.contact
--   conversation       the members of one student_group / class_group
--                      conversation -- on this schema a "group" IS a
--                      conversation (chat.conversation_member); there is no
--                      chat.group_member table to point at
--
-- Deliberately ABSENT: `label`. The old lineage had a `label` kind backed by
-- chat.family_label, which does not exist here -- labels are Phase 2 and
-- unbuilt. Adding a label table for one audience clause would import Phase 2
-- scope and leave a table with no owner and no maintenance path.

create table if not exists chat.story_audience (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null references chat.story (id) on delete cascade,
  kind       text not null,
  -- Null exactly when the kind names no particular record. NOT a foreign key:
  -- it points into four different tables depending on kind, and the resolver
  -- validates it against the right one under the author's own scope -- so a
  -- forged id resolves to nothing rather than to somebody else's family.
  ref_id     uuid,
  created_at timestamptz not null default now(),

  constraint story_audience_kind_check
    check (kind in ('all_families', 'all_teachers', 'assigned_families',
                    'family', 'teacher', 'contact', 'conversation')),
  constraint story_audience_ref_matches_kind
    check ((kind in ('all_families', 'all_teachers', 'assigned_families') and ref_id is null)
        or (kind not in ('all_families', 'all_teachers', 'assigned_families') and ref_id is not null))
);

-- Naming the same audience twice is the same audience.
create unique index if not exists story_audience_unique
  on chat.story_audience (story_id, kind, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists story_audience_story_idx
  on chat.story_audience (story_id);

-- ---------------------------------------------------------------------------
-- 4. The audience, as resolved
-- ---------------------------------------------------------------------------

create table if not exists chat.story_recipient (
  story_id     uuid not null references chat.story (id) on delete cascade,
  actor_id     uuid not null,
  actor_kind   text not null,
  -- Which audience clause first matched this person. Diagnostics and reporting
  -- ("all_families reached 300, the group added 12"); never an authorization
  -- input.
  matched_kind text not null,
  created_at   timestamptz not null default now(),

  -- DEDUPLICATION IS THE PRIMARY KEY. Somebody who matches all_families AND a
  -- group AND was named individually is one row, because they cannot be two.
  -- There is no application-level DISTINCT to forget.
  primary key (story_id, actor_id),

  constraint story_recipient_actor_kind_check
    check (actor_kind in ('contact', 'staff', 'teacher'))
);

comment on table chat.story_recipient is
  'The audience resolved to people, once, server-side. The composite primary '
  'key IS the deduplication guarantee for overlapping audience clauses.';

-- The feed query: "the live stories for this person".
create index if not exists story_recipient_actor_idx
  on chat.story_recipient (actor_id, story_id);

-- ---------------------------------------------------------------------------
-- 5. Views
-- ---------------------------------------------------------------------------

create table if not exists chat.story_view (
  story_id  uuid not null references chat.story (id) on delete cascade,
  actor_id  uuid not null,
  viewed_at timestamptz not null default clock_timestamp(),
  -- Idempotent by construction: viewing twice is viewing.
  primary key (story_id, actor_id)
);

comment on table chat.story_view is
  'One row per person per story. The composite primary key is what makes a '
  'repeated view a no-op rather than a duplicate.';

create index if not exists story_view_story_idx
  on chat.story_view (story_id, viewed_at desc);

-- A view is only recordable by somebody the story was actually published to.
-- Without this, "mark viewed" is an existence oracle: post ids until one
-- succeeds and you have enumerated the academy's publications.
--
-- SECURITY DEFINER, and that is load-bearing. This trigger asks a question about
-- the world -- "is this actor in this story's audience?" -- and a system control
-- that reads under the CALLER's row-level security is not reading the world, it
-- is reading the caller's view of it. Without SECURITY DEFINER the lookup below
-- runs under story_recipient's read policy, which shows a reader only their OWN
-- rows; the trigger would then answer "not in the audience" for every row but
-- the caller's own, and its error message would be wrong about why.
--
-- It happens to fail CLOSED rather than open, so this was never an access bug.
-- But the layering was: the trigger would swallow cases that belong to the RLS
-- WITH CHECK (recording a view as somebody else), leaving no test able to tell
-- the two guards apart -- and a guard whose failures are indistinguishable from
-- another's is a guard you can delete without anything going red.
--
-- The search_path is pinned because a SECURITY DEFINER function that resolves
-- names through the caller's search_path can be pointed at a shadow table.
create or replace function chat.enforce_story_view_audience()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
begin
  if not exists (
    select 1 from chat.story_recipient r
     where r.story_id = new.story_id and r.actor_id = new.actor_id
  ) then
    raise exception 'actor % is not in the audience of story %', new.actor_id, new.story_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists story_view_audience_guard on chat.story_view;
create trigger story_view_audience_guard
  before insert on chat.story_view
  for each row execute function chat.enforce_story_view_audience();

-- ---------------------------------------------------------------------------
-- 6. Cross-tenant referential integrity
-- ---------------------------------------------------------------------------
--
-- story_audience / story_recipient / story_view carry no organization_id: they
-- inherit the tenant through story_id, the same way conversation_member and
-- message_receipt inherit theirs (20260906120000 excludes exactly this shape).
-- chat.story itself is a root entity and is guarded against pointing at another
-- tenant's organization row by its own FK plus its restrictive policy below.
--
-- BUT INHERITING TENANCY STRUCTURALLY IS NOT THE SAME AS ENFORCING IT. The child
-- tables need a tenant predicate of their OWN, because their permissive policies
-- grant on facts about the CALLER ("is this row mine?", "may I publish?") and
-- neither of those mentions an organization. The first draft of this migration
-- stopped at the FK and the RLS suite caught it immediately: a publisher in one
-- academy could read every other academy's viewer lists, recipient lists and
-- authored audiences, because `chat.current_can_publish_story()` is true for them
-- and nothing else in the predicate was.
--
-- So each child table gets a restrictive organization policy resolved through its
-- parent. SECURITY DEFINER, because "which tenant owns this story?" is a
-- structural fact and must not be answered from the caller's own view of
-- chat.story -- a reader cannot see an expired story, and a tenancy check that
-- inherited that blindness would start denying people their own rows.

create or replace function chat.story_organization_id(p_story_id uuid)
returns uuid
language sql
stable
security definer
set search_path = chat, pg_temp
as $$ select organization_id from chat.story where id = p_story_id $$;

comment on function chat.story_organization_id(uuid) is
  'The tenant that owns a story. SECURITY DEFINER because it answers a '
  'structural question for the restrictive policies on the story child tables, '
  'and must not inherit the caller''s visibility of chat.story.';

grant execute on function chat.story_organization_id(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Expiration and media retention
-- ---------------------------------------------------------------------------
--
-- Two clocks, deliberately separate:
--
--   ACCESS ends at expires_at. Immediately, and without waiting for any job:
--   the read policy and the service query both require expires_at > now().
--   A failed sweep therefore cannot extend anybody's access -- the worst a
--   stalled sweep does is leave rows labelled 'published' that nothing will
--   return.
--
--   BYTES are removed later, after story.media_retention_hours measured from
--   the moment access ended (expires_at, or deleted_at for a story an operator
--   removed). The window exists because an operator who deletes the wrong story
--   has a bounded interval in which the content still exists to be recovered,
--   and because deleting bytes inside the same transaction that revokes access
--   makes an accidental publication unrecoverable.
--
--     published -> expires_at reached -> access revoked -> retention window
--                                                       -> media purged
--
-- The story ROW is never hard-deleted: it is the audit trail of what the
-- academy published, and docs/contracts/DOMAIN-VOCABULARY.md's convention
-- across this schema is lifecycle state plus a stamp, never a DELETE.

insert into chat.config (key, value, scope, description) values
  ('story.default_lifetime_hours', '24'::jsonb, 'communication',
   'initial hypothesis - how long a published story stays readable.'),
  ('story.max_body_length', '2000'::jsonb, 'communication',
   'initial hypothesis - longest story body accepted.'),
  ('story.feed_page_size', '50'::jsonb, 'communication',
   'initial hypothesis - stories returned in one feed page.'),
  ('story.media_retention_hours', '72'::jsonb, 'communication',
   'initial hypothesis - how long story media survives in object storage after '
   'access ends, before the sweep purges it.')
on conflict (key) do nothing;

insert into chat.notification_template (key, locale, version, title, body) values
  ('story_published', 'ar', 1, 'جديد من {organization_name}', '{story_title}'),
  ('story_published', 'en', 1, 'New from {organization_name}', '{story_title}')
on conflict (key, locale, version) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Row level security -- deny by default
-- ---------------------------------------------------------------------------

alter table chat.story           enable row level security;
alter table chat.story_audience  enable row level security;
alter table chat.story_recipient enable row level security;
alter table chat.story_view      enable row level security;

drop policy if exists story_organization_isolation on chat.story;
create policy story_organization_isolation on chat.story
  as restrictive
  for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- The tenant boundary on the child tables (see section 6). RESTRICTIVE, so it
-- ANDs with every permissive policy below instead of widening anything, and
-- `for all` so it covers reads and writes alike. A story whose parent cannot be
-- resolved yields NULL, the comparison is NULL, and the row is denied -- the same
-- "NULL means see nothing" convention chat.current_organization_id() documents.
drop policy if exists story_audience_organization_isolation on chat.story_audience;
create policy story_audience_organization_isolation on chat.story_audience
  as restrictive for all
  using (chat.story_organization_id(story_id) = chat.current_organization_id())
  with check (chat.story_organization_id(story_id) = chat.current_organization_id());

drop policy if exists story_recipient_organization_isolation on chat.story_recipient;
create policy story_recipient_organization_isolation on chat.story_recipient
  as restrictive for all
  using (chat.story_organization_id(story_id) = chat.current_organization_id())
  with check (chat.story_organization_id(story_id) = chat.current_organization_id());

drop policy if exists story_view_organization_isolation on chat.story_view;
create policy story_view_organization_isolation on chat.story_view
  as restrictive for all
  using (chat.story_organization_id(story_id) = chat.current_organization_id())
  with check (chat.story_organization_id(story_id) = chat.current_organization_id());

-- A reader sees a story ONLY through the resolved audience, and ONLY while it is
-- live. There is no "fetch all stories and filter in the client" shape available
-- because the rows are not readable in the first place.
--
-- `expires_at > now()` IS PART OF THIS PREDICATE ON PURPOSE. The obvious version
-- of this policy gates on `state = 'published'` alone and leans on a sweep to
-- flip state; that leaves every story readable in the gap between its expiry and
-- the next sweep, and indefinitely if the sweep is wedged. Expiration is an
-- access invariant, not a maintenance task.
drop policy if exists story_visible_to_audience on chat.story;
create policy story_visible_to_audience on chat.story
  for select to authenticated
  using (
    (state = 'published'
     and expires_at > now()
     and deleted_at is null
     and exists (select 1 from chat.story_recipient r
                  where r.story_id = id
                    and r.actor_id in (select chat.current_actor_ids())))
    -- A publisher sees the organization's stories including drafts and expired
    -- ones, which is what the compose and reporting surfaces need.
    or chat.current_can_publish_story()
  );

-- The authored intent is an operator surface, not a reader one: it names
-- families, groups and teachers, and a parent who could read it would learn how
-- the academy segments its customers.
drop policy if exists story_audience_visible_to_publishers on chat.story_audience;
create policy story_audience_visible_to_publishers on chat.story_audience
  for select to authenticated
  using (chat.current_can_publish_story());

-- A recipient may confirm they are one; a publisher sees the whole list. What
-- nobody gets is the ability to read another person's row and learn who else
-- received a story.
drop policy if exists story_recipient_visible on chat.story_recipient;
create policy story_recipient_visible on chat.story_recipient
  for select to authenticated
  using (actor_id in (select chat.current_actor_ids())
         or chat.current_can_publish_story());

-- Viewer privacy. A viewer sees their own view row; a publisher sees the viewer
-- list for their organization's stories. A parent can never learn who else
-- watched.
drop policy if exists story_view_visible on chat.story_view;
create policy story_view_visible on chat.story_view
  for select to authenticated
  using (actor_id in (select chat.current_actor_ids())
         or chat.current_can_publish_story());

-- WRITES mirror the service rule, addressed `to authenticated`.
--
-- NOT `for all to chat_app using (true)`. That form reads as "let the
-- application work" and is in fact a PERMISSIVE policy that ORs with the read
-- policies above -- it would give every authenticated session unrestricted read
-- of every story and silently cancel the audience rule. The worker is
-- unaffected: it connects as chat_service, which bypasses RLS by design
-- (RLS-STRATEGY section 3).

drop policy if exists story_written_by_publisher on chat.story;
create policy story_written_by_publisher on chat.story
  for insert to authenticated
  with check (chat.current_can_publish_story());

drop policy if exists story_updated_by_publisher on chat.story;
create policy story_updated_by_publisher on chat.story
  for update to authenticated
  using (chat.current_can_publish_story())
  with check (chat.current_can_publish_story());

drop policy if exists story_audience_written_by_publisher on chat.story_audience;
create policy story_audience_written_by_publisher on chat.story_audience
  for insert to authenticated
  with check (chat.current_can_publish_story());

drop policy if exists story_recipient_written_by_publisher on chat.story_recipient;
create policy story_recipient_written_by_publisher on chat.story_recipient
  for insert to authenticated
  with check (chat.current_can_publish_story());

-- A view is written by the VIEWER, about themselves. Without the actor_id
-- clause a reader could record views on behalf of other people and, by seeing
-- which inserts succeeded, enumerate somebody else's audience membership. The
-- story_view_audience_guard trigger enforces the audience half.
drop policy if exists story_view_written_by_viewer on chat.story_view;
create policy story_view_written_by_viewer on chat.story_view
  for insert to authenticated
  with check (actor_id in (select chat.current_actor_ids()));

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------

grant select on chat.story, chat.story_audience, chat.story_recipient, chat.story_view
  to authenticated;
grant insert, update on chat.story to authenticated;
grant insert on chat.story_audience, chat.story_recipient, chat.story_view to authenticated;

grant select, insert, update on
  chat.story, chat.story_audience, chat.story_recipient, chat.story_view to chat_app;
grant select, insert, update, delete on
  chat.story, chat.story_audience, chat.story_recipient, chat.story_view to service_role;

grant execute on function chat.current_actor_ids() to authenticated, service_role;
grant execute on function chat.current_can_publish_story() to authenticated, service_role;
