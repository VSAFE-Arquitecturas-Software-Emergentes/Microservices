import { z } from 'zod';
export const PointSchema = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .strict();
export type Point = z.infer<typeof PointSchema>;
export type Geometry = { type: 'LineString'; coordinates: [number, number][] };
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
export interface RiskEstimate {
  level: RiskLevel;
  score: number | null;
  cause: string | null;
  coverage: number;
  sampleCount: number;
  methodVersion: string;
  validUntil: string;
  demo: boolean;
}
export interface RouteAlternative {
  id: string;
  label: string;
  geometry: Geometry;
  distance: number;
  duration: number;
  risk: RiskEstimate;
  demo: boolean;
}
export interface Journey {
  id: string;
  version: number;
  status: 'ACTIVE' | 'CLOSED';
  route: RouteAlternative | null;
  progress: { segmentIndex: number; fractionAlong: number; observedAt: string } | null;
  expiresAt: string;
}
export const SearchSchema = z.object({ origin: PointSchema, destination: PointSchema }).strict();
export const ReportSchema = z
  .object({
    category: z.enum(['THEFT', 'ASSAULT', 'HARASSMENT', 'OBSTRUCTION']),
    location: PointSchema,
    observedAt: z.iso.datetime(),
    description: z.string().trim().max(500).default(''),
  })
  .strict();
export type ReportInput = z.infer<typeof ReportSchema>;
export interface Incident {
  id: string;
  category: string;
  location: Point;
  observedAt: string;
  validUntil: string;
  version: number;
  status: string;
  demo: boolean;
}
export interface IntegrationEvent {
  eventId: string;
  type: string;
  schemaVersion: 1;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  correlationId: string;
  source: string;
  sequence: number;
  payload: Record<string, unknown>;
}
export const EventSchema = z.object({
  eventId: z.uuid(),
  type: z.string().max(80),
  schemaVersion: z.literal(1),
  aggregateId: z.string().max(100),
  aggregateVersion: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
  correlationId: z.string().max(100),
  source: z.string().max(80),
  sequence: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
});
export class Problem extends Error {
  constructor(
    public readonly status: number,
    code: string,
  ) {
    super(code);
  }
}
