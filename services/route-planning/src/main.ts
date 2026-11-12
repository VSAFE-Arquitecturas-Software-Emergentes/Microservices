import 'dotenv/config';
import { database, serve, EventRuntime, loadEnvironment } from '@vsafe/platform';
import { PlanningService } from './application/planning-service';
import { PgJourneys } from './infrastructure/pg-journeys';
import { MapboxProvider, HttpRiskAdapter } from './infrastructure/providers';
import { PlanningController } from './interfaces/controller';
async function main() {
  loadEnvironment();
  const pool = database('route-planning');
  const repo = new PgJourneys(pool);
  await repo.purge();
  const service = new PlanningService(repo, new MapboxProvider(), new HttpRiskAdapter());
  const events = new EventRuntime(pool, 'route-planning');
  events.start();
  const cleanup = setInterval(() => void repo.purge().catch(() => {}), 15_000);
  cleanup.unref();
  const app = await serve(
    'route-planning',
    [PlanningController],
    [{ provide: PlanningService, useValue: service }],
    pool,
  );
  app.getHttpServer().on('close', () => {
    clearInterval(cleanup);
    void events.stop();
    void pool.end();
  });
}
void main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
