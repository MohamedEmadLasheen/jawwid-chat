-- Jawwid Chat -- organization_id on every tenant table.
--
-- PRD v0.1 §2.3: "Not multi-tenant, but the data model carries an
-- organization_id on every root entity from day one so a future SaaS conversion
-- is a migration, not a rewrite."
--
-- WHAT COUNTS AS A ROOT ENTITY. The PRD does not define the term, so it is not
-- guessed at here. The schema was classified mechanically, by composition:
-- a table is DERIVED when it has a NOT NULL foreign key with ON DELETE CASCADE
-- to another chat table (the schema's own declaration that the row cannot exist
-- without its parent), and ROOT otherwise. That yielded 19 root and 24 derived
-- tables; the full classification is in docs/architecture/organization-model.md.
--
-- WHY EVERY TENANT TABLE GETS THE COLUMN ANYWAY. Putting it only on roots makes
-- the tenant of a derived row a matter of traversal, which RLS would have to
-- re-derive on every read, and which nothing would stop from straddling two
-- organizations -- a conversation in organization A referencing a learner in
-- organization B. Carrying it everywhere lets each foreign key become COMPOSITE:
--
--     FOREIGN KEY (family_id, organization_id)
--       REFERENCES chat.family (id, organization_id)
--
-- With that, a cross-organization reference is not merely rejected by a policy
-- or a trigger -- it is unrepresentable. All 67 foreign keys below are upgraded
-- this way. Root tables additionally reference chat.organization directly.
--
-- chat.schema_migrations is deliberately excluded: it is the deployment's
-- migration ledger, not tenant data.

