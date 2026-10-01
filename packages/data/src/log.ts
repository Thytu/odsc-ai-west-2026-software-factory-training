import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { localDataPath } from './paths';

const logPath = process.env.EVENTDESK_LOG_PATH ?? localDataPath('events.jsonl');

export function recordEvent(component: string, event: string, fields: Record<string, unknown> = {}) {
  const entry = {
    at: new Date().toISOString(),
    component,
    event,
    deploy: process.env.DEPLOY_VERSION ?? 'local',
    ...fields,
  };
  const line = JSON.stringify(entry);
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${line}\n`);
  process.stdout.write(`${line}\n`);
}
