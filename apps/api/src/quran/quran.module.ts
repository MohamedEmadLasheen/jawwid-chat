import { Module } from '@nestjs/common';
import { PINNED_QURAN_DATASETS } from './pinned';
import { PrismaQuranStore } from './prisma-quran.store';
import { QuranController } from './quran.controller';
import { QURAN_PINNED, QURAN_STORE, QuranTextService } from './quran-text.service';

/**
 * The one Quran dataset (PD-29 amendment, materials quality P0-2): text,
 * per-ayah audio keys and approved Tajweed, verified against fingerprints
 * pinned in code. Materials and the PD-39 whiteboard both read it here.
 * Surah metadata stays in materials/quran-surahs.ts.
 */
@Module({
  controllers: [QuranController],
  providers: [
    QuranTextService,
    { provide: QURAN_STORE, useClass: PrismaQuranStore },
    { provide: QURAN_PINNED, useValue: PINNED_QURAN_DATASETS },
  ],
  exports: [QuranTextService],
})
export class QuranModule {}
