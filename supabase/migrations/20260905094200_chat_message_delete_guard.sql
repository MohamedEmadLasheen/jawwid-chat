-- Jawwid Chat -- restore the DELETE half of message immutability.
--
-- 20260905093000 replaced the blanket `message_is_immutable` trigger with a
-- column-level UPDATE guard. That part was right: PRD v0.1 gives a message two
-- lawful state changes (an approval decision, and a soft delete), and a blanket
-- UPDATE ban makes both impossible.
--
-- But the old trigger covered UPDATE **or DELETE**, and only the UPDATE half was
-- replaced. Since then a plain `delete from chat.message` has succeeded, which
-- contradicts:
--
--   BR-5      "All conversation, call and task history is owned by the system,
--              retained when people leave."
--   SS7.2      "delete for everyone" -- implemented as chat.message.deleted_for_all,
--              a soft delete that keeps the row.
--   SS11.1     "No automatic message deletion in this phase."
--
-- Deleting for everyone must remain a state change on a row that stays, so a
-- manager can still audit what was sent. This restores the DELETE guard and
-- leaves the UPDATE rules exactly as 093000 defined them.

create trigger message_row_is_never_deleted
  before delete on chat.message
  for each row execute function chat.forbid_mutation();

comment on trigger message_row_is_never_deleted on chat.message is
  'Deleting for everyone sets chat.message.deleted_for_all; the row itself is '
  'never removed. Retention, if it is ever adopted, is a deliberate policy with '
  'its own migration -- not an ambient capability every caller holds.';
