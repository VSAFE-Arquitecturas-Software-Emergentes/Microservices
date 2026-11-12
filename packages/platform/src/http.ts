import 'reflect-metadata';
import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  Controller,
  Get,
  Module,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { Pool } from 'pg';
import type { Request, Response, NextFunction } from 'express';
import { InternalGuard, secret } from './security';
import { Problem } from '@vsafe/contracts';
@Catch()
class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const e = error as { code?: string; message?: string };
    const status =
      error instanceof ZodError
        ? 400
        : error instanceof Problem
          ? error.status
          : error instanceof HttpException
            ? error.getStatus()
            : e.code === '23505'
              ? 409
              : 500;
    const body =
      error instanceof ZodError
        ? {
            code: 'VALIDATION_FAILED',
            issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          }
        : { code: status === 500 ? 'INTERNAL_ERROR' : e.message || 'REQUEST_FAILED' };
    if (status === 500)
      console.error(
        JSON.stringify({
          level: 'error',
          code: e.code || 'UNEXPECTED',
          errorType: (error as object)?.constructor?.name,
        }),
      );
    res.status(status).json(body);
  }
}
export async function serve(
  service: string,
  controllers: Function[],
  providers: unknown[],
  pool?: Pool,
) {
  secret('INTERNAL_SECRET');
  @Controller('health')
  class Health {
    @Get('live') live() {
      return { service, status: 'ok' };
    }
    @Get('ready') async ready() {
      if (pool) await pool.query('SELECT 1');
      return { service, status: 'ready' };
    }
  }
  @Module({ controllers: [...(controllers as any[]), Health], providers: providers as any[] })
  class AppModule {}
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: true,
  });
  app.use(helmet({ contentSecurityPolicy: false }), cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const raw = req.header('x-correlation-id');
    const id = raw && /^[a-zA-Z0-9-]{1,100}$/.test(raw) ? raw : randomUUID();
    res.setHeader('x-correlation-id', id);
    res.setHeader('cache-control', 'no-store');
    next();
  });
  app.useGlobalFilters(new ApiErrors());
  if (service === 'gateway')
    app.enableCors({
      origin: (process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(
        ',',
      ),
      credentials: true,
      allowedHeaders: ['content-type', 'x-csrf-token', 'idempotency-key', 'last-event-id'],
    });
  if (service !== 'gateway') app.useGlobalGuards(new InternalGuard(service));
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(`VSafe ${service}`)
      .setVersion('1.0.0')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'x-vsafe-token' }, 'internal')
      .build(),
  );
  SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: '/openapi.json' });
  app.enableShutdownHooks();
  const port = Number(
    process.env.PORT || process.env[`${service.replaceAll('-', '_').toUpperCase()}_PORT`] || 3100,
  );
  await app.listen(port, process.env.HOST || '::');
  return app;
}
