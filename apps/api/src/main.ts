import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { applyInfrastructure } from './infra';

/**
 * HTTP + websocket entrypoint.
 *
 * Infrastructure concerns (security headers, CORS, graceful shutdown) come from
 * AI #7's applyInfrastructure so a new entrypoint cannot silently omit them.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  applyInfrastructure(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  new Logger('Bootstrap').log(`Jawwid Chat API listening on ${port}`);
}

void bootstrap();
