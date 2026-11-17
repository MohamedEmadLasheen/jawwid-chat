-- PD-27 / LR-34: card payments start PAUSED (the W63 switch), once.
--
-- Deploying the Stripe secrets would otherwise turn card payments on for every parent at the instant the
-- new API starts. Deploys apply migrations BEFORE they release the new code, so this row is already in
-- place when the API first boots with the secrets: cards stay off until the super admin or the Operations
-- Manager resumes them (Admin Web -> Payments -> Settings -> "Pause card payments"; audited as
-- billing.card_pause_set). Webhooks, the reconciler and refunds are not paused (card-pause.ts).
--
-- ON CONFLICT DO NOTHING is the whole point: an existing row is an administrator's choice (true or
-- false) and is never overwritten, and running this twice changes nothing. No row is written for any
-- other key.
insert into chat.config (key, value, scope, description)
values (
  'billing.card_paused',
  'true'::jsonb,
  'global',
  'W63: card payments are paused until the super admin or Operations Manager resumes them. Seeded once by 20261117100000.'
)
on conflict (key) do nothing;
