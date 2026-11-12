import {
  Controller,
  Post,
  Patch,
  Delete,
  Get,
  Body,
  Param,
  Req,
  Inject,
  Headers,
} from '@nestjs/common';
import { ApiOperation, ApiBody } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';
import { SearchSchema } from '@vsafe/contracts';
import { owner, technical } from '@vsafe/platform';
import { PlanningService } from '../application/planning-service';
const id = z.uuid();
const key = z.string().min(8).max(100);
@Controller()
export class PlanningController {
  constructor(@Inject(PlanningService) private readonly service: PlanningService) {}
  @Post('api/v1/routes/search')
  @ApiOperation({ summary: 'Compare walking routes' })
  @ApiBody({ schema: z.toJSONSchema(SearchSchema) as any })
  search(@Req() r: Request, @Body() body: unknown) {
    const b = SearchSchema.parse(body);
    return this.service.search(owner(r), b.origin, b.destination);
  }
  @Post('api/v1/journeys') start(
    @Req() r: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') k: string,
  ) {
    const b = z.object({ alternativeId: id }).strict().parse(body);
    return this.service.start(owner(r), b.alternativeId, key.parse(k));
  }
  @Get('api/v1/journeys/:id') get(@Req() r: Request, @Param('id') i: string) {
    return this.service.get(owner(r), id.parse(i));
  }
  @Patch('api/v1/journeys/:id/route') change(
    @Req() r: Request,
    @Param('id') i: string,
    @Body() body: unknown,
  ) {
    const b = z
      .object({ expectedVersion: z.number().int().positive(), alternativeId: id })
      .strict()
      .parse(body);
    return this.service.change(owner(r), id.parse(i), b.expectedVersion, b.alternativeId);
  }
  @Patch('api/v1/journeys/:id/progress') progress(
    @Req() r: Request,
    @Param('id') i: string,
    @Body() body: unknown,
  ) {
    const b = z
      .object({
        routeVersion: z.number().int().positive(),
        segmentIndex: z.number().int().nonnegative(),
        fractionAlong: z.number().min(0).max(1),
        observedAt: z.iso.datetime(),
      })
      .strict()
      .parse(body);
    return this.service.progress(owner(r), id.parse(i), b.routeVersion, b);
  }
  @Delete('api/v1/journeys/:id') close(@Req() r: Request, @Param('id') i: string) {
    return this.service.close(owner(r), id.parse(i));
  }
  @Get('internal/v1/journeys/:id/active') active(@Req() r: Request, @Param('id') i: string) {
    technical(r, ['journey-alerts']);
    return this.service.active(id.parse(i));
  }
}
