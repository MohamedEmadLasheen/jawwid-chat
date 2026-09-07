import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseFilters } from '@nestjs/common';
import { GroupService } from './group.service';
import { CurrentActor } from '../auth/current-actor.decorator';
import type { Actor } from '../types';
import { CommErrorFilter } from '../../communication/api/http-exception.filter';

/**
 * Groups -- business entities, not conversations. No route here creates,
 * attaches or returns a conversation.
 */
@Controller('groups')
@UseFilters(CommErrorFilter)
export class GroupController {
  constructor(private readonly groups: GroupService) {}

  @Get()
  async list(@CurrentActor() actor: Actor, @Query('includeArchived') includeArchived?: string) {
    return { groups: await this.groups.list(actor, includeArchived === 'true') };
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: { name?: string; ownerId?: string }) {
    return this.groups.create(actor, { name: String(body?.name ?? ''), ownerId: body?.ownerId });
  }

  @Get(':id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.groups.get(actor, id);
  }

  /** A rename never changes the id -- that is the point of a stable id. */
  @Patch(':id')
  async rename(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { name?: string },
  ) {
    return this.groups.rename(actor, id, String(body?.name ?? ''));
  }

  @Get(':id/members')
  async members(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query('includeFormer') includeFormer?: string,
  ) {
    return { members: await this.groups.members(actor, id, includeFormer !== 'false') };
  }

  @Post(':id/members')
  async addMember(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { learnerId?: string },
  ) {
    return { members: await this.groups.addMember(actor, id, String(body?.learnerId ?? '')) };
  }

  @Delete(':id/members/:learnerId')
  async removeMember(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('learnerId') learnerId: string,
    @Query('reason') reason = '',
  ) {
    return { members: await this.groups.removeMember(actor, id, learnerId, reason) };
  }

  @Get(':id/teachers')
  async teachers(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query('includeFormer') includeFormer?: string,
  ) {
    return { teachers: await this.groups.teachers(actor, id, includeFormer !== 'false') };
  }

  @Post(':id/teachers')
  async addTeacher(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { teacherId?: string },
  ) {
    return { teachers: await this.groups.addTeacher(actor, id, String(body?.teacherId ?? '')) };
  }

  @Delete(':id/teachers/:teacherId')
  async removeTeacher(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('teacherId') teacherId: string,
    @Query('reason') reason = '',
  ) {
    return { teachers: await this.groups.removeTeacher(actor, id, teacherId, reason) };
  }

  @Post(':id/close')
  async close(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.groups.close(actor, id, String(body?.reason ?? ''));
  }

  @Post(':id/archive')
  async archive(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.groups.archive(actor, id, String(body?.reason ?? ''));
  }

  /** The successor gets a NEW id; the old group keeps its own and its history. */
  @Post(':id/replacement')
  async replace(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: { name?: string; reason?: string },
  ) {
    return this.groups.createReplacement(
      actor,
      id,
      String(body?.name ?? ''),
      String(body?.reason ?? ''),
    );
  }

  @Get(':id/history')
  async history(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return { history: await this.groups.history(actor, id) };
  }
}
