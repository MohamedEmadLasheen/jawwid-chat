/**
 * Staff tools (Chat UI group B, owner decisions 2026-10-19):
 *
 *   A. LABELS are private to each staff member -- invisible to colleagues,
 *      families and teachers; only one's own labels tag chats one can open
 *   B. QUICK REPLIES: a team library any staff member may edit, plus personal
 *      ones only their owner sees or changes
 *   C. staff only: teachers and families are refused before anything is read
 */
import { CommErrorCode } from '@platform/errors';
import { ConversationController } from '@communication/api/conversation.controller';
import { StaffToolsService } from '@communication/staff-tools/staff-tools.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let groupId: string;
let tools: StaffToolsService;
let controller: ConversationController;

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe('truncate chat.staff_label, chat.quick_reply cascade');
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe('truncate chat.staff_label, chat.quick_reply cascade');
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  tools = new StaffToolsService(g.prisma, g.conversations);
  controller = new ConversationController(g.conversations, g.messages, g.calls, g.authz, tools);
});

const code = (c: CommErrorCode) => expect.objectContaining({ code: c });

describe('A · labels are private to each staff member', () => {
  it('tags a chat with one\'s own labels; the chat list shows them to that person only', async () => {
    const late = await tools.createLabel(s.ownerId, { name: 'Late payment', color: '3' });
    const vip = await tools.createLabel(s.ownerId, { name: 'VIP', color: '5' });
    const set = await tools.setConversationLabels(s.ownerId, groupId, [late.id, vip.id]);
    expect(set.labels.map((l) => l.name)).toEqual(['Late payment', 'VIP']);

    const mine = (await controller.list(s.ownerId)).conversations.find((c) => c.id === groupId)!;
    expect(mine.labels?.map((l) => l.id).sort()).toEqual([late.id, vip.id].sort());

    // A colleague sees none of it; a family member does not even get the field.
    expect((await tools.labelsFor(s.managerId, [groupId])).get(groupId)).toBeUndefined();
    const parent = (await controller.list(s.parentId)).conversations.find((c) => c.id === groupId)!;
    expect(Object.keys(parent)).not.toContain('labels');
  });

  it('another person\'s label is absent: it cannot be renamed, deleted or applied', async () => {
    const theirs = await tools.createLabel(s.managerId, { name: 'Manager only', color: '1' });
    await expect(tools.updateLabel(s.ownerId, theirs.id, { name: 'mine now' })).rejects.toEqual(code(CommErrorCode.STAFF_TOOL_NOT_FOUND));
    await expect(tools.deleteLabel(s.ownerId, theirs.id)).rejects.toEqual(code(CommErrorCode.STAFF_TOOL_NOT_FOUND));
    await expect(tools.setConversationLabels(s.ownerId, groupId, [theirs.id])).rejects.toEqual(code(CommErrorCode.STAFF_TOOL_NOT_FOUND));
  });

  it('setting one\'s labels never touches a colleague\'s tagging of the same chat', async () => {
    const managerLabel = await tools.createLabel(s.managerId, { name: 'Escalated', color: '2' });
    await g.prisma.conversationLabel.create({ data: { labelId: managerLabel.id, conversationId: groupId } });
    const mine = await tools.createLabel(s.ownerId, { name: 'Follow up', color: '4' });
    await tools.setConversationLabels(s.ownerId, groupId, [mine.id]);
    await tools.setConversationLabels(s.ownerId, groupId, []);
    expect(await g.prisma.conversationLabel.count({ where: { labelId: managerLabel.id } })).toBe(1);
  });

  it('cannot tag a chat one cannot open; names are unique per person; deleting a label untags', async () => {
    const label = await tools.createLabel(s.otherAdminId, { name: 'Mine', color: '6' });
    await expect(tools.setConversationLabels(s.otherAdminId, groupId, [label.id])).rejects.toBeTruthy();
    await expect(tools.createLabel(s.otherAdminId, { name: ' mine ', color: '1' })).rejects.toEqual(code(CommErrorCode.STAFF_TOOL_CONFLICT));
    // The same name is fine for someone else: it is their own list.
    await expect(tools.createLabel(s.ownerId, { name: 'Mine', color: '1' })).resolves.toBeTruthy();

    const own = await tools.createLabel(s.ownerId, { name: 'Temp', color: '2' });
    await tools.setConversationLabels(s.ownerId, groupId, [own.id]);
    await tools.deleteLabel(s.ownerId, own.id);
    expect(await g.prisma.conversationLabel.count({ where: { labelId: own.id } })).toBe(0);
  });

  it('refuses a colour outside the palette and an empty or long name', async () => {
    await expect(tools.createLabel(s.ownerId, { name: 'x', color: 'red' })).rejects.toEqual(code(CommErrorCode.STAFF_TOOL_INVALID));
    await expect(tools.createLabel(s.ownerId, { name: '  ', color: '1' })).rejects.toEqual(code(CommErrorCode.STAFF_TOOL_INVALID));
    await expect(tools.createLabel(s.ownerId, { name: 'x'.repeat(41), color: '1' })).rejects.toEqual(code(CommErrorCode.STAFF_TOOL_INVALID));
  });
});

