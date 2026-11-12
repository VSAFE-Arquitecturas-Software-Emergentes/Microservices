import { Controller, Post, Req, Body, Inject } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { technical } from '@vsafe/platform';
import { RiskService } from '../application/risk-service';
@Controller('internal/v1/risk-assessments')
export class RiskController {
  constructor(@Inject(RiskService) private readonly service: RiskService) {}
  @Post() assess(@Req() req: Request, @Body() body: unknown) {
    technical(req, ['route-planning']);
    const b = z
      .object({
        routes: z
          .array(
            z.object({
              id: z.uuid(),
              geometry: z.object({
                type: z.literal('LineString'),
                coordinates: z
                  .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
                  .min(2)
                  .max(10000),
              }),
            }),
          )
          .min(1)
          .max(3),
      })
      .parse(body);
    return this.service.assess(b.routes);
  }
}
