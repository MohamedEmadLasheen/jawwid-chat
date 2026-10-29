import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';

/** PD-45: the country and subdivision lists (reference data; no providers, no database). */
@Module({ controllers: [GeoController] })
export class GeoModule {}
