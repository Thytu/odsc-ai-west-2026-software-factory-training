import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { databasePath } from '@eventdesk/data';

for (const suffix of ['', '-wal', '-shm']) rmSync(`${databasePath}${suffix}`, { force: true });
execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['seed'], { stdio: 'inherit' });
