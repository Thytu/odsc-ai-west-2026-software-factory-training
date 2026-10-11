import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import pg from 'pg';

const execute = promisify(execFile);

async function availablePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}

async function launchDatabase(binaries, directory, flags, logPath) {
  let pid;
  let isRunning;
  let exited;
  let spawnError;
  if (process.platform === 'win32') {
    await writeFile(logPath, '', { flag: 'a', mode: 0o600 });
    await execute(binaries.pg_ctl, ['-D', directory, '-l', logPath, '-o', flags.join(' '), '-w', '-t', '20', 'start'], { timeout: 30000 });
    pid = Number((await readFile(join(directory, 'postmaster.pid'), 'utf8')).split('\n')[0]);
    let alive = true;
    isRunning = () => alive;
    exited = new Promise(done => {
      const monitor = setInterval(() => {
        try { process.kill(pid, 0); }
        catch (error) {
          if (error.code !== 'ESRCH') return;
          alive = false;
          clearInterval(monitor);
          done();
        }
      }, 100);
    });
  } else {
    const child = spawn(binaries.postgres, ['-D', directory, ...flags], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    pid = child.pid;
    const log = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once('error', error => { spawnError = error; });
    exited = new Promise(done => child.once('close', () => { log.end(); done(); }));
    isRunning = () => child.exitCode === null && child.signalCode === null && !spawnError;
  }
  let stopping;
  const stop = () => stopping ??= (async () => {
    if (!isRunning() || !pid) return exited;
    try {
      await execute(binaries.pg_ctl, ['-D', directory, '-m', 'fast', '-w', '-t', '15', 'stop'], { timeout: 20000 });
    } catch (error) { if (isRunning()) throw error; }
    await exited;
  })();
  return { pid, exited, isRunning, stop, error: () => spawnError };
}

export async function startDatabase(root, onExit = () => {}) {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  let binaries;
  try { binaries = await import(`@embedded-postgres/${platform}-${process.arch}`); }
  catch { throw new Error('Postgres binaries are unavailable for this platform. Run pnpm install with optional dependencies enabled.'); }
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
  await writeFile(credentials, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  if (!existsSync(join(directory, 'PG_VERSION'))) {
    await rm(directory, { recursive: true, force: true });
    const passwordFile = resolve(state, '.postgres-password');
    await writeFile(passwordFile, `${config.password}\n`, { mode: 0o600 });
    try {
      await execute(binaries.initdb, ['-D', directory, '--username', config.user, '--pwfile', passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'], { timeout: 60000 });
    } finally { await rm(passwordFile, { force: true }); }
  }
  if (existsSync(join(directory, 'postmaster.pid'))) {
    let running = false;
    try { await execute(binaries.pg_ctl, ['-D', directory, 'status']); running = true; }
    catch (error) { if (![3, 4].includes(error.code)) throw error; }
    if (running) await execute(binaries.pg_ctl, ['-D', directory, '-m', 'fast', '-w', '-t', '15', 'stop'], { timeout: 20000 });
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    config = { ...config, host: process.platform === 'win32' ? '127.0.0.1' : socket, ...(process.platform === 'win32' ? { port: await availablePort() } : {}) };
    await writeFile(credentials, `${JSON.stringify(config)}\n`, { mode: 0o600 });
    const flags = process.platform === 'win32'
      ? ['-p', String(config.port), '-c', 'listen_addresses=127.0.0.1']
      : ['-c', 'listen_addresses=', '-c', `unix_socket_directories=${socket}`, '-c', 'unix_socket_permissions=0700'];
    const logPath = resolve(state, 'postgres.log');
    let server;
    try {
      server = await launchDatabase(binaries, directory, flags, logPath);
      const deadline = Date.now() + 20000;
      while (true) {
        if (server.error()) throw server.error();
        if (!server.isRunning()) throw new Error('Postgres exited during startup.');
        const client = new pg.Client({ ...config, database: 'postgres', connectionTimeoutMillis: 1000 });
        try {
          await client.connect();
          if (!(await client.query("SELECT 1 FROM pg_database WHERE datname = 'eventdesk'")).rowCount) await client.query('CREATE DATABASE eventdesk');
          break;
        } catch (error) {
          if (Date.now() >= deadline) throw error;
          await new Promise(done => setTimeout(done, 150));
        } finally { await client.end(); }
      }
      void server.exited.then(onExit);
      return server;
    } catch (error) {
      await server?.stop();
      const startupLog = await readFile(logPath, 'utf8').catch(() => '');
      if (attempt < 3 && process.platform === 'win32' && /address already in use/i.test(startupLog)) continue;
      throw new Error(`Local Postgres could not start. Details: .data/postgres.log. ${error.message}`);
    }
  }
}
