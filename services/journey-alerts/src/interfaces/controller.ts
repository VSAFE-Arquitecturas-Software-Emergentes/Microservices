import { Controller, Get, Post, Param, Req, Res, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { owner } from '@vsafe/platform';
import { AlertsService } from '../application/alerts-service';
@Controller('api/v1/journeys/:journeyId/alerts')
export class AlertsController {
  constructor(@Inject(AlertsService) private readonly service: AlertsService) {}
  @Get('stream') async stream(
    @Req() req: Request,
    @Res() res: Response,
    @Param('journeyId') rawId: string,
  ) {
    const journeyId = z.uuid().parse(rawId);
    const own = owner(req);
    let last = z
      .string()
      .regex(/^\d{0,16}$/)
      .parse(req.header('last-event-id') || '0');
    let closed = false;
    let busy = false;
    const initial = await this.service.list(own, journeyId, last);
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();
    const send = (items: any[]) => {
      for (const item of items) {
        last = item.eventId;
        res.write(`id: ${last}\nevent: alert\ndata: ${JSON.stringify(item)}\n\n`);
      }
    };
    send(initial);
    res.write(': connected\n\n');
    const poll = setInterval(async () => {
      if (closed || busy) return;
      busy = true;
      try {
        send(await this.service.list(own, journeyId, last));
      } catch {
        res.write('event: suspended\ndata: {"code":"JOURNEY_UNAVAILABLE"}\n\n');
        res.end();
      } finally {
        busy = false;
      }
    }, 2000);
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': heartbeat\n\n');
    }, 15000);
    res.on('close', () => {
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
    });
  }
  @Post(':alertId/ack') ack(
    @Req() req: Request,
    @Param('journeyId') journeyId: string,
    @Param('alertId') alertId: string,
  ) {
    return this.service.ack(owner(req), z.uuid().parse(journeyId), z.uuid().parse(alertId));
  }
}
