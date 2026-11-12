import { randomUUID } from 'node:crypto';
import { Problem, Point, RiskEstimate } from '@vsafe/contracts';
import { JourneyPolicy, Progress } from '../domain/journey';
import { JourneyRepository, RouteProvider, RiskPort } from './ports';
export class PlanningService {
  constructor(
    private readonly journeys: JourneyRepository,
    private readonly provider: RouteProvider,
    private readonly risks: RiskPort,
  ) {}
  async search(owner: string, origin: Point, destination: Point) {
    for (const p of [origin, destination])
      if (p.lat < -12.5 || p.lat > -11.5 || p.lng < -77.4 || p.lng > -76.5)
        throw new Problem(422, 'OUTSIDE_COVERAGE');
    if (Math.abs(origin.lat - destination.lat) + Math.abs(origin.lng - destination.lng) < 0.0001)
      throw new Problem(400, 'IDENTICAL_LOCATIONS');
    const alternatives = await this.provider.alternatives(origin, destination);
    let estimates: Record<string, RiskEstimate> = {};
    try {
      estimates = await this.risks.assess(alternatives);
    } catch {}
    const routes = alternatives.map((r) => ({
      ...r,
      id: r.id || randomUUID(),
      risk: estimates[r.id] || {
        level: 'UNKNOWN' as const,
        score: null,
        cause: 'RISK_SERVICE_UNAVAILABLE',
        coverage: 0,
        sampleCount: 0,
        methodVersion: 'unavailable',
        validUntil: new Date(Date.now() + 60_000).toISOString(),
        demo: r.demo,
      },
    }));
    await this.journeys.saveOptions(owner, routes);
    return {
      routes,
      generatedAt: new Date().toISOString(),
      demo: routes.every((r) => r.demo),
      notice: routes.length === 1 ? 'SINGLE_ALTERNATIVE' : null,
    };
  }
  start(owner: string, id: string, key: string) {
    return this.journeys.start(owner, id, key);
  }
  async get(owner: string, id: string) {
    const j = await this.journeys.find(id, owner);
    if (!j) throw new Problem(404, 'JOURNEY_NOT_FOUND');
    return j;
  }
  change(owner: string, id: string, version: number, alternativeId: string) {
    return this.journeys.change(owner, id, version, alternativeId);
  }
  async progress(owner: string, id: string, version: number, p: Progress) {
    const j = await this.get(owner, id);
    if (!j.route || !JourneyPolicy.validProgress(p, j.route.geometry.coordinates.length - 1))
      throw new Problem(400, 'INVALID_PROGRESS');
    await this.journeys.progress(owner, id, version, p);
    return { updated: true };
  }
  async close(owner: string, id: string) {
    await this.journeys.close(owner, id);
    return { closed: true };
  }
  async active(id: string) {
    const j = await this.journeys.find(id);
    if (!j || j.status !== 'ACTIVE' || !j.route || Date.parse(j.expiresAt) < Date.now())
      throw new Problem(410, 'JOURNEY_NOT_ACTIVE');
    return {
      id: j.id,
      ownerRef: j.ownerRef,
      version: j.version,
      geometry: {
        type: 'LineString',
        coordinates: JourneyPolicy.remaining(j.route.geometry.coordinates, j.progress),
      },
      progressObservedAt: j.progress?.observedAt || new Date(0).toISOString(),
      leaseUntil: new Date(Math.min(Date.parse(j.expiresAt), Date.now() + 270_000)).toISOString(),
    };
  }
}
