import 'dotenv/config';
import { database, serve, EventRuntime, loadEnvironment } from '@vsafe/platform';
import { AlertsService } from './application/alerts-service';
import { PgAlerts } from './infrastructure/pg-alerts';
import { AlertsController } from './interfaces/controller';
async function main() {
  loadEnvironment();
  const pool = database('journey-alerts');
  const repo = new PgAlerts(pool);
  await repo.purge();
  let synced = false;
  const sync = async () => {
    try {
      await repo.reconcile();
      synced = true;
    } catch {}
  };
  await sync();
  const events = new EventRuntime(
    pool,
    'journey-alerts',
    [
      'JourneyStarted',
      'JourneyRouteChanged',
      'JourneyClosed',
      'IncidentPublished',
      'IncidentExpired',
      'IncidentWatermark',
    ],
    (e) => repo.apply(e),
  );
  events.start();
  const refresh = setInterval(() => {
    void repo
      .purge()
      .then(() => repo.refresh())
      .catch(() => {});
    if (!synced) void sync();
  }, 15_000);
  refresh.unref();
  const service = new AlertsService(repo);
  const app = await serve(
    'journey-alerts',
    [AlertsController],
    [{ provide: AlertsService, useValue: service }],
    pool,
  );
  app.getHttpServer().on('close', () => {
    clearInterval(refresh);
    void events.stop();
    void pool.end();
  });
}
void main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
