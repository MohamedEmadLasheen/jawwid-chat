-- Jawwid Chat -- Phase 7.2: approved knowledge.
--
-- The assistant does not know what a course costs. It must not guess, and the
-- guarantee that it cannot has to be structural rather than a line in a prompt.
--
-- ## The grounding contract
--
-- An answer is assembled from rows of chat.knowledge_article whose status is
-- 'approved', and the service rejects any answer citing an article that was not
-- in the set it was given (KnowledgeService / FaqService). So the worst a model
-- can do is decline. It cannot invent a price, because a price it invented
-- carries no article id, and an answer with no article id is not returned.
--
-- ## Why approval is a separate permission from authoring
--
-- Approved knowledge is what the academy says to families. Publishing one is an
-- organization-wide commitment in exactly the way renaming a label is -- which
-- this system already decided is a manager's act while filing a family under an
-- existing label is an admin's (20260907130200). The same split applies here:
-- an admin drafts, a manager approves. Without it, "the assistant told a parent
-- we guarantee a refund" has no reviewer between the draft and the family.

-- ---------------------------------------------------------------------------
-- 1. The article
-- ---------------------------------------------------------------------------

create table if not exists chat.knowledge_article (
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  id              uuid primary key default gen_random_uuid(),

  -- What a manager scans in a list.
  title           text not null check (length(btrim(title)) > 0),
  -- The question this answers, in the words a family would use. Retrieval
  -- matches against this hardest, because a parent asks "هل عندكم كورس تأسيس"
  -- and never "Foundation Course -- Availability".
  question        text not null check (length(btrim(question)) > 0),
  -- The APPROVED words. This is what reaches a family, so it is reviewed as
  -- text and not as an instruction to a model.
  answer          text not null check (length(btrim(answer)) > 0),

  category        text not null default 'general',
  locale          text not null default 'ar' check (locale in ('ar', 'en')),

  -- draft     -> being written; never retrieved for grounding
  -- approved  -> live; the ONLY status the assistant may ground on
  -- inactive  -> retired without being deleted, so history still resolves
  status          text not null default 'draft'
                    check (status in ('draft', 'approved', 'inactive')),

  -- Bumped on every content change (chat.knowledge_bump_version). A summary or
  -- an answer can therefore name the exact revision it used, and a later edit
  -- does not silently rewrite what was said last week (Phase 7 §8).
  version         integer not null default 1,

  created_by      uuid references chat.staff (id) on delete set null,
  updated_by      uuid references chat.staff (id) on delete set null,
  approved_by     uuid references chat.staff (id) on delete set null,
  approved_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- An approved row without an approver is unattributable, and the point of
  -- approval is attribution.
  constraint knowledge_article_approval_attributed
    check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

comment on table chat.knowledge_article is
  'The academy answers the assistant is allowed to give. Only status = approved '
  'is ever retrieved for grounding; an answer citing anything else is rejected '
  'by the service before it reaches a person (Phase 7 §7).';

-- Retrieval, without a vector database (Phase 7 §38).
--
-- 'simple' rather than 'arabic' or 'english': the corpus is bilingual and a
-- single stemmer would be wrong for half of it, while 'simple' tokenises both
-- and is honest about doing no stemming. What this buys is word-overlap
-- matching, which is what a curated FAQ of tens-to-hundreds of entries needs.
-- If the corpus ever grows past that, this is the line to revisit -- and the
-- service boundary means only this column and KnowledgeService.search change.
alter table chat.knowledge_article
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('simple',
      coalesce(title, '') || ' ' || coalesce(question, '') || ' ' || coalesce(answer, ''))
  ) stored;

create index if not exists knowledge_article_search_idx
  on chat.knowledge_article using gin (search_vector);

-- The retrieval filter: approved, in this locale, in this organization.
create index if not exists knowledge_article_approved_idx
  on chat.knowledge_article (organization_id, locale, category)
  where status = 'approved';

drop trigger if exists knowledge_article_set_updated_at on chat.knowledge_article;
create trigger knowledge_article_set_updated_at
  before update on chat.knowledge_article
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Revisions -- append-only
-- ---------------------------------------------------------------------------
--
-- Phase 7 §8 asks for who changed it, when, the previous content, the new
-- content and the approval state. This stores a SNAPSHOT per version rather
-- than a before/after pair: the previous content is the previous row, so the
-- two never disagree, and a chain of snapshots answers "what did we say in
-- March" -- which a before/after diff log cannot without replaying every edit.

