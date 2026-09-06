import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { applyInfrastructure } from './infra/http/bootstrap';

/**
 * rawBody is required, not optional: the Jawwid Core webhook signature is
 * computed over the bytes as sent, and a re-serialised body would never verify.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  applyInfrastructure(app);
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('bootstrap').log(`Jawwid Chat API listening on ${port}`);
}

void bootstrap();
