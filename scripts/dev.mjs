import { spawn, execFileSync } from 'node:child_process';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDatabase } from './postgres.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = resolve(root, '.data');
const lock = resolve(state, 'dev.lock');
const manifest = resolve(state, 'runtime.json');
const children = new Set();
const appUrl = process.env.PORTLESS_URL;
if (!appUrl || !process.env.PORT) throw new Error('Start Eventdesk with pnpm dev.');
const apiUrl = new URL(appUrl);
apiUrl.hostname = `api.${apiUrl.hostname}`;
const apiName = apiUrl.hostname.replace(/\.localhost$/, '');
const version = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const environment = {
  ...process.env,
  DEPLOY_VERSION: version,
  EVENTDESK_LOCAL_DATABASE: '1',
  EVENTDESK_LOG_PATH: resolve(state, 'events.jsonl'),
  EVENTDESK_API_ORIGIN: apiUrl.origin,
};
let stopping = false;
let ownsLock = false;
let postgres;
let startingDatabase;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (startingDatabase) postgres = await startingDatabase.catch(() => undefined);
  if (ownsLock) await rm(manifest, { force: true });
  const running = [...children];
  const closed = running.map(child => child.exitCode !== null || child.signalCode !== null || !child.pid ? Promise.resolve() : new Promise(done => child.once('close', done)));
  for (const child of running) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(error.message);
    }
  }
  const deadline = setTimeout(() => {
    for (const child of running) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }
  }, 5000);
  await Promise.all(closed);
  clearTimeout(deadline);
  if (postgres?.process?.exitCode === null && postgres.process.signalCode === null) await postgres.stop();
  if (ownsLock) await rm(lock, { force: true });
  process.exit(code);
}

function run(name, command, args, env = environment) {
  if (stopping) throw new Error('This environment is stopping.');
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', detached: process.platform !== 'win32', shell: process.platform === 'win32' });
  children.add(child);
  child.once('error', error => {
    console.error(`${name}: ${error.message}`);
    void stop(1);
  });
  child.once('close', (code, signal) => {
    children.delete(child);
    if (!stopping && !['seed', 'migrate'].includes(name)) {
      console.error(`${name} stopped (${signal ?? code}). Stopping this environment.`);
      void stop(code || 1);
    }
  });
  return child;
}

async function waitFor(url, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch {}
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error(`Environment did not become ready: ${url}`);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop());

try {
  await mkdir(state, { recursive: true });
  try {
    const handle = await open(lock, 'wx');
    await handle.writeFile(String(process.pid));
    await handle.close();
    ownsLock = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lock, 'utf8'));
    try { process.kill(pid, 0); }
    catch (cause) {
      if (cause.code !== 'ESRCH') throw cause;
      await rm(lock);
      const handle = await open(lock, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      ownsLock = true;
    }
    if (!ownsLock) throw new Error('Eventdesk is already running in this checkout. Use pnpm context to find its URL.');
  }
  await rm(manifest, { force: true });
  startingDatabase = startDatabase(root, () => { if (!stopping) { console.error('Local Postgres stopped.'); void stop(1); } });
  postgres = await startingDatabase;
  startingDatabase = undefined;
  if (stopping) throw new Error('This environment is stopping.');
  const migrate = run('migrate', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['db:migrate']);
  await new Promise((done, reject) => {
    migrate.once('error', reject);
    migrate.once('close', code => code === 0 ? done() : reject(new Error('Database migration failed.')));
  });
  const seed = run('seed', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['seed']);
  await new Promise((done, reject) => {
    seed.once('error', reject);
    seed.once('close', code => code === 0 ? done() : reject(new Error('Database setup failed.')));
  });
  run('API', process.platform === 'win32' ? 'portless.cmd' : 'portless', [apiName, 'tsx', 'watch', 'apps/api/src/index.ts']);
  await waitFor(`${apiUrl.origin}/health`);
  run('worker', 'tsx', ['watch', 'apps/worker/src/index.ts']);
  run('web', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--dir', 'apps/web', 'dev']);
  await waitFor(`${appUrl}/backend/sessions`);
  await waitFor(appUrl);
  await writeFile(manifest, `${JSON.stringify({ url: appUrl, api: `${appUrl}/backend`, version, pid: process.pid, checkout: root }, null, 2)}\n`);
  console.log(`\nEventdesk is ready: ${appUrl}\nEnvironment: .data/runtime.json\nLogs: .data/events.jsonl\n`);
} catch (error) {
  console.error(error.message);
  await stop(1);
}
