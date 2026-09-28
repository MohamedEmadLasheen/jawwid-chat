/**
 * Stories — the authorization decisions, exercised directly.
 *
 * These are the PRIMARY control. RLS on the story tables is defence in depth and
 * is inert on the API path today (docs/security/RLS-STRATEGY.md section 1), so if
 * a verdict here is wrong, nothing downstream catches it. That is why publishing,
 * reading and viewer-list access each get their own decision function and their
 * own tests, rather than one `canUseStories`.
 *
 * Pure: no database, no fixtures on disk, no clock. They pass or fail on the
 * decision alone, which is what makes them meaningful as a role matrix.
 */
import { CommErrorCode } from '@platform/errors';
import { StoryAudienceKind, UNSCOPED_STORY_AUDIENCE_KINDS } from '@communication/contracts/vocab';
import {
  academicStaff,
  admin,
  authzWithOnDuty,
  financeStaff,
  manager,
  parent,
  teacher,
} from '../../support/fixtures';

const authz = authzWithOnDuty();

/** `coverage` is a family-facing role; the fixtures build one from admin(). */
const coverageAdmin = () => admin('coverage-1', 'coverage');

describe('who may publish a story', () => {
  it('admin, coverage and manager may — the family-facing roles, and exactly them', () => {
    for (const actor of [admin(), coverageAdmin(), manager()]) {
      expect(authz.canPublishStory(actor).allowed).toBe(true);
    }
  });

  it('department staff may not, even though they are real staff', () => {
    for (const actor of [financeStaff(), academicStaff()]) {
      const d = authz.canPublishStory(actor);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_CANNOT_PUBLISH);
    }
  });

  it('a parent may not', () => {
    const d = authz.canPublishStory(parent());
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_CANNOT_PUBLISH);
  });

  it('a teacher may not', () => {
    const d = authz.canPublishStory(teacher());
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_CANNOT_PUBLISH);
  });

  it('a DEACTIVATED admin may not — checked before the role, so a stale row cannot publish', () => {
    const d = authz.canPublishStory({ ...admin(), isActive: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('there is no staff role named super_admin or coverage_admin to grant it to', () => {
    // Those are the ABANDONED Phase 5 lineage's role names. If either ever
    // resolves to a publisher, somebody has reintroduced a second role
    // vocabulary that no other part of this product knows about.
    for (const role of ['super_admin', 'coverage_admin']) {
      expect(authz.canPublishStory(admin('x', role)).allowed).toBe(false);
    }
  });
});

describe('who may read a story feed', () => {
  it('a parent, a teacher and staff all may — WHICH stories is a different question', () => {
    for (const actor of [parent(), teacher(), admin(), financeStaff()]) {
      expect(authz.canReadStories(actor).allowed).toBe(true);
    }
  });

  it('a contact who may not communicate has no feed', () => {
    const d = authz.canReadStories({ ...parent(), canMessage: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_CANNOT_READ);
  });

  it('a deactivated actor has no feed', () => {
    const d = authz.canReadStories({ ...parent(), isActive: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('reading is NOT permission to publish — the two verdicts are independent', () => {
    // The bug this guards: collapsing the two into one "stories" permission,
    // after which anybody who can see a story can post one.
    expect(authz.canReadStories(parent()).allowed).toBe(true);
    expect(authz.canPublishStory(parent()).allowed).toBe(false);
  });
});

describe('who may see WHO viewed a story', () => {
  it('a publisher may', () => {
    for (const actor of [admin(), coverageAdmin(), manager()]) {
      expect(authz.canReadStoryViewers(actor).allowed).toBe(true);
    }
  });

  it('a RECIPIENT may not — a parent is not the owner of an academy publication', () => {
    const d = authz.canReadStoryViewers(parent());
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_CANNOT_PUBLISH);
  });

  it('a teacher may not', () => {
    expect(authz.canReadStoryViewers(teacher()).allowed).toBe(false);
  });

  it('department staff may not', () => {
    expect(authz.canReadStoryViewers(financeStaff()).allowed).toBe(false);
  });

  it('being able to READ a feed never implies seeing a viewer list', () => {
    expect(authz.canReadStories(teacher()).allowed).toBe(true);
    expect(authz.canReadStoryViewers(teacher()).allowed).toBe(false);
  });
});

describe('the audience vocabulary matches this schema, not the abandoned lineage', () => {
  it('has no `label` kind — chat.family_label does not exist here (Phase 2)', () => {
    expect(Object.values(StoryAudienceKind)).not.toContain('label');
  });

  it('has no `group` kind — a group IS a conversation on this schema', () => {
    expect(Object.values(StoryAudienceKind)).not.toContain('group');
    expect(Object.values(StoryAudienceKind)).toContain('conversation');
  });

  it('marks exactly the three record-less kinds as unscoped', () => {
    expect([...UNSCOPED_STORY_AUDIENCE_KINDS].sort()).toEqual(
      ['all_families', 'all_teachers', 'assigned_families'].sort(),
    );
  });

  it('every scoped kind is one the resolver can validate against a real table', () => {
    const scoped = Object.values(StoryAudienceKind).filter(
      (k) => !UNSCOPED_STORY_AUDIENCE_KINDS.has(k),
    );
    expect(scoped.sort()).toEqual(['contact', 'conversation', 'family', 'teacher'].sort());
  });
});
