import EmbeddedPostgres from 'embedded-postgres';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

export async function startDatabase(root, onExit) {
  const state = resolve(root, '.data');
  const directory = resolve(state, 'postgres');
  const credentials = resolve(state, 'database.json');
  const socket = join(process.platform === 'darwin' ? '/tmp' : tmpdir(), `eventdesk-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`);
  await mkdir(state, { recursive: true, mode: 0o700 });
  await mkdir(socket, { recursive: true, mode: 0o700 });
  let config;
  try { config = JSON.parse(await readFile(credentials, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (existsSync(join(directory, 'PG_VERSION'))) throw new Error('Local Postgres credentials are missing from .data/database.json.');
    config = { user: 'eventdesk', database: 'eventdesk', password: randomBytes(32).toString('hex') };
  }
  let postgres;
  for (let attempt = 0; attempt < 4; attempt++) {
    let port;
    if (process.platform === 'win32') {
      const server = createServer();
      await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
      port = server.address().port;
      await new Promise(done => server.close(done));
    }
    config = { ...config, host: process.platform === 'win32' ? '127.0.0.1' : socket, ...(port ? { port } : {}) };
    await writeFile(credentials, `${JSON.stringify(config)}\n`, { mode: 0o600 });
    let startupLog = '';
    postgres = new EmbeddedPostgres({
      databaseDir: directory,
      user: config.user,
      password: config.password,
      authMethod: 'scram-sha-256',
      persistent: true,
      ...(port ? { port } : {}),
      postgresFlags: process.platform === 'win32'
        ? ['-c', 'listen_addresses=127.0.0.1']
        : ['-c', 'listen_addresses=', '-c', `unix_socket_directories=${socket}`, '-c', 'unix_socket_permissions=0700'],
      onLog: message => { startupLog += message; void appendFile(resolve(state, 'postgres.log'), message).catch(() => {}); },
      onError: message => { startupLog += String(message); void appendFile(resolve(state, 'postgres.log'), `${message}\n`).catch(() => {}); },
    });
    try {
      if (!existsSync(join(directory, 'PG_VERSION'))) await postgres.initialise();
      await postgres.start();
      break;
    } catch (error) {
      if (attempt < 3 && process.platform === 'win32' && /address already in use/i.test(startupLog)) continue;
      throw new Error(`Local Postgres could not start. Details: .data/postgres.log. ${error instanceof Error ? error.message : ''}`);
    }
  }
  postgres.process?.once('exit', onExit);
  const client = postgres.getPgClient('postgres', config.host);
  try {
    await client.connect();
    if (!(await client.query("SELECT 1 FROM pg_database WHERE datname = 'eventdesk'")).rowCount) await client.query('CREATE DATABASE eventdesk');
  } catch (error) { await postgres.stop(); throw error; }
  finally { await client.end(); }
  return postgres;
}