create table chat.organization (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  display_name text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table chat.organization is
  'The tenant. Exactly one row exists in this phase (PRD §2.3: "Internal '
  'product for Jawwid in this phase"). Nothing in the schema assumes that, so '
  'a second row is a data change rather than a migration.';

create trigger organization_set_updated_at
  before update on chat.organization
  for each row execute function chat.set_updated_at();

-- The founding organization. Created here, in the migration, so that every
-- existing row has somewhere to belong and no table is ever briefly nullable in
-- production. chat.bootstrap_organization() (next migration) is how a second
-- one would be created.
insert into chat.organization (slug, display_name)
values ('jawwid', 'Jawwid Online Quran & Arabic Academy');

-- Add the column, backfill it from the founding organization, and pin it.
-- The column is NOT NULL from the end of this migration onward: a tenant-less
-- row must never be representable, not even briefly.

alter table chat.absence add column organization_id uuid;
alter table chat.account add column organization_id uuid;
alter table chat.audit_log add column organization_id uuid;
alter table chat.call add column organization_id uuid;
alter table chat.call_participant add column organization_id uuid;
alter table chat.class_session add column organization_id uuid;
alter table chat.config add column organization_id uuid;
alter table chat.contact add column organization_id uuid;
alter table chat.conversation add column organization_id uuid;
alter table chat.conversation_member add column organization_id uuid;
alter table chat.conversation_participant_state add column organization_id uuid;
alter table chat.core_event add column organization_id uuid;
alter table chat.core_parent_inbox add column organization_id uuid;
alter table chat.coverage_rule add column organization_id uuid;
alter table chat.device_token add column organization_id uuid;
alter table chat.enrollment add column organization_id uuid;
alter table chat.event_log add column organization_id uuid;
alter table chat.family add column organization_id uuid;
alter table chat.family_note add column organization_id uuid;
alter table chat.family_state_cache add column organization_id uuid;
alter table chat.handoff add column organization_id uuid;
alter table chat.learner add column organization_id uuid;
alter table chat.message add column organization_id uuid;
alter table chat.message_approval add column organization_id uuid;
alter table chat.message_attachment add column organization_id uuid;
alter table chat.message_hidden_for add column organization_id uuid;
alter table chat.message_reaction add column organization_id uuid;
alter table chat.message_receipt add column organization_id uuid;
alter table chat.notification add column organization_id uuid;
alter table chat.notification_rule add column organization_id uuid;
alter table chat.notification_template add column organization_id uuid;
alter table chat.outbox_event add column organization_id uuid;
alter table chat.payment add column organization_id uuid;
alter table chat.quiet_hours add column organization_id uuid;
alter table chat.shift add column organization_id uuid;
alter table chat.staff add column organization_id uuid;
alter table chat.subscription add column organization_id uuid;
alter table chat.support_case add column organization_id uuid;
alter table chat.sync_state add column organization_id uuid;
alter table chat.task add column organization_id uuid;
alter table chat.teacher add column organization_id uuid;
alter table chat.thread add column organization_id uuid;

do $$
declare
  v_org uuid := (select id from chat.organization where slug = 'jawwid');
begin
  update chat.absence set organization_id = v_org;
  update chat.account set organization_id = v_org;
  update chat.audit_log set organization_id = v_org;
  update chat.call set organization_id = v_org;
  update chat.call_participant set organization_id = v_org;
  update chat.class_session set organization_id = v_org;
  update chat.config set organization_id = v_org;
  update chat.contact set organization_id = v_org;
  update chat.conversation set organization_id = v_org;
  update chat.conversation_member set organization_id = v_org;
  update chat.conversation_participant_state set organization_id = v_org;
  update chat.core_event set organization_id = v_org;
  update chat.core_parent_inbox set organization_id = v_org;
  update chat.coverage_rule set organization_id = v_org;
  update chat.device_token set organization_id = v_org;
  update chat.enrollment set organization_id = v_org;
  update chat.event_log set organization_id = v_org;
  update chat.family set organization_id = v_org;
  update chat.family_note set organization_id = v_org;
  update chat.family_state_cache set organization_id = v_org;
  update chat.handoff set organization_id = v_org;
  update chat.learner set organization_id = v_org;
  update chat.message set organization_id = v_org;
  update chat.message_approval set organization_id = v_org;
  update chat.message_attachment set organization_id = v_org;
  update chat.message_hidden_for set organization_id = v_org;
  update chat.message_reaction set organization_id = v_org;
  update chat.message_receipt set organization_id = v_org;
  update chat.notification set organization_id = v_org;
  update chat.notification_rule set organization_id = v_org;
  update chat.notification_template set organization_id = v_org;
  update chat.outbox_event set organization_id = v_org;
  update chat.payment set organization_id = v_org;
  update chat.quiet_hours set organization_id = v_org;
  update chat.shift set organization_id = v_org;
  update chat.staff set organization_id = v_org;
  update chat.subscription set organization_id = v_org;
  update chat.support_case set organization_id = v_org;
  update chat.sync_state set organization_id = v_org;
  update chat.task set organization_id = v_org;
  update chat.teacher set organization_id = v_org;
  update chat.thread set organization_id = v_org;
end;
$$;

alter table chat.absence alter column organization_id set not null;
alter table chat.account alter column organization_id set not null;
alter table chat.audit_log alter column organization_id set not null;
alter table chat.call alter column organization_id set not null;
alter table chat.call_participant alter column organization_id set not null;
alter table chat.class_session alter column organization_id set not null;
alter table chat.config alter column organization_id set not null;
alter table chat.contact alter column organization_id set not null;
alter table chat.conversation alter column organization_id set not null;
alter table chat.conversation_member alter column organization_id set not null;
alter table chat.conversation_participant_state alter column organization_id set not null;
alter table chat.core_event alter column organization_id set not null;
alter table chat.core_parent_inbox alter column organization_id set not null;
alter table chat.coverage_rule alter column organization_id set not null;
alter table chat.device_token alter column organization_id set not null;
alter table chat.enrollment alter column organization_id set not null;
alter table chat.event_log alter column organization_id set not null;
alter table chat.family alter column organization_id set not null;
alter table chat.family_note alter column organization_id set not null;
alter table chat.family_state_cache alter column organization_id set not null;
alter table chat.handoff alter column organization_id set not null;
alter table chat.learner alter column organization_id set not null;
alter table chat.message alter column organization_id set not null;
alter table chat.message_approval alter column organization_id set not null;
alter table chat.message_attachment alter column organization_id set not null;
alter table chat.message_hidden_for alter column organization_id set not null;
alter table chat.message_reaction alter column organization_id set not null;
alter table chat.message_receipt alter column organization_id set not null;
alter table chat.notification alter column organization_id set not null;
alter table chat.notification_rule alter column organization_id set not null;
alter table chat.notification_template alter column organization_id set not null;
alter table chat.outbox_event alter column organization_id set not null;
alter table chat.payment alter column organization_id set not null;
alter table chat.quiet_hours alter column organization_id set not null;
alter table chat.shift alter column organization_id set not null;
alter table chat.staff alter column organization_id set not null;
alter table chat.subscription alter column organization_id set not null;
alter table chat.support_case alter column organization_id set not null;
alter table chat.sync_state alter column organization_id set not null;
alter table chat.task alter column organization_id set not null;
alter table chat.teacher alter column organization_id set not null;
alter table chat.thread alter column organization_id set not null;

-- Who is the caller's organization ---------------------------------------
-- Resolution order, most explicit first:
--   1. an explicit per-request setting (workers, migrations, admin tooling);
--   2. the signed-in account's own organization;
--   3. the only active organization, when there is exactly one.
--
-- Step 3 is what makes the single-tenant phase work unchanged. It is written to
-- stop working the moment a second organization exists: at that point it
-- returns null, every NOT NULL insert fails loudly, and the caller is forced to
-- say which tenant it means. Silently picking one would be the bug this whole
-- migration exists to prevent.

create or replace function chat.current_organization_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('chat.organization_id', true), '')::uuid,
    (select a.organization_id from chat.account a
      where a.subject = chat.current_subject() and a.is_active),
    (select o.id from chat.organization o
      where o.is_active
        and (select count(*) from chat.organization where is_active) = 1)
  )
