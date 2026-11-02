-- PD-46 PR-2 (plan §3.4; CHATSCHED-001).
--
-- 1. chat.message_card.idempotency_key: a card posted for one lesson change
--    carries lesson:<id>:<revision>:<change>, and a second post of the same
--    change (a retried request, a double tap) finds the first instead of
--    posting again. Null for every other card, and for every card before this.
-- 2. The 'lesson_scheduled' card kind: a lesson added outside the weekly times
--    (Admin Web "Add lesson", a booked blocked occurrence) is announced in the
--    family's group like every other lesson change.

-- message_card is written by every lesson ticket: the index build and the column
-- take locks every card insert waits on. Fail fast rather than queue behind live
-- traffic; re-run at a quiet moment if it times out.
set local lock_timeout = '5s';

alter table chat.message_card add column idempotency_key text;
create unique index message_card_idempotency_key on chat.message_card (idempotency_key)
  where idempotency_key is not null;

comment on column chat.message_card.idempotency_key is
  'PD-46: lesson:<id>:<revision>:<change> for a card that announces one lesson change; one card per change.';

insert into chat.message_card_kind (kind) values ('lesson_scheduled') on conflict do nothing;
