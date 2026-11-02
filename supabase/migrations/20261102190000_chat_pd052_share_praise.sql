-- PD-52 PR-8 (plan §11 c): "Share with the teacher" for a parent's praise.
--
-- Staff with teacher_grants.record post the praise as a card in the teacher's
-- supervision chat: the child's first name and the parent's words, never the
-- parent's name. The card is the only record of the share (the API reads
-- "shared" from it), so this migration only registers the kind. The app
-- renders an unknown kind as the server's plain-text body: no app change.

insert into chat.message_card_kind (kind) values ('teacher_praise_shared')
on conflict do nothing;
