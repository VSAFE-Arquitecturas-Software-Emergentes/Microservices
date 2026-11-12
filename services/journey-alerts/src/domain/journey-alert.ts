import { AlertPolicy } from './alert-policy';
export class JourneyAlertAggregate {
  readonly identity: string;
  private acknowledged = false;
  constructor(
    readonly id: string,
    readonly journeyId: string,
    readonly incidentId: string,
    readonly routeVersion: number,
  ) {
    this.identity = AlertPolicy.identity(journeyId, incidentId, routeVersion);
  }
  acknowledge() {
    if (this.acknowledged) return false;
    this.acknowledged = true;
    return true;
  }
}
