import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@eventdesk/data';

const db = openDatabase({ migration: true });
const client = await db.connect();
try {
  await client.query('SELECT pg_advisory_lock(1698516000)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const directory = fileURLToPath(new URL('../packages/data/migrations/', import.meta.url));
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(`${directory}/${name}`, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = (await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name])).rows[0];
    if (previous) {
      if (previous.checksum !== checksum) throw new Error(`Applied migration ${name} was modified. Add a new migration instead.`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(1698516000)');
  client.release();
  await db.end();
}
