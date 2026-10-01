import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function localDataPath(filename: string) {
  let directory = process.cwd();
  while (!existsSync(join(directory, 'pnpm-workspace.yaml'))) {
    const parent = dirname(directory);
    if (parent === directory) return resolve(process.cwd(), '.data', filename);
    directory = parent;
  }
  return resolve(directory, '.data', filename);
}
