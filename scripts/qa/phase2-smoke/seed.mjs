// Seed two principals with real logins, so the smoke test authenticates the
// way a device does rather than being handed an actor id.
// ESM resolves a bare specifier relative to THIS FILE, and this file lives in
// scripts/. Both the Prisma client and the compiled password hasher belong to
// apps/api, so they are resolved from there explicitly rather than by hoping
// the caller's cwd happens to be right.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API = path.resolve(import.meta.dirname, '../../../apps/api');
const requireFromApi = createRequire(pathToFileURL(path.join(API, 'package.json')));
const { PrismaClient } = requireFromApi('@prisma/client');
const prisma = new PrismaClient();
const u = () => crypto.randomUUID();

// B is a MANAGER, not the family's owning admin.
//
// A plain `admin` may only reply to a family they are ON DUTY for, and the
// coverage engine decides that from shifts this seed does not create — which
// is Phase 1 behaviour, and the reason the integration suite pins on_duty().
// A manager has organization-wide reach, is a legitimate Supervisor/Admin, and
// exercises the same messaging paths without standing up a shift roster.
// The family's owner must be an admin or coverage_admin: a database invariant
// refuses to assign a family to a manager.
const ids = { owner: u(), supervisor: u(), family: u(), parent: u(), learner: u(), teacher: u() };
const acc = { owner: u(), supervisor: u(), parent: u(), teacher: u() };

await prisma.$executeRawUnsafe(`truncate chat.message_receipt, chat.message_reaction,
  chat.message_attachment, chat.message_hidden_for, chat.message_revision,
  chat.message_approval, chat.call_participant, chat.call, chat.notification,
  chat.outbox_event, chat.conversation_participant_state, chat.conversation_member,
  chat.message, chat.conversation, chat.learner, chat.family_assignment, chat.contact,
  chat.family, chat.teacher, chat.staff, chat.session, chat.device, chat.account_token,
  chat.account_credential, chat.account_permission_override, chat.account,
  chat.event_log, chat.audit_log restart identity cascade`);

for (const [k, id] of Object.entries(acc)) {
  const kind = k === 'parent' ? 'family' : k === 'teacher' ? 'teacher' : 'staff';
  await prisma.$executeRawUnsafe(
    `insert into chat.account (id, subject, kind, status) values ('${id}'::uuid, 'smoke_${k}', '${kind}', 'active')`);
}
await prisma.$executeRawUnsafe(
  `insert into chat.staff (id, account_id, name, role, is_active) values
     ('${ids.owner}'::uuid, '${acc.owner}'::uuid, 'admin_smoke', 'admin', true),
     ('${ids.supervisor}'::uuid, '${acc.supervisor}'::uuid, 'manager_smoke', 'manager', true)`);
await prisma.$executeRawUnsafe(
  `insert into chat.teacher (id, account_id, name, is_active)
   values ('${ids.teacher}'::uuid, '${acc.teacher}'::uuid, 'teacher_smoke', true)`);
await prisma.$executeRawUnsafe(
  `insert into chat.family (id, display_name, owner_id, language)
   values ('${ids.family}'::uuid, 'family_smoke', '${ids.owner}'::uuid, 'ar')`);
await prisma.$executeRawUnsafe(
  `insert into chat.contact (id, account_id, family_id, name, role_preset, can_message, is_active)
   values ('${ids.parent}'::uuid, '${acc.parent}'::uuid, '${ids.family}'::uuid, 'parent_smoke', 'primary_guardian', true, true)`);
await prisma.$executeRawUnsafe(
  `insert into chat.learner (id, family_id, name, teacher_id)
   values ('${ids.learner}'::uuid, '${ids.family}'::uuid, 'learner_smoke', '${ids.teacher}'::uuid)`);

// Passwords through the real hasher, so login exercises the real verification.
const pw = await import(pathToFileURL(path.join(API, 'dist/platform/auth/password.js')).href);
const hash = pw.hashPassword ?? pw.default?.hashPassword;
for (const id of [acc.supervisor, acc.parent]) {
  await prisma.$executeRawUnsafe(
    `insert into chat.account_credential (account_id, password_hash)
     values ('${id}'::uuid, '${await hash('smoke-password-long-enough')}')`);
}
console.log(JSON.stringify(ids));
await prisma.$disconnect();
