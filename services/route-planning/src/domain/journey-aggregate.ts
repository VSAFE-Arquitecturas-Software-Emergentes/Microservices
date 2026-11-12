export class JourneyRuleViolation extends Error {}
/** Identity and lifecycle belong to this aggregate, not to the persistence framework. */
export class JourneyAggregate {
  constructor(
    readonly id: string,
    readonly ownerRef: string,
    private currentVersion: number,
    private currentStatus: 'ACTIVE' | 'CLOSED',
    private selectedRoute: string,
  ) {}
  get version() {
    return this.currentVersion;
  }
  get status() {
    return this.currentStatus;
  }
  selectRoute(routeId: string, expectedVersion: number) {
    if (this.currentStatus !== 'ACTIVE' || expectedVersion !== this.currentVersion)
      throw new JourneyRuleViolation('JOURNEY_VERSION_CONFLICT');
    this.selectedRoute = routeId;
    this.currentVersion++;
  }
  close() {
    if (this.currentStatus === 'CLOSED') return false;
    this.currentStatus = 'CLOSED';
    this.currentVersion++;
    return true;
  }
}
