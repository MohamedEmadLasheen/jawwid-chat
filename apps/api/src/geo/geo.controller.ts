import { Controller, Get, Header, Param, UseFilters } from '@nestjs/common';
import { CommErrorFilter } from '../communication/api/http-exception.filter';
import { CommError, CommErrorCode } from '../platform/errors';
import { SelfService } from '../platform/permissions/route-access';
import { countryList, subdivisionsOf } from './location';

/**
 * PD-45 (plan §5.1): the countries and first-level subdivisions the location
 * pickers offer, in Arabic and English, from the pinned CLDR dataset. It is
 * the published list and holds nothing about anyone, so any signed-in account
 * may read it (behind the global bearer guard). Each answer names the dataset
 * version; it changes only with a new build, so a client may keep it a day.
 */
@Controller('geo')
@UseFilters(CommErrorFilter)
export class GeoController {
  // PD-40: shared reference data about no one -- self-service.
  @SelfService()
  @Get('countries')
  @Header('Cache-Control', 'private, max-age=86400')
  countries() {
    return countryList();
  }

  @SelfService()
  @Get('countries/:country/subdivisions')
  @Header('Cache-Control', 'private, max-age=86400')
  subdivisions(@Param('country') country: string) {
    const out = subdivisionsOf(country);
    if (!out) throw new CommError(CommErrorCode.VALIDATION, 'country: not a country of the list (ISO 3166-1 alpha-2, e.g. EG)', 400);
    return out;
  }
}
