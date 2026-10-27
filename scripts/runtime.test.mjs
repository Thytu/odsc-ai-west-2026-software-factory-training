import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const shell = process.platform === 'win32';

test('named HTTPS worktrees run isolated frontend, API, worker, and database stacks', { timeout: 600000 }, async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'eventdesk-runtime-'));
  const token = randomUUID().slice(0, 8);
  const branches = [`runtime-a-${token}`, `runtime-b-${token}`];
  const checkouts = branches.map(branch => join(scratch, branch));
  const children = new Set();
  const env = { ...process.env };
  env.PNPM_CONFIG_STORE_DIR = execFileSync(pnpm, ['store', 'path'], { cwd: root, encoding: 'utf8', shell }).trim();
  let proxy;
  let ca;
  const logs = new Map();

  function launch(command, args, cwd, options = {}) {
    const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', shell: command === pnpm && shell, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    children.add(child);
    const output = [];
    logs.set(child, output);
    child.stdout?.on('data', chunk => output.push(chunk.toString()));
    child.stderr?.on('data', chunk => output.push(chunk.toString()));
    child.once('error', error => { child.startError = error; });
    return child;
  }
  async function complete(child) {
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    assert.equal(code, 0, logs.get(child).join(''));
  }
  async function until(action, milliseconds = 240000) {
    const deadline = Date.now() + milliseconds;
    let lastError;
    while (Date.now() < deadline) {
      try { const value = await action(); if (value) return value; } catch (error) { lastError = error; }
      for (const child of children) if (child.startError) throw child.startError;
      await new Promise(done => setTimeout(done, 300));
    }
    throw new Error('Timed out waiting for an environment checkpoint.', { cause: lastError });
  }
  function call(url, method = 'GET', body) {
    return new Promise((done, reject) => {
      const req = request(url, { ca, method, timeout: 5000, headers: body ? { 'content-type': 'application/json' } : undefined }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.once('end', () => {
          try { assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${url}: ${response.statusCode} ${text.slice(0, 400)}`); done(response.headers['content-type']?.includes('application/json') ? JSON.parse(text) : text); }
          catch (error) { reject(error); }
        });
      });
      req.once('error', reject);
      req.once('timeout', () => req.destroy(new Error('HTTPS request timed out.')));
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  async function stop(child) {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise(done => child.once('close', done));
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await Promise.race([closed, new Promise(done => setTimeout(done, 15000))]);
    if (child.exitCode === null && child.signalCode === null && process.platform !== 'win32') {
      process.kill(-child.pid, 'SIGKILL');
      await closed;
    }
  }
  try {
    if (process.env.CI) {
      env.PORTLESS_STATE_DIR = join(scratch, 'portless');
      const cli = join(root, 'node_modules/portless/dist/cli.js');
      proxy = process.platform === 'win32'
        ? launch(process.execPath, [cli, 'proxy', 'start', '--foreground', '--skip-trust'], root)
        : launch('sudo', ['-n', 'env', `PORTLESS_STATE_DIR=${env.PORTLESS_STATE_DIR}`, process.execPath, cli, 'proxy', 'start', '--foreground', '--skip-trust'], root);
    }
    const caPath = join(env.PORTLESS_STATE_DIR ?? join(homedir(), '.portless'), 'ca.pem');
    await until(() => existsSync(caPath), 30000);
    ca = await readFile(caPath);
    env.NODE_EXTRA_CA_CERTS = caPath;
    for (const [index, checkout] of checkouts.entries()) {
      execFileSync('git', ['worktree', 'add', '-b', branches[index], checkout, 'HEAD'], { cwd: root, stdio: 'ignore' });
      await complete(launch(pnpm, ['install', '--frozen-lockfile', '--offline'], checkout));
    }
    t.diagnostic('Both worktrees have their dependencies.');
    const stacks = checkouts.map(checkout => launch(pnpm, ['dev'], checkout));
    const contexts = await Promise.all(checkouts.map(checkout => until(async () => {
      const path = join(checkout, '.data/runtime.json');
      if (!existsSync(path)) return false;
      return JSON.parse(await readFile(path, 'utf8'));
    })));
    assert.notEqual(contexts[0].url, contexts[1].url);
    assert.ok(contexts.every(context => new URL(context.url).port === '' && context.url.startsWith('https://')));
    for (const context of contexts) {
      const web = await call(`${context.url}/api/environment`);
      const api = await call(`${context.api}/health`);
      assert.equal(web.version, api.version);
      assert.equal(api.version, context.version);
      assert.match(await call(context.url), /Harbor Summit/);
    }
    t.diagnostic('Both named HTTPS frontends and APIs are ready at matching versions.');
    const noticePath = '/backend/attendees/attendee-101/notifications';
    await Promise.all(contexts.map(context => until(async () => (await call(context.url + noticePath)).length === 1)));
    const original = await call(`${contexts[1].api}/sessions/session-101`);
    const room = `Isolated room ${token}`;
    await call(`${contexts[0].api}/sessions/session-101/room`, 'PATCH', { room });
    await call(`${contexts[0].api}/sessions/session-101/reminders`, 'POST');
    await until(async () => (await call(contexts[0].url + noticePath)).some(notice => notice.body.includes(room)), 30000);
    assert.equal((await call(`${contexts[0].api}/sessions/session-101`)).reminders_sent, 2 * original.registrations.length);
    assert.equal((await call(`${contexts[1].api}/sessions/session-101`)).room, original.room);
    assert.equal((await call(`${contexts[1].api}/sessions/session-101`)).reminders_sent, original.registrations.length);
    assert.equal((await call(contexts[1].url + noticePath)).length, 1);
    t.diagnostic('A room change and worker notification in A leave B unchanged.');
    for (const checkout of checkouts) await complete(launch(pnpm, ['stop'], checkout));
    await until(() => stacks.every(stack => stack.exitCode !== null || stack.signalCode !== null), 30000);
    for (const checkout of checkouts) {
      assert.equal(existsSync(join(checkout, '.data/runtime.json')), false);
      assert.equal(existsSync(join(checkout, '.data/dev.lock')), false);
      assert.equal(existsSync(join(checkout, '.data/postgres/postmaster.pid')), false);
    }
    t.diagnostic('Both launchers stopped their services and database cleanly.');
  } catch (error) {
    for (const [child, lines] of logs) {
      await writeFile(join(scratch, `process-${child.pid}.log`), lines.join(''));
      console.error(lines.join('').slice(-6000));
    }
    throw error;
  } finally {
    for (const child of children) if (child !== proxy) await stop(child);
    await stop(proxy);
    for (const checkout of checkouts) await rm(checkout, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    execFileSync('git', ['worktree', 'prune'], { cwd: root, stdio: 'ignore' });
    for (const branch of branches) {
      try { execFileSync('git', ['branch', '-D', branch], { cwd: root, stdio: 'ignore' }); } catch {}
    }
    await rm(scratch, { recursive: true, force: true });
  }
});
