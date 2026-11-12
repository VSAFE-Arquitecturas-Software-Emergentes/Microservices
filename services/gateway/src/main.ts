import 'dotenv/config';
import { serve, secret, loadEnvironment } from '@vsafe/platform';
import { Sessions } from './infrastructure/session';
import { GatewayController } from './interfaces/controller';
async function main() {
  loadEnvironment();
  secret('SESSION_SECRET');
  await serve('gateway', [GatewayController], [{ provide: Sessions, useValue: new Sessions() }]);
}
void main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
