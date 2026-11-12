export interface VersionedEstimate {
  methodVersion: string;
  score: number | null;
  level: string;
}
/** All alternatives in one comparison must use a single method version. */
export class RiskAssessmentAggregate<T extends VersionedEstimate> {
  private readonly estimates: Record<string, T> = {};
  constructor(readonly methodVersion: string) {}
  add(routeId: string, estimate: T) {
    if (estimate.methodVersion !== this.methodVersion) throw new Error('MIXED_MODEL_VERSIONS');
    if (estimate.level === 'UNKNOWN' && estimate.score !== null)
      throw new Error('UNKNOWN_HAS_NO_SCORE');
    if (this.estimates[routeId]) throw new Error('DUPLICATE_ROUTE_ASSESSMENT');
    this.estimates[routeId] = estimate;
  }
  complete(expected: number) {
    if (Object.keys(this.estimates).length !== expected) throw new Error('INCOMPLETE_ASSESSMENT');
    return { ...this.estimates };
  }
}