$$;

-- Every tenant table defaults to the caller's organization, so ordinary inserts
-- need no change and an insert that cannot name a tenant fails rather than
-- guessing.
alter table chat.absence alter column organization_id set default chat.current_organization_id();
alter table chat.account alter column organization_id set default chat.current_organization_id();
alter table chat.audit_log alter column organization_id set default chat.current_organization_id();
alter table chat.call alter column organization_id set default chat.current_organization_id();
alter table chat.call_participant alter column organization_id set default chat.current_organization_id();
alter table chat.class_session alter column organization_id set default chat.current_organization_id();
alter table chat.config alter column organization_id set default chat.current_organization_id();
alter table chat.contact alter column organization_id set default chat.current_organization_id();
alter table chat.conversation alter column organization_id set default chat.current_organization_id();
alter table chat.conversation_member alter column organization_id set default chat.current_organization_id();
alter table chat.conversation_participant_state alter column organization_id set default chat.current_organization_id();
alter table chat.core_event alter column organization_id set default chat.current_organization_id();
alter table chat.core_parent_inbox alter column organization_id set default chat.current_organization_id();
alter table chat.coverage_rule alter column organization_id set default chat.current_organization_id();
alter table chat.device_token alter column organization_id set default chat.current_organization_id();
alter table chat.enrollment alter column organization_id set default chat.current_organization_id();
alter table chat.event_log alter column organization_id set default chat.current_organization_id();
alter table chat.family alter column organization_id set default chat.current_organization_id();
alter table chat.family_note alter column organization_id set default chat.current_organization_id();
alter table chat.family_state_cache alter column organization_id set default chat.current_organization_id();
alter table chat.handoff alter column organization_id set default chat.current_organization_id();
alter table chat.learner alter column organization_id set default chat.current_organization_id();
alter table chat.message alter column organization_id set default chat.current_organization_id();
alter table chat.message_approval alter column organization_id set default chat.current_organization_id();
alter table chat.message_attachment alter column organization_id set default chat.current_organization_id();
alter table chat.message_hidden_for alter column organization_id set default chat.current_organization_id();
alter table chat.message_reaction alter column organization_id set default chat.current_organization_id();
alter table chat.message_receipt alter column organization_id set default chat.current_organization_id();
alter table chat.notification alter column organization_id set default chat.current_organization_id();
alter table chat.notification_rule alter column organization_id set default chat.current_organization_id();
alter table chat.notification_template alter column organization_id set default chat.current_organization_id();
alter table chat.outbox_event alter column organization_id set default chat.current_organization_id();
alter table chat.payment alter column organization_id set default chat.current_organization_id();
alter table chat.quiet_hours alter column organization_id set default chat.current_organization_id();
alter table chat.shift alter column organization_id set default chat.current_organization_id();
alter table chat.staff alter column organization_id set default chat.current_organization_id();
alter table chat.subscription alter column organization_id set default chat.current_organization_id();
alter table chat.support_case alter column organization_id set default chat.current_organization_id();
alter table chat.sync_state alter column organization_id set default chat.current_organization_id();
alter table chat.task alter column organization_id set default chat.current_organization_id();
alter table chat.teacher alter column organization_id set default chat.current_organization_id();
alter table chat.thread alter column organization_id set default chat.current_organization_id();

