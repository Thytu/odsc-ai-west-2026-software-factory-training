import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = resolve(root, '.data/dev.lock');
try {
  const pid = Number(await readFile(lock, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('The checkout has an invalid runtime lock.');
  try { process.kill(pid, 0); }
  catch (error) {
    if (error.code !== 'ESRCH') throw error;
    console.log('Eventdesk is already stopped.');
    process.exit(0);
  }
  await writeFile(resolve(root, '.data/stop.json'), JSON.stringify({ pid }), { mode: 0o600 });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const current = Number(await readFile(lock, 'utf8'));
      if (current !== pid) throw new Error('A different Eventdesk runtime started while this checkout was stopping.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      console.log('Eventdesk stopped its frontend, API, worker, and database.');
      process.exit(0);
    }
    await new Promise(done => setTimeout(done, 150));
  }
  throw new Error('This checkout has not finished stopping. Inspect its development terminal and .data/postgres.log.');
} catch (error) {
  if (error.code === 'ENOENT') console.log('Eventdesk is already stopped.');
  else { console.error(error.message); process.exitCode = 1; }
}
