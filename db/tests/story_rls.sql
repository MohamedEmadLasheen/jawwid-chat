-- Stories: row-level security regression suite.
--
-- Runs as `authenticated`, which does NOT bypass RLS. Running these as postgres
-- would pass trivially and prove nothing -- a superuser and a table owner bypass
-- every policy, which is exactly why the policies on this schema were once
-- described as "defined but inert" (docs/security/RLS-STRATEGY.md section 1).
--
-- WHY THIS SUITE EXISTS, GIVEN RLS IS NOT THE PRIMARY CONTROL
--
-- StoryService is the primary authorization boundary and is covered by
-- apps/api/test/integration/stories.spec.ts. These policies are the SECOND
-- layer, and they are inert on the API path today because the API connects as
-- the owner and sets no actor context. A policy nobody executes is a policy that
-- rots: the point of RLS-STRATEGY is that the day the API starts setting
-- `chat.actor_subject`, these predicates are already right. This suite is what
-- makes that claim testable now rather than on that day.
--
-- THE ONE SECTION WORTH READING THE FILE FOR IS C. A story past its expires_at is
-- invisible even while its state column still says 'published'. The abandoned
-- Phase 5 lineage gated its read policy on state alone, so expiry there was only
-- as timely as a background sweep, and a wedged sweep left stories readable
-- indefinitely. Expiration is an access invariant here, not a maintenance task.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: two tenants, a publisher each, two readers
-- ---------------------------------------------------------------------------
--
-- Synthetic names only (QA gate G-16): story_admin_a, story_parent_1.

insert into chat.organization (id, slug, display_name) values
  ('11111111-0000-0000-0000-000000000a01', 'story-org-a', 'Story Org A'),
  ('11111111-0000-0000-0000-000000000b01', 'story-org-b', 'Story Org B')
on conflict (id) do nothing;

insert into chat.account (id, subject, kind, organization_id) values
  ('11111111-0000-0000-0000-000000000a02', 'story-admin-a',  'staff',
   '11111111-0000-0000-0000-000000000a01'),
  ('11111111-0000-0000-0000-000000000a03', 'story-parent-1', 'family',
   '11111111-0000-0000-0000-000000000a01'),
  ('11111111-0000-0000-0000-000000000a04', 'story-parent-2', 'family',
   '11111111-0000-0000-0000-000000000a01'),
  ('11111111-0000-0000-0000-000000000b02', 'story-admin-b',  'staff',
   '11111111-0000-0000-0000-000000000b01')
on conflict (id) do nothing;

insert into chat.staff (id, account_id, name, role, organization_id) values
  ('11111111-0000-0000-0000-000000000a05', '11111111-0000-0000-0000-000000000a02',
   'story_admin_a', 'admin', '11111111-0000-0000-0000-000000000a01'),
  ('11111111-0000-0000-0000-000000000b05', '11111111-0000-0000-0000-000000000b02',
   'story_admin_b', 'admin', '11111111-0000-0000-0000-000000000b01')
on conflict (id) do nothing;

insert into chat.family (id, display_name, owner_id, organization_id) values
  ('11111111-0000-0000-0000-000000000a06', 'story_family',
   '11111111-0000-0000-0000-000000000a05', '11111111-0000-0000-0000-000000000a01')
on conflict (id) do nothing;

insert into chat.contact
  (id, family_id, name, role_preset, can_message, is_active, account_id, organization_id) values
  ('11111111-0000-0000-0000-000000000a07', '11111111-0000-0000-0000-000000000a06',
   'story_parent_1', 'primary_guardian', true, true,
   '11111111-0000-0000-0000-000000000a03', '11111111-0000-0000-0000-000000000a01'),
  ('11111111-0000-0000-0000-000000000a08', '11111111-0000-0000-0000-000000000a06',
   'story_parent_2', 'authorized_contact', true, true,
   '11111111-0000-0000-0000-000000000a04', '11111111-0000-0000-0000-000000000a01')
on conflict (id) do nothing;

insert into chat.story
  (id, organization_id, body, state, published_at, expires_at, created_by, published_by) values
  -- LIVE.
  ('11111111-0000-0000-0000-000000000a10', '11111111-0000-0000-0000-000000000a01',
   'live story', 'published', now(), now() + interval '1 hour',
   '11111111-0000-0000-0000-000000000a05', '11111111-0000-0000-0000-000000000a05'),
  -- STALE: expires_at has passed, but state STILL SAYS PUBLISHED because no sweep
  -- has run. This is the row section C is about.
  ('11111111-0000-0000-0000-000000000a11', '11111111-0000-0000-0000-000000000a01',
   'stale story', 'published', now() - interval '2 days', now() - interval '1 day',
   '11111111-0000-0000-0000-000000000a05', '11111111-0000-0000-0000-000000000a05'),
  -- Another tenant's, otherwise identical to the live one.
  ('11111111-0000-0000-0000-000000000b10', '11111111-0000-0000-0000-000000000b01',
   'other tenant story', 'published', now(), now() + interval '1 hour',
   '11111111-0000-0000-0000-000000000b05', '11111111-0000-0000-0000-000000000b05')