-- Composite-key targets. Every tenant table gets a UNIQUE (key…, organization_id)
-- so that a child can reference it together with the organization.
alter table chat.account add constraint account_id_org_uniq unique (id, organization_id);
alter table chat.call add constraint call_id_org_uniq unique (id, organization_id);
alter table chat.contact add constraint contact_id_org_uniq unique (id, organization_id);
alter table chat.conversation add constraint conversation_id_org_uniq unique (id, organization_id);
alter table chat.family add constraint family_id_org_uniq unique (id, organization_id);
alter table chat.learner add constraint learner_id_org_uniq unique (id, organization_id);
alter table chat.message add constraint message_id_org_uniq unique (id, organization_id);
alter table chat.notification_rule add constraint notification_rule_key_org_uniq unique (key, organization_id);
alter table chat.staff add constraint staff_id_org_uniq unique (id, organization_id);
alter table chat.subscription add constraint subscription_id_org_uniq unique (id, organization_id);
alter table chat.support_case add constraint support_case_id_org_uniq unique (id, organization_id);
alter table chat.teacher add constraint teacher_id_org_uniq unique (id, organization_id);
alter table chat.thread add constraint thread_id_org_uniq unique (id, organization_id);

-- Root entities additionally point at the organization itself.
alter table chat.account add constraint account_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.audit_log add constraint audit_log_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.config add constraint config_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.conversation add constraint conversation_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.core_event add constraint core_event_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.core_parent_inbox add constraint core_parent_inbox_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.device_token add constraint device_token_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.event_log add constraint event_log_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.family add constraint family_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.message add constraint message_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.notification add constraint notification_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.notification_rule add constraint notification_rule_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.notification_template add constraint notification_template_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.outbox_event add constraint outbox_event_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.quiet_hours add constraint quiet_hours_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.staff add constraint staff_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.sync_state add constraint sync_state_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;
alter table chat.teacher add constraint teacher_organization_fk foreign key (organization_id) references chat.organization (id) on delete restrict;

