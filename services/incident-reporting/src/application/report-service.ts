import { Problem, ReportInput } from '@vsafe/contracts';
import { ReportPolicy } from '../domain/report-policy';
export interface ReportRepository {
  create(owner: string, input: ReportInput, key: string): Promise<unknown>;
  list(owner: string): Promise<unknown>;
  find(owner: string, id: string): Promise<unknown>;
  incidents(bounds?: number[]): Promise<unknown>;
  snapshot(): Promise<unknown>;
  expire(): Promise<void>;
}
export interface AuditPort {
  verify(owner: string, id: string): Promise<unknown>;
}
export class ReportService {
  constructor(
    private readonly repo: ReportRepository,
    private readonly audit: AuditPort,
  ) {}
  create(owner: string, input: ReportInput, key: string) {
    if (!ReportPolicy.validObservation(input.observedAt))
      throw new Problem(400, 'INVALID_OBSERVATION_TIME');
    if (
      input.location.lat < -12.5 ||
      input.location.lat > -11.5 ||
      input.location.lng < -77.4 ||
      input.location.lng > -76.5
    )
      throw new Problem(422, 'OUTSIDE_COVERAGE');
    if (ReportPolicy.expiresAt(input.category, input.observedAt).getTime() <= Date.now())
      throw new Problem(400, 'INCIDENT_ALREADY_EXPIRED');
    return this.repo.create(
      owner,
      { ...input, location: ReportPolicy.approximate(input.location) },
      key,
    );
  }
  list(owner: string) {
    return this.repo.list(owner);
  }
  find(owner: string, id: string) {
    return this.repo.find(owner, id);
  }
  incidents(bounds?: number[]) {
    return this.repo.incidents(bounds);
  }
  snapshot() {
    return this.repo.snapshot();
  }
  verify(owner: string, id: string) {
    return this.audit.verify(owner, id);
  }
}