on conflict (id) do nothing;

insert into chat.story (id, organization_id, body, state, created_by) values
  ('11111111-0000-0000-0000-000000000a12', '11111111-0000-0000-0000-000000000a01',
   'draft story', 'draft', '11111111-0000-0000-0000-000000000a05')
on conflict (id) do nothing;

insert into chat.story
  (id, organization_id, body, state, published_at, expires_at, created_by, published_by,
   deleted_at, deleted_reason) values
  ('11111111-0000-0000-0000-000000000a13', '11111111-0000-0000-0000-000000000a01',
   'deleted story', 'deleted', now(), now() + interval '1 hour',
   '11111111-0000-0000-0000-000000000a05', '11111111-0000-0000-0000-000000000a05',
   now(), 'removed in error')
on conflict (id) do nothing;

-- parent_1 is a recipient of the live, stale and deleted stories. parent_2 is a
-- recipient of NONE, which is what makes it possible to tell "not published to
-- me" apart from "does not exist".
insert into chat.story_recipient (story_id, actor_id, actor_kind, matched_kind) values
  ('11111111-0000-0000-0000-000000000a10', '11111111-0000-0000-0000-000000000a07',
   'contact', 'all_families'),
  ('11111111-0000-0000-0000-000000000a11', '11111111-0000-0000-0000-000000000a07',
   'contact', 'all_families'),
  ('11111111-0000-0000-0000-000000000a13', '11111111-0000-0000-0000-000000000a07',
   'contact', 'all_families')
on conflict do nothing;

insert into chat.story_audience (story_id, kind) values
  ('11111111-0000-0000-0000-000000000a10', 'all_families')
on conflict do nothing;

insert into chat.story_view (story_id, actor_id) values
  ('11111111-0000-0000-0000-000000000a10', '11111111-0000-0000-0000-000000000a07')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Helpers (the same idiom as tenant_isolation.sql)
-- ---------------------------------------------------------------------------

create or replace function pg_temp.want_ok(label text, ok boolean)
returns void language plpgsql as $$
begin
  if ok then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

-- RLS silently filters UPDATE and DELETE rather than raising, so "0 rows
-- affected" is the denial signal for those.
create or replace function pg_temp.affected(stmt text)
returns integer language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- True only when the statement was rejected FOR THE EXPECTED REASON. A bare
-- `when others then return true` would let an unrelated fixture failure
-- masquerade as security working.
create or replace function pg_temp.expect_violation(stmt text, needle text)
returns boolean language plpgsql as $$
declare msg text;
begin
  execute stmt;
  return false;                       -- succeeded: not denied at all
exception when others then
  get stacked diagnostics msg = message_text;
  if position(needle in msg) = 0 then
    raise exception 'rejected, but for the wrong reason: %', msg;
  end if;
  return true;
end;
$$;