create table if not exists chat.knowledge_revision (
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),
  id              uuid primary key default gen_random_uuid(),
  article_id      uuid not null references chat.knowledge_article (id) on delete cascade,
  version         integer not null,

  title           text not null,
  question        text not null,
  answer          text not null,
  category        text not null,
  locale          text not null,
  status          text not null,

  changed_by      uuid references chat.staff (id) on delete set null,
  -- Why, in the author's words. Mandatory for the same reason every other
  -- sensitive action in this system carries one: a change nobody explained is
  -- a change nobody can review.
  change_reason   text not null check (length(btrim(change_reason)) > 0),
  changed_at      timestamptz not null default now(),

  unique (article_id, version)
);

comment on table chat.knowledge_revision is
  'Append-only snapshot of a knowledge article at each version. The previous '
  'content is the previous row, so no before/after pair can disagree with '
  'itself, and "what did we tell families in March" is answerable.';

create index if not exists knowledge_revision_article_idx
  on chat.knowledge_revision (article_id, version desc);

-- ---------------------------------------------------------------------------
-- 3. Permissions
-- ---------------------------------------------------------------------------

insert into chat.permission (key, description) values
('knowledge.read',    'Read the approved knowledge the assistant grounds its answers on'),
('knowledge.manage',  'Create and edit knowledge articles as drafts'),
('knowledge.approve', 'Approve a draft, or retire an approved article')
on conflict (key) do update set description = excluded.description;

-- admin and coverage_admin hold IDENTICAL keys, as everywhere else in this
-- model: they differ in scope, never in vocabulary. Neither approves.
insert into chat.role_permission (role, permission)
select r.role, r.permission
from (values
  ('admin',          'knowledge.read'),
  ('coverage_admin', 'knowledge.read'),
  ('manager',        'knowledge.read'),
  ('super_admin',    'knowledge.read'),
  ('admin',          'knowledge.manage'),
  ('coverage_admin', 'knowledge.manage'),
  ('manager',        'knowledge.manage'),
  ('super_admin',    'knowledge.manage'),
  ('manager',        'knowledge.approve'),
  ('super_admin',    'knowledge.approve')
) as r(role, permission)
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Version bump + revision, in the database
-- ---------------------------------------------------------------------------
--
-- Two triggers, not one, and the split is forced by ordering.
--
-- The version bump must happen BEFORE the write, because it modifies the row
-- being written. The revision insert must happen AFTER it, because it carries a
-- foreign key to a row that does not exist yet during a BEFORE INSERT. The
-- first draft of this migration did both in one BEFORE trigger and every insert
-- failed on that foreign key.
--
-- They are in the database rather than in the service because the invariant is
-- "no content change without a version and a revision", and an invariant
-- enforced in one service is one the next caller forgets. The reason arrives
-- through a transaction-local setting; without one the write fails, which is
-- the intended pressure.

create or replace function chat.knowledge_reviewable_change(
  p_old chat.knowledge_article, p_new chat.knowledge_article)
returns boolean
language sql
immutable
as $$
  select p_new.title    is distinct from p_old.title
      or p_new.question is distinct from p_old.question
      or p_new.answer   is distinct from p_old.answer
      or p_new.category is distinct from p_old.category
      or p_new.locale   is distinct from p_old.locale
      or p_new.status   is distinct from p_old.status;
$$;

comment on function chat.knowledge_reviewable_change is
  'Whether an update changed something a reviewer would care about. A touch or '
  'an approver backfill is not a new version: versions count content changes, '
  'not writes.';

create or replace function chat.knowledge_require_reason()
returns text
language plpgsql
stable
as $$
declare
  v_reason text;
begin
  v_reason := nullif(current_setting('chat.knowledge_change_reason', true), '');
  if v_reason is null then
    raise exception 'a knowledge change requires a reason'
      using errcode = 'check_violation';
  end if;
  return v_reason;
end;
$$;

create or replace function chat.knowledge_bump_version()
returns trigger
language plpgsql
as $$
begin
  if not chat.knowledge_reviewable_change(old, new) then
    return new;
  end if;
  perform chat.knowledge_require_reason();
  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function chat.knowledge_write_revision()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_catalog
