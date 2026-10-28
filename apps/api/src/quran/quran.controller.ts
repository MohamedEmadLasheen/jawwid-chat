import { Controller, Get, Header, Query, UseFilters } from '@nestjs/common';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { ActionScope, RateLimited } from '../platform/auth/action-throttle.guard';
import { QuranTextService } from './quran-text.service';
import { SelfService } from '../platform/permissions/route-access';
import { CurrentActor } from '../communication/api/actor.decorator';
import type { Actor } from '../platform/types';

/**
 * The shared, verified Quran text (docs/product/quran-dataset-contract.md).
 * Behind the global bearer guard: any signed-in account may read it. Read-only.
 */
@Controller('quran')
@UseFilters(CommErrorFilter)
export class QuranController {
  constructor(private readonly quran: QuranTextService) {}

  /** ?surah=N&from=A&to=B, at most 50 ayat; each ayah with its hash and, when the release gate allows this account, its audio. */
  // PD-40: shared reference text any signed-in account may read -- self-service.
  @SelfService()
  @RateLimited(ActionScope.QURAN_READ)
  @Get('ayahs')
  // The answer can carry this caller's own signed audio URLs: never cached or shared.
  @Header('Cache-Control', 'private, no-store')
  ayahs(@Query() query: Record<string, unknown>, @CurrentActor() actor: Actor) {
    // Audio rides only on what the release gate lets this account have (audio-gate.ts).
    return this.quran.ayahs(query ?? {}, actor);
  }

  /** The approved, signed-off Tajweed marks of a range (none are shipped yet). */
  @SelfService()
  @RateLimited(ActionScope.QURAN_READ)
  @Get('tajweed')
  tajweed(@Query() query: Record<string, unknown>) {
    return this.quran.tajweed(query ?? {});
  }
}
