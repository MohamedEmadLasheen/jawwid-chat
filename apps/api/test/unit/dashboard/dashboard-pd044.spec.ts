/**
 * PD-44: the Dashboard's wire shape, and that each section asks the key of the
 * page its tiles link to (plan §3, §5). The counts themselves -- parity with
 * the lists, scope, N+1 -- are pinned against the database in
 * test/integration/dashboard-pd044.spec.ts.
 */
import 'reflect-metadata';
import { ROUTE_ACCESS, type RouteAccess } from '@platform/permissions/route-access';
import { DashboardController } from '../../../src/dashboard/dashboard.controller';
import { dashboardSection, dashboardTile } from '../../../src/dashboard/dashboard-tile';
import type { ConversationService } from '@communication/conversations/conversation.service';
import type { SupervisionCaseService } from '../../../src/cases/supervision-case.service';
import type { TaskService } from '../../../src/tasks/task.service';
import type { CalendarService } from '../../../src/calendar/calendar.service';
import type { TrialService } from '../../../src/lessons/trial.service';
import type { NewStudentEnrolmentService } from '../../../src/new-students/enrolment.service';
import type { OrgStructureService } from '../../../src/org/org-structure.service';
import type { SupervisorCoverService } from '../../../src/org/supervisor-cover.service';
import type { TeacherSupervisorService } from '../../../src/teacher-supervisors/teacher-supervisor.service';

describe('PD-44 dashboard tiles', () => {
  it('a tile is a count, an optional oldest time and a capped flag -- nothing about a person', () => {
    expect(dashboardTile('chats.waiting', 3, new Date('2026-10-28T05:12:00.000Z'))).toEqual({
      key: 'chats.waiting',
      count: 3,
      oldestAt: '2026-10-28T05:12:00.000Z',
      capped: false,
    });
    expect(dashboardTile('cases.overdue', 0)).toEqual({ key: 'cases.overdue', count: 0, oldestAt: null, capped: false });
    expect(Object.keys(dashboardTile('violations.open', 500, null, true)).sort()).toEqual(['capped', 'count', 'key', 'oldestAt']);
  });

  it('a section carries when it was computed and the tiles the caller is covered for', () => {
    const now = new Date('2026-10-28T09:00:00.000Z');
    expect(dashboardSection([], now)).toEqual({ generatedAt: '2026-10-28T09:00:00.000Z', tiles: [] });
  });
});

describe('PD-44 DashboardController', () => {
  const waiting = [dashboardTile('chats.waiting', 2)];
  const caseTiles = [dashboardTile('cases.mine_open', 1), dashboardTile('cases.overdue', 0)];
  const conversations = { dashboardWaiting: jest.fn(async () => waiting) } as unknown as ConversationService;
  const cases = { dashboardCounts: jest.fn(async () => caseTiles) } as unknown as SupervisionCaseService;
  const taskTiles = [dashboardTile('tasks.mine_open', 1)];
  const tasks = { dashboardCounts: jest.fn(async () => taskTiles) } as unknown as TaskService;
  const lessonTiles = [dashboardTile('lessons.today_held', 4)];
  const calendar = { dashboardCounts: jest.fn(async () => lessonTiles) } as unknown as CalendarService;
  const trialTiles = [dashboardTile('trials.awaiting', 2)];
  const trials = { dashboardCounts: jest.fn(async () => trialTiles) } as unknown as TrialService;
  const studentTiles = [dashboardTile('new_students.unassigned', 1)];
  const enrolment = { dashboardCounts: jest.fn(async () => studentTiles) } as unknown as NewStudentEnrolmentService;
  const learnerTiles = [dashboardTile('learners.unsupervised', 2)];
  const org = { dashboardCounts: jest.fn(async () => learnerTiles) } as unknown as OrgStructureService;
  const teacherTiles = [dashboardTile('teachers.unsupervised', 3)];
  const supervisors = { dashboardCounts: jest.fn(async () => teacherTiles) } as unknown as TeacherSupervisorService;
  const coverTiles = [dashboardTile('covers.active', 1)];
  const covers = { dashboardCounts: jest.fn(async () => coverTiles) } as unknown as SupervisorCoverService;
  const controller = new DashboardController(conversations, cases, tasks, calendar, trials, enrolment, org, supervisors, covers);

  it('serves each section from the owning page\'s service, unchanged', async () => {
    const chats = await controller.chats('staff-1');
    expect(chats.tiles).toBe(waiting);
    expect(Number.isNaN(Date.parse(chats.generatedAt))).toBe(false);
    expect(conversations.dashboardWaiting).toHaveBeenCalledWith('staff-1', expect.any(Date));
    expect((await controller.casesSection('staff-1')).tiles).toBe(caseTiles);
    expect(cases.dashboardCounts).toHaveBeenCalledWith('staff-1');
    expect((await controller.tasksSection('staff-1')).tiles).toBe(taskTiles);
    expect(tasks.dashboardCounts).toHaveBeenCalledWith('staff-1');
    expect((await controller.lessons('staff-1')).tiles).toBe(lessonTiles);
    expect(calendar.dashboardCounts).toHaveBeenCalledWith('staff-1', expect.any(Date));
    // PD-44 PR-4: two pages' tiles in one section, the Trials page's first.
    expect((await controller.enrolmentSection('staff-1')).tiles).toEqual([...trialTiles, ...studentTiles]);
    expect(trials.dashboardCounts).toHaveBeenCalledWith('staff-1', expect.any(Date));
    expect(enrolment.dashboardCounts).toHaveBeenCalledWith('staff-1');
    // PD-44 PR-7: the Organization page's tabs -- Children, Teachers, then the Structure tab's covers.
    expect((await controller.structureSection('staff-1')).tiles).toEqual([...learnerTiles, ...teacherTiles, ...coverTiles]);
    for (const svc of [org, supervisors, covers]) expect(svc.dashboardCounts).toHaveBeenCalledWith('staff-1');
  });

  it('the Organization section counts covers only with the covers key', async () => {
    const only = async (...held: string[]) => (await controller.structureSection('staff-1', { permissions: new Set(held) })).tiles;
    expect(await only('org.view')).toEqual([...learnerTiles, ...teacherTiles]);
    expect(await only('org.view', 'org.covers')).toEqual([...learnerTiles, ...teacherTiles, ...coverTiles]);
  });

  it('each section requires the PD-40 key of the page it links to -- no dashboard key of its own', () => {
    const access = (handler: keyof DashboardController) =>
      Reflect.getMetadata(ROUTE_ACCESS, DashboardController.prototype[handler]) as RouteAccess;
    expect(access('chats')).toEqual({ kind: 'requires', anyOf: ['chat.use'] });
    expect(access('casesSection')).toEqual({ kind: 'requires', anyOf: ['cases.view'] });
    // PD-47: everyone's own tasks are self-service, like the Tasks page itself.
    expect(access('tasksSection')).toEqual({ kind: 'self' });
    expect(access('lessons')).toEqual({ kind: 'requires', anyOf: ['lessons.view', 'schedule.view'] });
    expect(access('enrolmentSection')).toEqual({ kind: 'requires', anyOf: ['trials.view', 'new_students.view'] });
    // The Organization page's own key (its lists ask org.view), not org.manage, which only its writes ask.
    expect(access('structureSection')).toEqual({ kind: 'requires', anyOf: ['org.view'] });
  });
});
