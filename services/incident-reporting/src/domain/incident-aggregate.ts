import { ReportPolicy } from './report-policy';
export class IncidentAggregate {
  private currentVersion = 1;
  private currentStatus: 'PUBLISHED' | 'DUPLICATE' | 'EXPIRED';
  readonly validUntil: Date;
  constructor(
    readonly id: string,
    readonly category: string,
    readonly observedAt: string,
    readonly duplicateOf: string | null,
  ) {
    this.currentStatus = duplicateOf ? 'DUPLICATE' : 'PUBLISHED';
    this.validUntil = ReportPolicy.expiresAt(category, observedAt);
  }
  get version() {
    return this.currentVersion;
  }
  get status() {
    return this.currentStatus;
  }
  expire(now: number) {
    if (this.currentStatus !== 'PUBLISHED' || this.validUntil.getTime() > now) return false;
    this.currentStatus = 'EXPIRED';
    this.currentVersion++;
    return true;
  }
  get publishesIncident() {
    return this.currentStatus === 'PUBLISHED';
  }
}