-- All 67 foreign keys, rewritten to carry the organization. A row can now
-- only reference a parent in its own organization, at the storage layer.
alter table chat.absence drop constraint absence_activated_by_fkey;
alter table chat.absence add constraint absence_activated_by_fkey foreign key (activated_by, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.absence drop constraint absence_backup_id_fkey;
alter table chat.absence add constraint absence_backup_id_fkey foreign key (backup_id, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.absence drop constraint absence_staff_id_fkey;
alter table chat.absence add constraint absence_staff_id_fkey foreign key (staff_id, organization_id) references chat.staff (id, organization_id) on delete CASCADE;
alter table chat.call drop constraint call_conversation_id_fkey;
alter table chat.call add constraint call_conversation_id_fkey foreign key (conversation_id, organization_id) references chat.conversation (id, organization_id) on delete CASCADE;
alter table chat.call drop constraint call_family_id_fkey;
alter table chat.call add constraint call_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete SET NULL;
alter table chat.call_participant drop constraint call_participant_call_id_fkey;
alter table chat.call_participant add constraint call_participant_call_id_fkey foreign key (call_id, organization_id) references chat.call (id, organization_id) on delete CASCADE;
alter table chat.class_session drop constraint class_session_learner_id_fkey;
alter table chat.class_session add constraint class_session_learner_id_fkey foreign key (learner_id, organization_id) references chat.learner (id, organization_id) on delete CASCADE;
alter table chat.class_session drop constraint class_session_teacher_id_fkey;
alter table chat.class_session add constraint class_session_teacher_id_fkey foreign key (teacher_id, organization_id) references chat.teacher (id, organization_id) on delete SET NULL;
alter table chat.contact drop constraint contact_account_id_fkey;
alter table chat.contact add constraint contact_account_id_fkey foreign key (account_id, organization_id) references chat.account (id, organization_id) on delete RESTRICT;
alter table chat.contact drop constraint contact_family_id_fkey;
alter table chat.contact add constraint contact_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.conversation drop constraint conversation_family_id_fkey;
alter table chat.conversation add constraint conversation_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.conversation drop constraint conversation_learner_id_fkey;
alter table chat.conversation add constraint conversation_learner_id_fkey foreign key (learner_id, organization_id) references chat.learner (id, organization_id) on delete CASCADE;
alter table chat.conversation drop constraint conversation_sticky_handler_id_fkey;
alter table chat.conversation add constraint conversation_sticky_handler_id_fkey foreign key (sticky_handler_id, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.conversation drop constraint conversation_thread_id_fkey;
alter table chat.conversation add constraint conversation_thread_id_fkey foreign key (thread_id, organization_id) references chat.thread (id, organization_id) on delete CASCADE;
alter table chat.conversation_member drop constraint conversation_member_added_by_fkey;
alter table chat.conversation_member add constraint conversation_member_added_by_fkey foreign key (added_by, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.conversation_member drop constraint conversation_member_conversation_id_fkey;
alter table chat.conversation_member add constraint conversation_member_conversation_id_fkey foreign key (conversation_id, organization_id) references chat.conversation (id, organization_id) on delete CASCADE;
alter table chat.conversation_participant_state drop constraint conversation_participant_state_conversation_id_fkey;
alter table chat.conversation_participant_state add constraint conversation_participant_state_conversation_id_fkey foreign key (conversation_id, organization_id) references chat.conversation (id, organization_id) on delete CASCADE;
alter table chat.coverage_rule drop constraint coverage_rule_covered_id_fkey;
alter table chat.coverage_rule add constraint coverage_rule_covered_id_fkey foreign key (covered_id, organization_id) references chat.staff (id, organization_id) on delete CASCADE;
alter table chat.coverage_rule drop constraint coverage_rule_covering_id_fkey;
alter table chat.coverage_rule add constraint coverage_rule_covering_id_fkey foreign key (covering_id, organization_id) references chat.staff (id, organization_id) on delete CASCADE;
alter table chat.enrollment drop constraint enrollment_learner_id_fkey;
alter table chat.enrollment add constraint enrollment_learner_id_fkey foreign key (learner_id, organization_id) references chat.learner (id, organization_id) on delete CASCADE;
alter table chat.enrollment drop constraint enrollment_teacher_id_fkey;
alter table chat.enrollment add constraint enrollment_teacher_id_fkey foreign key (teacher_id, organization_id) references chat.teacher (id, organization_id) on delete RESTRICT;
alter table chat.event_log drop constraint event_log_case_id_fkey;
alter table chat.event_log add constraint event_log_case_id_fkey foreign key (case_id, organization_id) references chat.support_case (id, organization_id) on delete SET NULL;
alter table chat.event_log drop constraint event_log_family_id_fkey;
alter table chat.event_log add constraint event_log_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.family drop constraint family_owner_id_fkey;
alter table chat.family add constraint family_owner_id_fkey foreign key (owner_id, organization_id) references chat.staff (id, organization_id) on delete RESTRICT;
alter table chat.family drop constraint family_primary_contact_fk;
alter table chat.family add constraint family_primary_contact_fk foreign key (primary_contact_id, organization_id) references chat.contact (id, organization_id) on delete SET NULL;
alter table chat.family_note drop constraint family_note_author_id_fkey;
alter table chat.family_note add constraint family_note_author_id_fkey foreign key (author_id, organization_id) references chat.staff (id, organization_id) on delete RESTRICT;
alter table chat.family_note drop constraint family_note_family_id_fkey;
alter table chat.family_note add constraint family_note_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.family_state_cache drop constraint family_state_cache_family_id_fkey;
alter table chat.family_state_cache add constraint family_state_cache_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.family_state_cache drop constraint family_state_cache_on_duty_id_fkey;
alter table chat.family_state_cache add constraint family_state_cache_on_duty_id_fkey foreign key (on_duty_id, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.handoff drop constraint handoff_from_staff_id_fkey;
alter table chat.handoff add constraint handoff_from_staff_id_fkey foreign key (from_staff_id, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.handoff drop constraint handoff_thread_id_fkey;
alter table chat.handoff add constraint handoff_thread_id_fkey foreign key (thread_id, organization_id) references chat.thread (id, organization_id) on delete CASCADE;
alter table chat.handoff drop constraint handoff_to_staff_id_fkey;
alter table chat.handoff add constraint handoff_to_staff_id_fkey foreign key (to_staff_id, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.learner drop constraint learner_family_id_fkey;
alter table chat.learner add constraint learner_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.message drop constraint message_case_id_fkey;
alter table chat.message add constraint message_case_id_fkey foreign key (case_id, organization_id) references chat.support_case (id, organization_id) on delete SET NULL;
alter table chat.message drop constraint message_conversation_id_fkey;
alter table chat.message add constraint message_conversation_id_fkey foreign key (conversation_id, organization_id) references chat.conversation (id, organization_id) on delete CASCADE;
alter table chat.message drop constraint message_reply_to_message_id_fkey;
alter table chat.message add constraint message_reply_to_message_id_fkey foreign key (reply_to_message_id, organization_id) references chat.message (id, organization_id) on delete SET NULL;
alter table chat.message drop constraint message_thread_id_fkey;
alter table chat.message add constraint message_thread_id_fkey foreign key (thread_id, organization_id) references chat.thread (id, organization_id) on delete CASCADE;
alter table chat.message_approval drop constraint message_approval_approver_id_fkey;
alter table chat.message_approval add constraint message_approval_approver_id_fkey foreign key (approver_id, organization_id) references chat.staff (id, organization_id) on delete RESTRICT;
alter table chat.message_approval drop constraint message_approval_conversation_id_fkey;
alter table chat.message_approval add constraint message_approval_conversation_id_fkey foreign key (conversation_id, organization_id) references chat.conversation (id, organization_id) on delete CASCADE;
alter table chat.message_approval drop constraint message_approval_message_id_fkey;
alter table chat.message_approval add constraint message_approval_message_id_fkey foreign key (message_id, organization_id) references chat.message (id, organization_id) on delete CASCADE;
alter table chat.message_attachment drop constraint message_attachment_message_id_fkey;
alter table chat.message_attachment add constraint message_attachment_message_id_fkey foreign key (message_id, organization_id) references chat.message (id, organization_id) on delete CASCADE;
alter table chat.message_hidden_for drop constraint message_hidden_for_message_id_fkey;
alter table chat.message_hidden_for add constraint message_hidden_for_message_id_fkey foreign key (message_id, organization_id) references chat.message (id, organization_id) on delete CASCADE;
alter table chat.message_reaction drop constraint message_reaction_message_id_fkey;
alter table chat.message_reaction add constraint message_reaction_message_id_fkey foreign key (message_id, organization_id) references chat.message (id, organization_id) on delete CASCADE;
alter table chat.message_receipt drop constraint message_receipt_message_id_fkey;
alter table chat.message_receipt add constraint message_receipt_message_id_fkey foreign key (message_id, organization_id) references chat.message (id, organization_id) on delete CASCADE;
alter table chat.notification drop constraint notification_conversation_id_fkey;
alter table chat.notification add constraint notification_conversation_id_fkey foreign key (conversation_id, organization_id) references chat.conversation (id, organization_id) on delete CASCADE;
alter table chat.notification drop constraint notification_family_id_fkey;
alter table chat.notification add constraint notification_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.notification drop constraint notification_rule_key_fkey;
alter table chat.notification add constraint notification_rule_key_fkey foreign key (rule_key, organization_id) references chat.notification_rule (key, organization_id) on delete SET NULL;
alter table chat.payment drop constraint payment_family_id_fkey;
alter table chat.payment add constraint payment_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.payment drop constraint payment_subscription_id_fkey;
alter table chat.payment add constraint payment_subscription_id_fkey foreign key (subscription_id, organization_id) references chat.subscription (id, organization_id) on delete SET NULL;
alter table chat.shift drop constraint shift_staff_id_fkey;
alter table chat.shift add constraint shift_staff_id_fkey foreign key (staff_id, organization_id) references chat.staff (id, organization_id) on delete CASCADE;
alter table chat.staff drop constraint staff_account_id_fkey;
alter table chat.staff add constraint staff_account_id_fkey foreign key (account_id, organization_id) references chat.account (id, organization_id) on delete RESTRICT;
alter table chat.subscription drop constraint subscription_family_id_fkey;
alter table chat.subscription add constraint subscription_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.subscription drop constraint subscription_learner_id_fkey;
alter table chat.subscription add constraint subscription_learner_id_fkey foreign key (learner_id, organization_id) references chat.learner (id, organization_id) on delete SET NULL;
alter table chat.support_case drop constraint support_case_escalated_to_id_fkey;
alter table chat.support_case add constraint support_case_escalated_to_id_fkey foreign key (escalated_to_id, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.support_case drop constraint support_case_family_id_fkey;
alter table chat.support_case add constraint support_case_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.support_case drop constraint support_case_handler_id_fkey;
alter table chat.support_case add constraint support_case_handler_id_fkey foreign key (handler_id, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.support_case drop constraint support_case_learner_id_fkey;
alter table chat.support_case add constraint support_case_learner_id_fkey foreign key (learner_id, organization_id) references chat.learner (id, organization_id) on delete SET NULL;
alter table chat.support_case drop constraint support_case_opened_by_fkey;
alter table chat.support_case add constraint support_case_opened_by_fkey foreign key (opened_by, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.support_case drop constraint support_case_thread_id_fkey;
alter table chat.support_case add constraint support_case_thread_id_fkey foreign key (thread_id, organization_id) references chat.thread (id, organization_id) on delete CASCADE;
alter table chat.task drop constraint task_case_id_fkey;
alter table chat.task add constraint task_case_id_fkey foreign key (case_id, organization_id) references chat.support_case (id, organization_id) on delete CASCADE;
alter table chat.task drop constraint task_created_by_fkey;
alter table chat.task add constraint task_created_by_fkey foreign key (created_by, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.task drop constraint task_family_id_fkey;
alter table chat.task add constraint task_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.task drop constraint task_owner_id_fkey;
alter table chat.task add constraint task_owner_id_fkey foreign key (owner_id, organization_id) references chat.staff (id, organization_id) on delete RESTRICT;
alter table chat.teacher drop constraint teacher_account_id_fkey;
alter table chat.teacher add constraint teacher_account_id_fkey foreign key (account_id, organization_id) references chat.account (id, organization_id) on delete RESTRICT;
alter table chat.thread drop constraint thread_family_id_fkey;
alter table chat.thread add constraint thread_family_id_fkey foreign key (family_id, organization_id) references chat.family (id, organization_id) on delete CASCADE;
alter table chat.thread drop constraint thread_last_staff_id_fkey;
alter table chat.thread add constraint thread_last_staff_id_fkey foreign key (last_staff_id, organization_id) references chat.staff (id, organization_id) on delete SET NULL;
alter table chat.thread drop constraint thread_sticky_handler_id_fkey;
alter table chat.thread add constraint thread_sticky_handler_id_fkey foreign key (sticky_handler_id, organization_id) references chat.staff (id, organization_id) on delete SET NULL;

-- Every tenant-scoped read starts from the organization.
create index absence_organization_idx on chat.absence (organization_id);
create index account_organization_idx on chat.account (organization_id);
create index audit_log_organization_idx on chat.audit_log (organization_id);
create index call_organization_idx on chat.call (organization_id);
create index call_participant_organization_idx on chat.call_participant (organization_id);
create index class_session_organization_idx on chat.class_session (organization_id);
create index config_organization_idx on chat.config (organization_id);
create index contact_organization_idx on chat.contact (organization_id);
create index conversation_organization_idx on chat.conversation (organization_id);
create index conversation_member_organization_idx on chat.conversation_member (organization_id);
create index conversation_participant_state_organization_idx on chat.conversation_participant_state (organization_id);
create index core_event_organization_idx on chat.core_event (organization_id);
create index core_parent_inbox_organization_idx on chat.core_parent_inbox (organization_id);
create index coverage_rule_organization_idx on chat.coverage_rule (organization_id);
create index device_token_organization_idx on chat.device_token (organization_id);
create index enrollment_organization_idx on chat.enrollment (organization_id);
create index event_log_organization_idx on chat.event_log (organization_id);
create index family_organization_idx on chat.family (organization_id);
create index family_note_organization_idx on chat.family_note (organization_id);
create index family_state_cache_organization_idx on chat.family_state_cache (organization_id);
create index handoff_organization_idx on chat.handoff (organization_id);
create index learner_organization_idx on chat.learner (organization_id);
create index message_organization_idx on chat.message (organization_id);
create index message_approval_organization_idx on chat.message_approval (organization_id);
create index message_attachment_organization_idx on chat.message_attachment (organization_id);
create index message_hidden_for_organization_idx on chat.message_hidden_for (organization_id);
create index message_reaction_organization_idx on chat.message_reaction (organization_id);
create index message_receipt_organization_idx on chat.message_receipt (organization_id);
create index notification_organization_idx on chat.notification (organization_id);
create index notification_rule_organization_idx on chat.notification_rule (organization_id);
create index notification_template_organization_idx on chat.notification_template (organization_id);
create index outbox_event_organization_idx on chat.outbox_event (organization_id);
create index payment_organization_idx on chat.payment (organization_id);
create index quiet_hours_organization_idx on chat.quiet_hours (organization_id);
create index shift_organization_idx on chat.shift (organization_id);
create index staff_organization_idx on chat.staff (organization_id);
create index subscription_organization_idx on chat.subscription (organization_id);
create index support_case_organization_idx on chat.support_case (organization_id);
create index sync_state_organization_idx on chat.sync_state (organization_id);
create index task_organization_idx on chat.task (organization_id);
create index teacher_organization_idx on chat.teacher (organization_id);
create index thread_organization_idx on chat.thread (organization_id);