create or replace function pg_temp.expect_ok(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception when others then
  return false;
end;
$$;

-- ===========================================================================
-- A · A recipient sees what was published to them
-- ===========================================================================

set local role authenticated;
set local chat.actor_subject = 'story-parent-1';

select pg_temp.want_ok(
  'A1 current_actor_ids() resolves the caller to their own contact row',
  (select count(*) from chat.current_actor_ids() a
    where a = '11111111-0000-0000-0000-000000000a07') = 1
);

select pg_temp.want_ok(
  'A2 a recipient sees the live story',
  (select count(*) from chat.story where id = '11111111-0000-0000-0000-000000000a10') = 1
);

select pg_temp.want_ok(
  'A3 a reader is not a publisher',
  chat.current_can_publish_story() = false
);

-- ===========================================================================
-- B · A reader never sees a draft, a deleted story, or another tenant's
-- ===========================================================================

select pg_temp.want_ok(
  'B1 a reader cannot see a DRAFT, even in their own organization',
  (select count(*) from chat.story where id = '11111111-0000-0000-0000-000000000a12') = 0
);

select pg_temp.want_ok(
  'B2 a reader cannot see a DELETED story they were a recipient of',
  (select count(*) from chat.story where id = '11111111-0000-0000-0000-000000000a13') = 0
);

select pg_temp.want_ok(
  'B3 a reader cannot see another organization''s story',
  (select count(*) from chat.story where id = '11111111-0000-0000-0000-000000000b10') = 0
);

-- ===========================================================================
-- C · EXPIRY IS PART OF THE READ PREDICATE, not a job's responsibility
-- ===========================================================================
--
-- Read the stale row's state as the PUBLISHER (who may see expired stories),
-- then look for it as the reader. Two callers, because the whole point is that
-- the row is there and labelled `published` while being unreadable.

set local chat.actor_subject = 'story-admin-a';

select pg_temp.want_ok(
  'C1 the stale story''s state column still says published -- no sweep has run',
  (select state from chat.story where id = '11111111-0000-0000-0000-000000000a11') = 'published'
);

set local chat.actor_subject = 'story-parent-1';

select pg_temp.want_ok(
  'C2 and its recipient STILL cannot read it, because expires_at is in the past',
  (select count(*) from chat.story where id = '11111111-0000-0000-0000-000000000a11') = 0
);

select pg_temp.want_ok(
  'C3 the recipient row is still there -- it is the STORY that is unreadable, not the join',
  (select count(*) from chat.story_recipient
    where story_id = '11111111-0000-0000-0000-000000000a11') = 1
);

-- ===========================================================================
-- D · A non-recipient sees nothing at all
-- ===========================================================================

set local chat.actor_subject = 'story-parent-2';

select pg_temp.want_ok(
  'D1 parent_2 DOES resolve to an actor -- so D2 is about audience, not a failed lookup',
  (select count(*) from chat.current_actor_ids() a
    where a = '11111111-0000-0000-0000-000000000a08') = 1
);

select pg_temp.want_ok(
  'D2 a NON-RECIPIENT in the same family and organization sees NO story at all',
  (select count(*) from chat.story) = 0
);

select pg_temp.want_ok(
  'D3 and no recipient rows, so they cannot enumerate who was addressed',
  (select count(*) from chat.story_recipient) = 0
);

-- ===========================================================================
-- E · A reader cannot write a story, or write a view as somebody else
-- ===========================================================================

set local chat.actor_subject = 'story-parent-1';

select pg_temp.want_ok(
  'E1 a reader cannot INSERT a story',
  pg_temp.expect_violation($$
    insert into chat.story (organization_id, body, created_by)
    values ('11111111-0000-0000-0000-000000000a01', 'forged',
            '11111111-0000-0000-0000-000000000a05')
  $$, 'row-level security')
);

select pg_temp.want_ok(
  'E2 a reader cannot UPDATE a story (0 rows pass the policy)',
  pg_temp.affected($$
    update chat.story set body = 'hijacked'
     where id = '11111111-0000-0000-0000-000000000a10'
  $$) = 0
);

-- Two layers guard chat.story_view, and they catch different things. A BEFORE
-- INSERT trigger runs BEFORE the RLS WITH CHECK is evaluated, so whichever
-- condition the row violates first is the error you get. Both are asserted
-- separately, because a test that accepted either message would pass even if one
-- of the two layers were removed.

set local chat.actor_subject = 'story-parent-2';

select pg_temp.want_ok(
  'E3 the RLS clause stops a view recorded ON BEHALF OF ANOTHER ACTOR '
  '(parent_1 IS in the audience, so the trigger is satisfied and only RLS can refuse)',
  pg_temp.expect_violation($$
    insert into chat.story_view (story_id, actor_id)
    values ('11111111-0000-0000-0000-000000000a10', '11111111-0000-0000-0000-000000000a07')
  $$, 'row-level security')
);

set local chat.actor_subject = 'story-parent-1';

select pg_temp.want_ok(
  'E3b the TRIGGER stops a view on a story the actor was never sent, '
  'closing the enumeration oracle',
  pg_temp.expect_violation($$
    insert into chat.story_view (story_id, actor_id)
    values ('11111111-0000-0000-0000-000000000a12', '11111111-0000-0000-0000-000000000a07')
  $$, 'not in the audience')
);

select pg_temp.want_ok(
  'E3c a recipient MAY record their own view -- the guards refuse the wrong writes, not every write',
  pg_temp.expect_ok($$
    insert into chat.story_view (story_id, actor_id)
    values ('11111111-0000-0000-0000-000000000a11', '11111111-0000-0000-0000-000000000a07')
  $$)
);

select pg_temp.want_ok(
  'E4 a reader cannot add THEMSELVES to an audience',
  pg_temp.expect_violation($$
    insert into chat.story_recipient (story_id, actor_id, actor_kind, matched_kind)
    values ('11111111-0000-0000-0000-000000000a12', '11111111-0000-0000-0000-000000000a07',
            'contact', 'forged')
  $$, 'row-level security')
);

-- ===========================================================================
-- F · Viewer privacy: a reader sees their own rows and nobody else's
-- ===========================================================================

select pg_temp.want_ok(
  'F1 a reader sees their OWN view rows (the seeded one, plus the one E3c recorded)',
  (select count(*) from chat.story_view
    where actor_id = '11111111-0000-0000-0000-000000000a07'
      and story_id = '11111111-0000-0000-0000-000000000a10') = 1
);

select pg_temp.want_ok(
  'F2 a reader sees NO OTHER actor''s view rows',
  (select count(*) from chat.story_view
    where actor_id <> '11111111-0000-0000-0000-000000000a07') = 0
);

select pg_temp.want_ok(
  'F3 a reader sees only their own recipient rows, never who else received a story',
  (select count(*) from chat.story_recipient
    where actor_id <> '11111111-0000-0000-0000-000000000a07') = 0
);

select pg_temp.want_ok(
  'F4 a reader cannot read the AUTHORED audience -- it names how the academy segments families',
  (select count(*) from chat.story_audience) = 0
);

-- ===========================================================================
-- G · The publisher's view
-- ===========================================================================

set local chat.actor_subject = 'story-admin-a';

select pg_temp.want_ok(
  'G1 a publisher is recognised as one',
  chat.current_can_publish_story() = true
);

select pg_temp.want_ok(
  'G2 a publisher sees their organization''s drafts',
  (select count(*) from chat.story where id = '11111111-0000-0000-0000-000000000a12') = 1
);

select pg_temp.want_ok(
  'G3 a publisher sees stale and deleted stories -- the reporting surface',
  (select count(*) from chat.story
    where id in ('11111111-0000-0000-0000-000000000a11',
                 '11111111-0000-0000-0000-000000000a13')) = 2
);

select pg_temp.want_ok(
  'G4 a publisher sees the authored audience',
  (select count(*) from chat.story_audience) >= 1
);

select pg_temp.want_ok(
  'G5 a publisher sees the viewer list',
  (select count(*) from chat.story_view
    where story_id = '11111111-0000-0000-0000-000000000a10') = 1
);

select pg_temp.want_ok(
  'G6 a publisher STILL cannot see another organization''s story',
  (select count(*) from chat.story where id = '11111111-0000-0000-0000-000000000b10') = 0
);

select pg_temp.want_ok(
  'G7 a publisher may insert a story into their OWN organization',
  pg_temp.expect_ok($$
    insert into chat.story (organization_id, body, created_by)
    values ('11111111-0000-0000-0000-000000000a01', 'legitimate',
            '11111111-0000-0000-0000-000000000a05')
  $$)
);

select pg_temp.want_ok(
  'G8 a publisher may NOT insert a story into ANOTHER organization (WITH CHECK)',
  pg_temp.expect_violation($$
    insert into chat.story (organization_id, body, created_by)
    values ('11111111-0000-0000-0000-000000000b01', 'smuggled',
            '11111111-0000-0000-0000-000000000a05')
  $$, 'row-level security')
);

-- ===========================================================================
-- H · The other tenant's publisher is symmetrically blind
-- ===========================================================================

set local chat.actor_subject = 'story-admin-b';

select pg_temp.want_ok(
  'H1 org B''s publisher sees org B''s story',
  (select count(*) from chat.story where id = '11111111-0000-0000-0000-000000000b10') = 1
);

select pg_temp.want_ok(
  'H2 org B''s publisher sees NONE of org A''s stories',
  (select count(*) from chat.story
    where organization_id = '11111111-0000-0000-0000-000000000a01') = 0
);

-- H3-H5 are the regression for a real defect found while writing this suite: the
-- child tables' permissive policies grant on facts about the CALLER, so a
-- publisher in ANY tenant satisfied them for EVERY tenant's rows. Nothing in the
-- first draft joined back to the owning organization.
select pg_temp.want_ok(
  'H3 org B''s publisher sees none of org A''s VIEWER rows',
  (select count(*) from chat.story_view) = 0
);

select pg_temp.want_ok(
  'H4 org B''s publisher sees none of org A''s RECIPIENT rows',
  (select count(*) from chat.story_recipient) = 0
);

select pg_temp.want_ok(
  'H5 org B''s publisher sees none of org A''s AUTHORED AUDIENCES',
  (select count(*) from chat.story_audience) = 0
);

rollback;

\echo ''
\echo 'ALL STORY RLS TESTS PASSED'
