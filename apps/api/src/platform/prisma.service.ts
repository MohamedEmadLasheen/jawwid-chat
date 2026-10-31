import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { pooledDatabaseUrl } from './database-pool';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // @Optional with a token nobody provides: Nest injects nothing, tests may pass client options.
  constructor(@Optional() @Inject('PRISMA_CLIENT_OPTIONS') options: Prisma.PrismaClientOptions = {}) {
    // The pool size and wait come from database-pool.ts unless a caller names its own datasource.
    super(options.datasources || options.datasourceUrl ? options : { ...options, datasourceUrl: pooledDatabaseUrl(process.env.DATABASE_URL) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