as $$
begin
  -- On UPDATE the bump trigger already decided whether this was reviewable, and
  -- said so by changing the version. Re-deriving it here could disagree.
  if tg_op = 'UPDATE' and new.version = old.version then
    return null;
  end if;

  insert into chat.knowledge_revision
    (organization_id, article_id, version, title, question, answer,
     category, locale, status, changed_by, change_reason)
  values
    (new.organization_id, new.id, new.version, new.title, new.question,
     new.answer, new.category, new.locale, new.status,
     coalesce(new.updated_by, new.created_by), chat.knowledge_require_reason());

  return null;
end;
$$;

drop trigger if exists knowledge_article_revision on chat.knowledge_article;
drop trigger if exists knowledge_article_bump_version on chat.knowledge_article;
create trigger knowledge_article_bump_version
  before update on chat.knowledge_article
  for each row execute function chat.knowledge_bump_version();

drop trigger if exists knowledge_article_write_revision on chat.knowledge_article;
create trigger knowledge_article_write_revision
  after insert or update on chat.knowledge_article
  for each row execute function chat.knowledge_write_revision();

-- ---------------------------------------------------------------------------
-- 5. RLS -- deny by default
-- ---------------------------------------------------------------------------

alter table chat.knowledge_article  enable row level security;
alter table chat.knowledge_revision enable row level security;

drop policy if exists knowledge_article_organization_isolation on chat.knowledge_article;
create policy knowledge_article_organization_isolation on chat.knowledge_article
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists knowledge_revision_organization_isolation on chat.knowledge_revision;
create policy knowledge_revision_organization_isolation on chat.knowledge_revision
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- A reader with knowledge.read sees APPROVED articles. Drafts and retired ones
-- are visible only to those who may write them -- a draft is somebody's
-- unreviewed opinion about academy policy, and it should not be quotable.
drop policy if exists knowledge_article_readable on chat.knowledge_article;
create policy knowledge_article_readable on chat.knowledge_article
  for select to authenticated
  using (
    (status = 'approved' and chat.current_has_permission('knowledge.read'))
    or chat.current_has_permission('knowledge.manage')
  );

-- The revision history is an audit surface: it shows what the academy used to
-- promise. Editors and auditors, not every reader.
drop policy if exists knowledge_revision_readable on chat.knowledge_revision;
create policy knowledge_revision_readable on chat.knowledge_revision
  for select to authenticated
  using (chat.current_has_permission('knowledge.manage')
         or chat.current_has_permission('audit.read'));

grant select on chat.knowledge_article, chat.knowledge_revision to authenticated;
grant select, insert, update on chat.knowledge_article to chat_app;
grant select, insert on chat.knowledge_revision to chat_app;
grant select, insert, update, delete on
  chat.knowledge_article, chat.knowledge_revision to service_role;

-- WRITES, addressed `to authenticated` and never `for all to chat_app using
-- (true)` -- which is permissive and would OR away the read policies above,
-- exposing every draft to every authenticated session (the trap Phase 5
-- documented on chat.story, 20260907150100 §6).

drop policy if exists knowledge_article_written_by_editor on chat.knowledge_article;
create policy knowledge_article_written_by_editor on chat.knowledge_article
  for insert to authenticated
  with check (
    chat.current_has_permission('knowledge.manage')
    -- Nobody publishes in one step. An article is created as a draft and
    -- approved by somebody who holds knowledge.approve, so authoring and
    -- approving cannot be the same act even when one person holds both keys.
    and status = 'draft'
  );

-- THE approval boundary, in the database as well as the service.
--
-- An editor may edit; only knowledge.approve may move a row INTO or OUT OF
-- 'approved'. Written as a comparison against the existing row, so the rule is
-- about the transition rather than about the resulting value -- an editor can
-- still fix a typo in an approved article's neighbours without being able to
-- approve one.
drop policy if exists knowledge_article_updated_by_editor on chat.knowledge_article;
create policy knowledge_article_updated_by_editor on chat.knowledge_article
  for update to authenticated
  using (chat.current_has_permission('knowledge.manage'))
  with check (
    chat.current_has_permission('knowledge.approve')
    or (status <> 'approved' and chat.current_has_permission('knowledge.manage'))
  );

-- Revisions are written by the trigger, which runs as definer; this covers the
-- authenticated path so the trigger's insert is not the only thing that must
-- be right.
drop policy if exists knowledge_revision_written_by_editor on chat.knowledge_revision;
create policy knowledge_revision_written_by_editor on chat.knowledge_revision
  for insert to authenticated
  with check (chat.current_has_permission('knowledge.manage'));
