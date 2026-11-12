import 'dotenv/config';
import { database, serve, EventRuntime, loadEnvironment } from '@vsafe/platform';
import { RiskService } from './application/risk-service';
import { PgEvidence } from './infrastructure/pg-evidence';
import { OnnxInference } from './infrastructure/onnx-adapter';
import { RiskController } from './interfaces/controller';
async function main() {
  loadEnvironment();
  const pool = database('risk-assessment');
  const repo = new PgEvidence(pool);
  const model = new OnnxInference();
  await model.load();
  const service = new RiskService(repo, model, process.env.DATA_MODE === 'demo');
  let connected = false;
  const sync = async () => {
    try {
      await repo.reconcile();
      connected = true;
    } catch {}
  };
  await sync();
  const timer = setInterval(() => {
    if (!connected) void sync();
  }, 5000);
  timer.unref();
  const events = new EventRuntime(
    pool,
    'risk-assessment',
    ['IncidentPublished', 'IncidentExpired', 'IncidentWatermark'],
    (e) => repo.apply(e),
  );
  events.start();
  const app = await serve(
    'risk-assessment',
    [RiskController],
    [{ provide: RiskService, useValue: service }],
    pool,
  );
  app.getHttpServer().on('close', () => {
    clearInterval(timer);
    void events.stop();
    void pool.end();
  });
}
void main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
