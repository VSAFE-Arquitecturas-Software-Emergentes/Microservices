import { Controller, Get, Post, Patch, Delete, Req, Res, Inject } from '@nestjs/common';
import { ApiOperation, ApiBody, ApiHeader } from '@nestjs/swagger';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Problem, SearchSchema, ReportSchema } from '@vsafe/contracts';
import { z } from 'zod';
import { internalToken } from '@vsafe/platform';
import type { Request, Response } from 'express';
import { targetFor } from '../application/routing';
import { Sessions } from '../infrastructure/session';
@Controller('api/v1')
export class GatewayController {
  private readonly limits = new Map<string, { count: number; until: number }>();
  constructor(@Inject(Sessions) private readonly sessions: Sessions) {}
  @Get('sessions') session(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.sessions.ensure(req, res);
  }
  @Post('routes/search')
  @ApiOperation({ summary: 'Compare routes' })
  @ApiBody({ schema: z.toJSONSchema(SearchSchema) as any })
  routes(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Post('journeys')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['alternativeId'],
      properties: { alternativeId: { type: 'string', format: 'uuid' } },
    },
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  start(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Get('journeys/:id') journey(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Patch('journeys/:id/route') route(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Patch('journeys/:id/progress') progress(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Delete('journeys/:id') close(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Post('incident-reports')
  @ApiBody({ schema: z.toJSONSchema(ReportSchema) as any })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  report(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Get('incident-reports') reports(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Get('incident-reports/:id') reportStatus(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Get('incident-reports/:id/audit') audit(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Get('incidents') incidents(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Get('journeys/:id/alerts/stream') stream(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  @Post('journeys/:id/alerts/:alertId/ack') ack(@Req() r: Request, @Res() s: Response) {
    return this.forward(r, s);
  }
  private async forward(req: Request, res: Response) {
    const origin = req.header('origin');
    const allowed = (
      process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173'
    ).split(',');
    if (origin && !allowed.includes(origin)) throw new Problem(403, 'ORIGIN_NOT_ALLOWED');
    const session = this.sessions.authorize(req);
    const now = Date.now();
    if (this.limits.size > 5000)
      for (const [k, v] of this.limits) if (v.until < now) this.limits.delete(k);
    let limit = this.limits.get(session.sub);
    if (!limit || limit.until < now) {
      limit = { count: 0, until: now + 60_000 };
      this.limits.set(session.sub, limit);
    }
    if (++limit.count > 180) throw new Problem(429, 'RATE_LIMITED');
    const target = targetFor(req.path);
    if (!target) throw new Problem(404, 'ENDPOINT_NOT_FOUND');
    const base = process.env[`${target.replaceAll('-', '_').toUpperCase()}_URL`];
    if (!base) throw new Problem(503, 'SERVICE_NOT_CONFIGURED');
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const isStream = req.path.endsWith('/stream');
    const timeout = isStream ? undefined : setTimeout(() => controller.abort(), 4500);
    try {
      const upstream = await fetch(`${base}${req.originalUrl}`, {
        method: req.method,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-vsafe-token': internalToken(target, session.sub),
          'x-correlation-id': String(res.getHeader('x-correlation-id')),
          ...(req.header('last-event-id') ? { 'last-event-id': req.header('last-event-id')! } : {}),
          ...(req.header('idempotency-key')
            ? { 'idempotency-key': req.header('idempotency-key')! }
            : {}),
        },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
      });
      res.status(upstream.status);
      for (const k of ['content-type', 'cache-control', 'x-accel-buffering']) {
        const value = upstream.headers.get(k);
        if (value) res.setHeader(k, value);
      }
      if (isStream) res.flushHeaders();
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body as any), res);
      else res.end();
    } catch {
      if (!res.headersSent) res.status(503).json({ code: 'SERVICE_UNAVAILABLE' });
      else res.end();
    } finally {
      clearTimeout(timeout);
    }
  }
}
