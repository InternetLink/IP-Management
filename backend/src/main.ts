import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { parseOriginAllowlist } from './http/origin-allowlist';
import { formatLogEvent } from './lib/structured-log';

const logger = new Logger('Bootstrap');

function assertEnv() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    logger.error(formatLogEvent('startup.configuration.invalid', {
      reason: 'AUTH_SECRET must contain at least 32 characters',
    }));
    process.exit(1);
  }
}

async function bootstrap() {
  assertEnv();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const corsOrigins = parseOriginAllowlist();
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  }));
  const port = process.env.PORT ?? '3001';
  const host = process.env.HOST?.trim();
  if (host) {
    await app.listen(port, host);
  } else {
    await app.listen(port);
  }
  logger.log(formatLogEvent('startup.ready', { port }));
}

void bootstrap().catch((error: unknown) => {
  logger.error(formatLogEvent('startup.failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  }));
  process.exitCode = 1;
});