describe('B · quick replies: a team library, and personal ones', () => {
  it('a team reply is seen and edited by any staff member; a personal one only by its owner', async () => {
    const team = await tools.createQuickReply(s.ownerId, { shortcut: '/schedule', body: 'Classes are Sunday to Thursday.', scope: 'team' });
    expect(team.shortcut).toBe('schedule'); // a typed leading slash is not part of it
    const personal = await tools.createQuickReply(s.ownerId, { shortcut: 'sig', body: '— Admin A', scope: 'mine' });

    const colleague = await tools.quickReplies(s.managerId);
    expect(colleague.team.map((r) => r.id)).toEqual([team.id]);
    expect(colleague.mine).toEqual([]);
    await expect(tools.updateQuickReply(s.managerId, team.id, { body: 'Classes are Sunday to Wednesday.' })).resolves.toEqual(
      expect.objectContaining({ body: 'Classes are Sunday to Wednesday.', scope: 'team' }),
    );
    await expect(tools.updateQuickReply(s.managerId, personal.id, { body: 'hijacked' })).rejects.toEqual(code(CommErrorCode.STAFF_TOOL_NOT_FOUND));
    await expect(tools.deleteQuickReply(s.managerId, personal.id)).rejects.toEqual(code(CommErrorCode.STAFF_TOOL_NOT_FOUND));
    expect((await tools.quickReplies(s.ownerId)).mine.map((r) => r.body)).toEqual(['— Admin A']);
  });

  it('a shortcut is unique within its library, and may be Arabic', async () => {
    await tools.createQuickReply(s.ownerId, { shortcut: 'مرحبا', body: 'أهلًا وسهلًا!', scope: 'team' });
    await expect(tools.createQuickReply(s.managerId, { shortcut: 'مرحبا', body: 'again', scope: 'team' })).rejects.toEqual(
      code(CommErrorCode.STAFF_TOOL_CONFLICT),
    );
    // The same shortcut as a personal reply is a different library.
    await expect(tools.createQuickReply(s.managerId, { shortcut: 'مرحبا', body: 'mine', scope: 'mine' })).resolves.toBeTruthy();
    await expect(tools.createQuickReply(s.ownerId, { shortcut: 'two words', body: 'x', scope: 'team' })).rejects.toEqual(
      code(CommErrorCode.STAFF_TOOL_INVALID),
    );
  });
});

describe('C · staff only', () => {
  it('teachers and families are refused before anything is read', async () => {
    for (const who of [s.teacherId, s.parentId]) {
      await expect(tools.labels(who)).rejects.toEqual(code(CommErrorCode.STAFF_TOOLS_DENIED));
      await expect(tools.quickReplies(who)).rejects.toEqual(code(CommErrorCode.STAFF_TOOLS_DENIED));
      await expect(tools.createQuickReply(who, { shortcut: 'x', body: 'y', scope: 'mine' })).rejects.toEqual(
        code(CommErrorCode.STAFF_TOOLS_DENIED),
      );
    }
  });
});
