import { Body, Controller, Get, Param, Patch, Query, UseFilters } from '@nestjs/common';
import { ActorId } from '../../platform/auth/current-actor.decorator';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';
import { AutomationAdminService } from '../automation/automation-admin.service';

/**
 * The automation READ surface, and the one switch.
 *
 * ## Why this exists, and why it is this small
 *
 * Phase 7 §26 requires that every meaningful automation execution be auditable:
 * what triggered this, which condition matched, what was attempted, whether it
 * ran, whether it was blocked, why, and when. chat.automation_run records all
 * of that -- but a record nobody can reach is not an audit trail, and until this
 * controller existed `automation.manage` was a permission that granted access
 * to nothing.
 *
 * ## What is deliberately absent
 *
 * There is no create, and no edit of a rule's conditions or actions. A rule is
 * data, and editing a condition expression through a JSON body is how somebody
 * disables the only guard on something that messages every family -- the
 * failure the evaluator's fail-closed behaviour exists to make loud rather than
 * to invite. Authoring rules stays a migration, reviewed like any other change.
 *
 * Enable/disable IS here, because it is the control an operator needs at 2am
 * and it cannot express anything unsafe: the worst it can do is stop an
 * automation, and stopping one is always the safe direction.
 */
@Controller('ai/automation')
@UseFilters(CommErrorFilter)
export class AutomationController {
  constructor(private readonly automation: AutomationAdminService) {}

  /** Every rule, with its trigger, condition set and action. */
  @Get('rules')
  async rules(@ActorId() actorId: string) {
    return { rules: await this.automation.listRules(actorId) };
  }

  /**
   * The execution history: the §26 questions, answered.
   *
   * `outcome=blocked` and `outcome=failed` are the two an operator actually
   * hunts for, which is why the index behind this is partial on exactly those.
   */
  @Get('runs')
  async runs(
    @ActorId() actorId: string,
    @Query('ruleKey') ruleKey?: string,
    @Query('outcome') outcome?: string,
  ) {
    return { runs: await this.automation.listRuns(actorId, { ruleKey, outcome }) };
  }

  /** Stop it, or start it. The only mutation this surface allows. */
  @Patch('rules/:key')
  async setEnabled(
    @ActorId() actorId: string,
    @Param('key') key: string,
    @Body() body: { enabled: boolean; reason: string },
  ) {
    return this.automation.setEnabled(actorId, key, body?.enabled === true, body?.reason ?? '');
  }
}
