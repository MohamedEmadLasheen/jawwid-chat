-- =============================================================================
-- Labels and quick replies -- staff tools (Chat UI group B, 2026-10-19)
-- =============================================================================
--
-- Owner decisions:
--   * LABELS are PRIVATE to each staff member: their own labels, their own
--     tagging of the chats they can open. No colleague, family or teacher ever
--     sees them.
--   * QUICK REPLIES: one TEAM library per organization, which any staff member
--     may add to, edit or delete, plus each staff member's PERSONAL ones.
--
-- Staff-only by construction: rows are keyed by chat.staff; the API refuses
-- teachers and family contacts before anything is read. Like the other
-- per-viewer tables, written only by the API's owner connection: RLS on, no
-- policy, so the request roles reach nothing here.

-- A palette, not free colours: eight tones the clients can render with
-- checked contrast in both themes.
create table if not exists chat.staff_label (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  owner_staff_id  uuid not null references chat.staff (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 40),
  color           text not null check (color in ('1', '2', '3', '4', '5', '6', '7', '8')),
  created_at      timestamptz not null default now()
);

comment on table chat.staff_label is
  'A staff member''s PRIVATE label (owner decision 2026-10-19). Nobody else sees it.';

create unique index if not exists staff_label_owner_name_uidx
  on chat.staff_label (owner_staff_id, lower(btrim(name)));

create table if not exists chat.conversation_label (
  label_id        uuid not null references chat.staff_label (id) on delete cascade,
  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (label_id, conversation_id)
);

create index if not exists conversation_label_conversation_idx
  on chat.conversation_label (conversation_id);

-- A label tags a conversation of its owner's own organization.
create or replace function chat.enforce_conversation_label()
returns trigger
language plpgsql
as $$
begin
  if (select organization_id from chat.staff_label where id = new.label_id)
     is distinct from (select organization_id from chat.conversation where id = new.conversation_id) then
    raise exception 'a label tags a conversation of its own organization only'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_label_guard on chat.conversation_label;
create trigger conversation_label_guard
  before insert or update on chat.conversation_label
  for each row execute function chat.enforce_conversation_label();

create table if not exists chat.quick_reply (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  -- NULL: the team library. Otherwise the one staff member it belongs to.
  owner_staff_id  uuid references chat.staff (id) on delete cascade,
  -- Locale-independent on purpose: [[:alnum:]] would accept Arabic only under a
  -- UTF-8 LC_CTYPE. The exact rule (letters, digits, _ and -) is the API's.
  shortcut        text not null
                  constraint quick_reply_shortcut_shape
                  check (char_length(shortcut) between 1 and 24 and shortcut !~ '[[:space:]/]'),
  body            text not null check (char_length(btrim(body)) between 1 and 2000),
  created_by      uuid not null,
  updated_by      uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table chat.quick_reply is
  'Saved replies typed as /shortcut. owner_staff_id NULL = the organization''s team '
  'library (any staff may edit); otherwise one staff member''s personal reply.';

-- One shortcut per library: per organization for the team, per person for personal ones.
create unique index if not exists quick_reply_team_shortcut_uidx
  on chat.quick_reply (organization_id, lower(shortcut)) where owner_staff_id is null;
create unique index if not exists quick_reply_personal_shortcut_uidx
  on chat.quick_reply (owner_staff_id, lower(shortcut)) where owner_staff_id is not null;

alter table chat.staff_label enable row level security;
alter table chat.conversation_label enable row level security;
alter table chat.quick_reply enable row level security;

grant select, insert, update, delete on chat.staff_label, chat.conversation_label, chat.quick_reply to service_role;
