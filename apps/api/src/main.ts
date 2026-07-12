import './observability/instrument'; // Sentry.init — must run before any other import (Spec §11)
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false });
  const config = app.get(ConfigService);

  // The API returns only JSON — lock the CSP down hard (Spec §10). No page loads
  // resources from these responses, so nothing beyond 'none'/'self' is needed.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    }),
  );
  app.use(cookieParser());
  app.getHttpAdapter().getInstance().set('trust proxy', 1); // real client IP for audit (Spec §5.10)

  app.enableCors({
    origin: [
      config.get<string>('INTERNAL_APP_URL', 'http://localhost:3000'),
      config.get<string>('PORTAL_APP_URL', 'http://localhost:3001'),
    ],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.setGlobalPrefix('api');

  const port = config.get<number>('API_PORT', 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Rademics API listening on http://localhost:${port}/api`);
}

void bootstrap();
