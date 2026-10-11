import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { get } from 'node:https';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const environment = JSON.parse(await readFile(resolve(root, '.data/runtime.json'), 'utf8'));
  process.kill(environment.pid, 0);
  const ca = await readFile(resolve(process.env.PORTLESS_STATE_DIR ?? resolve(homedir(), '.portless'), 'ca.pem'));
  await new Promise((done, reject) => {
    const request = get(`${environment.api}/health`, { ca, timeout: 3000 }, response => {
      response.resume();
      response.once('end', () => response.statusCode === 200 ? done() : reject(new Error('The API is unavailable.')));
    });
    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error('The API did not respond.')));
  });
  console.log(JSON.stringify(environment, null, 2));
} catch {
  console.error('This checkout is not ready. Start it with pnpm dev.');
  process.exitCode = 1;
}
