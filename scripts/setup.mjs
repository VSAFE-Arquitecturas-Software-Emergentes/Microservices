import { mkdir, readFile, writeFile, access, cp, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';
import { root, run, npmRun, background, waitFor, pause } from './lib.mjs';
import { config } from 'dotenv';
for (const key of ['ROUTE_PLANNING', 'RISK_ASSESSMENT', 'INCIDENT_REPORTING', 'JOURNEY_ALERTS']) {
  const value = process.env[key + '_DATABASE_URL'];
  if (value) {
    const u = new URL(value);
    if (u.hostname !== '127.0.0.1' || u.port !== '55436')
      throw new Error('Native setup is restricted to isolated local databases on 127.0.0.1:55436.');
  }
}
const local = path.join(root, '.local');
await mkdir(local, { recursive: true });
const exists = async (p) =>
  access(p).then(
    () => true,
    () => false,
  );
async function download(url, name) {
  const target = path.join(local, 'downloads', name);
  if (await exists(target)) return target;
  await mkdir(path.dirname(target), { recursive: true });
  console.log(`Descargando ${name}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${name}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}
if (process.platform !== 'win32')
  throw new Error(
    'Automatic native setup supports Windows. On Linux/macOS configure PostgreSQL/PostGIS and RabbitMQ, then run migrations. See README.',
  );
const zipDir = path.join(local, 'tools', '7zip');
let seven = path.join(zipDir, '7z.exe');
if (!(await exists(seven))) {
  const small = await download(
    'https://github.com/ip7z/7zip/releases/download/26.06/7zr.exe',
    '7zr.exe',
  );
  const installer = await download(
    'https://github.com/ip7z/7zip/releases/download/26.06/7z2606-x64.exe',
    '7zip.exe',
  );
  await run(small, ['x', installer, `-o${zipDir}`, '-y'], { stdio: 'ignore' });
}
async function extract(archive, target) {
  await mkdir(target, { recursive: true });
  await run(seven, ['x', archive, `-o${target}`, '-y'], { stdio: 'ignore' });
}
const pgRoot = path.join(local, 'postgres');
if (!(await exists(path.join(pgRoot, 'bin', 'initdb.exe')))) {
  const installed = process.env.POSTGRES_HOME || 'C:/Program Files/PostgreSQL/18';
  console.log('Copiando binarios PostgreSQL a un entorno aislado');
  for (const name of ['bin', 'lib', 'share'])
    await cp(path.join(installed, name), path.join(pgRoot, name), { recursive: true });
}
if (!(await exists(path.join(pgRoot, 'share', 'extension', 'postgis.control')))) {
  const archive = await download(
    'https://download.osgeo.org/postgis/windows/pg18/postgis-bundle-pg18-3.7.0x64.zip',
    'postgis-pg18-3.7.0.zip',
  );
  const dir = path.join(local, 'postgis-unpacked');
  await extract(archive, dir);
  let source = dir;
  for (const entry of await readdir(dir, { withFileTypes: true }))
    if (entry.isDirectory() && (await exists(path.join(dir, entry.name, 'lib'))))
      source = path.join(dir, entry.name);
  for (const name of ['bin', 'lib', 'share'])
    if (await exists(path.join(source, name)))
      await cp(path.join(source, name), path.join(pgRoot, name), { recursive: true, force: true });
}
// Use the PostgreSQL distribution's compatible curl build; the OSGeo bundle omits two of its curl dependencies.
const originalCurl = path.join(
  process.env.POSTGRES_HOME || 'C:/Program Files/PostgreSQL/18',
  'bin',
  'libcurl.dll',
);
const localCurl = path.join(pgRoot, 'bin', 'libcurl.dll');
if (!(await readFile(originalCurl)).equals(await readFile(localCurl)))
  await cp(originalCurl, localCurl, { force: true });
const erlRoot = path.join(local, 'erlang');
if (!(await exists(path.join(erlRoot, 'bin', 'erl.exe')))) {
  const archive = await download(
    'https://github.com/erlang/otp/releases/download/OTP-29.1.2/otp_win64_29.1.2.exe',
    'otp-29.1.2.exe',
  );
  await extract(archive, erlRoot);
  if (await exists(path.join(erlRoot, 'Install.exe')))
    await run(path.join(erlRoot, 'Install.exe'), ['-s'], { cwd: erlRoot, stdio: 'ignore' });
}
const rabbitParent = path.join(local, 'rabbitmq');
let rabbitRoot = path.join(rabbitParent, 'rabbitmq_server-4.4.0');
if (!(await exists(path.join(rabbitRoot, 'sbin', 'rabbitmq-server.bat')))) {
  const archive = await download(
    'https://github.com/rabbitmq/rabbitmq-server/releases/download/v4.4.0/rabbitmq-server-windows-4.4.0.zip',
    'rabbitmq-4.4.0.zip',
  );
  await extract(archive, rabbitParent);
}
let credentials;
if (await exists(path.join(local, 'credentials.json')))
  credentials = JSON.parse(await readFile(path.join(local, 'credentials.json'), 'utf8'));
else {
  credentials = {
    admin: randomBytes(24).toString('hex'),
    routes: randomBytes(24).toString('hex'),
    risk: randomBytes(24).toString('hex'),
    incidents: randomBytes(24).toString('hex'),
    alerts: randomBytes(24).toString('hex'),
    rabbit: randomBytes(24).toString('hex'),
    cookie: randomBytes(24).toString('hex'),
  };
  await writeFile(path.join(local, 'credentials.json'), JSON.stringify(credentials));
}
const envPath = path.join(root, '.env');
if (!(await exists(envPath))) {
  let env = await readFile(path.join(root, '.env.example'), 'utf8');
  env = env
    .replace(
      'SESSION_SECRET=generate-with-npm-run-setup',
      `SESSION_SECRET=${randomBytes(48).toString('hex')}`,
    )
    .replace(
      'INTERNAL_SECRET=generate-with-npm-run-setup',
      `INTERNAL_SECRET=${randomBytes(48).toString('hex')}`,
    );
  for (const role of ['routes', 'risk', 'incidents', 'alerts'])
    env = env.replace(`vsafe_${role}:CHANGE_ME`, `vsafe_${role}:${credentials[role]}`);
  env = env.replace('vsafe:CHANGE_ME', `vsafe:${credentials.rabbit}`);
  await writeFile(envPath, env);
}
config({ path: envPath, override: true, quiet: true });
const data = path.join(local, 'pgdata');
await mkdir(path.join(local, 'logs'), { recursive: true });
if (!(await exists(path.join(data, 'PG_VERSION')))) {
  const pass = path.join(local, 'pg-init-password');
  await writeFile(pass, credentials.admin);
  await run(
    path.join(pgRoot, 'bin', 'initdb.exe'),
    [
      '-D',
      data,
      '-U',
      'vsafe_admin',
      '-A',
      'scram-sha-256',
      `--pwfile=${pass}`,
      '--encoding=UTF8',
      '--locale=C',
    ],
    { stdio: 'ignore' },
  );
}
const pgEnv = { ...process.env, PGPASSWORD: credentials.admin };
const status = await new Promise((resolve) => {
  const socket = net.connect(55436, '127.0.0.1');
  socket.on('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.on('error', () => resolve(false));
});
if (!status)
  await run(
    path.join(pgRoot, 'bin', 'pg_ctl.exe'),
    [
      '-D',
      data,
      '-l',
      path.join(local, 'logs', 'postgres.log'),
      '-o',
      '-p 55436 -h 127.0.0.1',
      '-w',
      'start',
    ],
    { env: pgEnv, stdio: 'ignore' },
  );
const admin = new pg.Client({
  host: '127.0.0.1',
  port: 55436,
  user: 'vsafe_admin',
  password: credentials.admin,
  database: 'postgres',
});
await admin.connect();
for (const [service, role] of [
  ['route_planning', 'routes'],
  ['risk_assessment', 'risk'],
  ['incident_reporting', 'incidents'],
  ['journey_alerts', 'alerts'],
]) {
  const user = `vsafe_${role}`,
    db = `${service}_db`;
  if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [user])).rowCount)
    await admin.query(`CREATE ROLE ${user} LOGIN PASSWORD '${credentials[role]}'`);
  if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [db])).rowCount)
    await admin.query(`CREATE DATABASE ${db} OWNER ${user}`);
  await admin.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${db} TO ${user}`);
  const c = new pg.Client({
    host: '127.0.0.1',
    port: 55436,
    user: 'vsafe_admin',
    password: credentials.admin,
    database: db,
  });
  await c.connect();
  await c.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await c.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await c.query(`GRANT USAGE,CREATE ON SCHEMA public TO ${user}`);
  await c.end();
}
await admin.end();
const rabbitBase = path.join(local, 'rabbit-data');
await mkdir(rabbitBase, { recursive: true });
await writeFile(
  path.join(rabbitBase, 'rabbitmq.conf'),
  `listeners.tcp.default = 127.0.0.1:5676\ndefault_user = vsafe\ndefault_pass = ${credentials.rabbit}\ndefault_vhost = vsafe\nloopback_users.vsafe = true\n`,
);
const rabbitEnv = {
  ...process.env,
  ERLANG_HOME: erlRoot,
  RABBITMQ_BASE: rabbitBase,
  RABBITMQ_CONFIG_FILE: path.join(rabbitBase, 'rabbitmq'),
  RABBITMQ_NODENAME: 'vsafe@localhost',
  RABBITMQ_NODE_PORT: '5676',
  RABBITMQ_DIST_PORT: '25676',
  RABBITMQ_ERLANG_COOKIE: credentials.cookie,
  RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: '+S 2:2',
  PATH: path.join(erlRoot, 'bin') + ';' + process.env.PATH,
};
const rabbitSettings = Object.fromEntries(
  Object.entries(rabbitEnv).filter(([key]) => key.startsWith('RABBITMQ_') || key === 'ERLANG_HOME'),
);
await writeFile(
  path.join(local, 'runtime.json'),
  JSON.stringify({ pgRoot, data, rabbitRoot, rabbitSettings, erlRoot }, null, 2),
);
let broker = false;
try {
  const amqp = await import('amqplib');
  const c = await amqp.connect(process.env.AMQP_URL);
  await c.close();
  broker = true;
} catch {}
if (!broker) {
  await background(
    'rabbitmq',
    'cmd.exe',
    ['/d', '/s', '/c', `""${path.join(rabbitRoot, 'sbin', 'rabbitmq-server.bat')}""`],
    rabbitEnv,
  );
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const amqp = await import('amqplib');
      const c = await amqp.connect(process.env.AMQP_URL);
      await c.close();
      ready = true;
      break;
    } catch {
      await pause(750);
    }
  }
  if (!ready) throw new Error('RabbitMQ failed to start. See .local/logs/rabbitmq.log');
}
await npmRun('run', 'build', '-w', '@vsafe/contracts');
await npmRun('run', 'build', '-w', '@vsafe/platform');
await npmRun('run', 'db:migrate');
await npmRun('run', 'model:train');
await npmRun('run', 'compile', '-w', '@vsafe/blockchain');
try {
  await waitFor('http://127.0.0.1:8545', 1000);
} catch {
  await background(
    'blockchain',
    process.execPath,
    [
      path.join(root, 'node_modules', 'hardhat', 'dist', 'src', 'cli.js'),
      'node',
      '--hostname',
      '127.0.0.1',
    ],
    process.env,
    path.join(root, 'packages', 'blockchain'),
  );
  await waitFor('http://127.0.0.1:8545', 30000);
}
await npmRun('run', 'chain:deploy');
console.log('Entorno nativo VSafe listo. PostgreSQL existente en 5432 no fue modificado.');
