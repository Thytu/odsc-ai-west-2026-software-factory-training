import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { startDatabase } from './postgres.mjs';

test('checkout databases are isolated, persistent, and restart after a crash', { timeout: 120000 }, async () => {
  const roots = await Promise.all([1, 2].map(() => mkdtemp(join(tmpdir(), 'eventdesk-test-'))));
  const servers = new Set();
  const clients = new Set();
  async function start(root) {
    const server = await startDatabase(root);
    servers.add(server);
    const config = JSON.parse(await readFile(join(root, '.data/database.json'), 'utf8'));
    const client = new pg.Client(config);
    clients.add(client);
    await client.connect();
    return { server, client, config };
  }
  try {
    const [a, b] = await Promise.all(roots.map(start));
    assert.notEqual(a.config.password, b.config.password);
    if (process.platform === 'win32') assert.notEqual(a.config.port, b.config.port);
    else {
      assert.notEqual(a.config.host, b.config.host);
      assert.equal((await a.client.query('SHOW listen_addresses')).rows[0].listen_addresses, '');
    }
    await a.client.query('CREATE TABLE isolation_fixture (value text NOT NULL)');
    await a.client.query("INSERT INTO isolation_fixture VALUES ('saved in A')");
    assert.equal((await b.client.query("SELECT to_regclass('isolation_fixture') AS fixture")).rows[0].fixture, null);
    await a.client.end();
    await a.server.stop();
    assert.notEqual(a.server.process.exitCode ?? a.server.process.signalCode, null);
    assert.equal((await b.client.query('SELECT 1 AS alive')).rows[0].alive, 1);

    const restarted = await start(roots[0]);
    assert.equal((await restarted.client.query('SELECT value FROM isolation_fixture')).rows[0].value, 'saved in A');
    await restarted.client.end();
    const exited = new Promise(done => restarted.server.process.once('exit', done));
    restarted.server.process.kill('SIGKILL');
    await exited;

    const recovered = await start(roots[0]);
    assert.equal((await recovered.client.query('SELECT value FROM isolation_fixture')).rows[0].value, 'saved in A');
  } finally {
    await Promise.all([...clients].map(client => client.end().catch(() => {})));
    await Promise.all([...servers].map(server => server.stop()));
    await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
  }
});
