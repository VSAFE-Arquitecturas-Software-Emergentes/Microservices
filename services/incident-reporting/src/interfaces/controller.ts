import { Controller, Post, Get, Body, Param, Req, Inject, Headers, Query } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request } from 'express';
import { ReportSchema } from '@vsafe/contracts';
import { owner, technical } from '@vsafe/platform';
import { ReportService } from '../application/report-service';
@Controller()
export class ReportsController {
  constructor(@Inject(ReportService) private readonly service: ReportService) {}
  @Post('api/v1/incident-reports') @ApiBody({ schema: z.toJSONSchema(ReportSchema) as any }) create(
    @Req() req: Request,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.create(
      owner(req),
      ReportSchema.parse(body),
      z.string().min(8).max(100).parse(key),
    );
  }
  @Get('api/v1/incident-reports') list(@Req() req: Request) {
    return this.service.list(owner(req));
  }
  @Get('api/v1/incident-reports/:id') find(@Req() req: Request, @Param('id') id: string) {
    return this.service.find(owner(req), z.uuid().parse(id));
  }
  @Get('api/v1/incident-reports/:id/audit') audit(@Req() req: Request, @Param('id') id: string) {
    return this.service.verify(owner(req), z.uuid().parse(id));
  }
  @Get('api/v1/incidents') incidents(@Query('bbox') bbox?: string) {
    return this.service.incidents(
      bbox ? z.array(z.coerce.number().finite()).length(4).parse(bbox.split(',')) : undefined,
    );
  }
  @Get('internal/v1/incidents/snapshot') snapshot(@Req() req: Request) {
    technical(req, ['risk-assessment', 'journey-alerts']);
    return this.service.snapshot();
  }
}
