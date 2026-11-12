import type { IntegrationEvent } from '@vsafe/contracts';
export interface AlertsRepository {
  apply(event: IntegrationEvent): Promise<void>;
  refresh(id?: string): Promise<void>;
  list(owner: string, journeyId: string, lastId: string): Promise<unknown[]>;
  ack(owner: string, journeyId: string, alertId: string): Promise<void>;
  reconcile(): Promise<void>;
  purge(): Promise<void>;
}
export class AlertsService {
  constructor(private readonly repo: AlertsRepository) {}
  async list(owner: string, journeyId: string, lastId: string) {
    await this.repo.refresh(journeyId);
    return this.repo.list(owner, journeyId, lastId);
  }
  async ack(owner: string, journeyId: string, alertId: string) {
    await this.repo.ack(owner, journeyId, alertId);
    return { acknowledged: true };
  }
}
