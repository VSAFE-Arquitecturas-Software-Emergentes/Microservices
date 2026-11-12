export class AlertPolicy {
  static relevant(
    distanceMeters: number,
    incidentValidUntil: number,
    progressAt: number,
    leaseUntil: number,
    now = Date.now(),
  ) {
    return (
      distanceMeters <= 200 &&
      incidentValidUntil > now &&
      leaseUntil > now &&
      progressAt >= now - 60_000
    );
  }
  static identity(journeyId: string, incidentId: string, routeVersion: number) {
    return `${journeyId}:${incidentId}:${routeVersion}`;
  }
}
