import 'dotenv/config';
import { database, serve, EventRuntime, appendEvent, loadEnvironment } from '@vsafe/platform';
import { ReportService } from './application/report-service';
import { PgReports } from './infrastructure/pg-reports';
import { BlockchainAudit } from './infrastructure/blockchain-audit';
import { ReportsController } from './interfaces/controller';
async function main() {
  loadEnvironment();
  const pool = database('incident-reporting');
  const repo = new PgReports(pool);
  await repo.expire();
  const audit = new BlockchainAudit(pool);
  audit.start();
  const events = new EventRuntime(pool, 'incident-reporting');
  events.start();
  const service = new ReportService(repo, audit);
  const cleanup = setInterval(() => void repo.expire().catch(() => {}), 15_000);
  cleanup.unref();
  const heartbeat = setInterval(() => {
    void pool
      .query(
        'SELECT COALESCE(max(sequence),0)::text AS sequence FROM outbox WHERE published_at IS NOT NULL',
      )
      .then((r) =>
        appendEvent(pool, 'incident-reporting', 'IncidentWatermark', 'incident-reporting', 0, {
          watermark: Number(r.rows[0].sequence),
        }),
      )
      .catch(() => {});
  }, 10_000);
  heartbeat.unref();
  const app = await serve(
    'incident-reporting',
    [ReportsController],
    [{ provide: ReportService, useValue: service }],
    pool,
  );
  app.getHttpServer().on('close', () => {
    clearInterval(cleanup);
    clearInterval(heartbeat);
    audit.stop();
    void events.stop();
    void pool.end();
  });
}
void main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
