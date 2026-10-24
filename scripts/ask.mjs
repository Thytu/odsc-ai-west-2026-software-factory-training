// Ask a coding agent one question about this repository, then show what it read to answer.
// Usage: pnpm ask <codex|claude> "<prompt>" [extra agent arguments]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [agent, prompt, ...extra] = process.argv.slice(2);
if (!['codex', 'claude'].includes(agent) || !prompt) {
  console.error('Usage: pnpm ask <codex|claude> "<prompt>"');
  process.exit(2);
}

// The agent may read and search, but not change anything.
const readCommands = ['ls', 'find', 'cat', 'head', 'tail', 'sed -n', 'rg', 'grep', 'wc', 'git log', 'git show', 'git status', 'git diff'];
const args = agent === 'codex'
  ? ['exec', '--json', '--sandbox', 'read-only', ...extra, '-']
  : ['-p', '--output-format', 'stream-json', '--verbose', '--allowedTools', ['Read', 'Glob', 'Grep', ...readCommands.map((c) => `Bash(${c}:*)`)].join(','), ...extra];

const root = process.cwd() + '/';
const docs = /docs\/product\.md|docs\/architecture/;
const width = Math.max(60, (process.stdout.columns || 100) - 14);
let steps = 0;
let characters = 0;
let usedDocs = false;
let answer = '';

function show(label, output) {
  steps += 1;
  characters += output.length;
  usedDocs ||= docs.test(label);
  const text = label.replaceAll(root, '').replace(/\s+/g, ' ');
  console.log(`${String(steps).padStart(3)}  ${text.length > width ? text.slice(0, width - 1) + '…' : text.padEnd(width)}  ${(output.length / 1000).toFixed(1).padStart(5)}k`);
}

// Codex runs every read as a shell command; drop the shell wrapper so the command itself shows.
const unwrap = (command) => command.replace(/^\S*(?:bash|zsh|sh|pwsh|powershell)(?:\.exe)?\s+(?:-lc|-c|-Command)\s+/, '').replace(/^(['"])(.*)\1$/s, '$2');

function describe(name, input) {
  if (name === 'Read') return `read ${input.file_path}`;
  if (name === 'Grep') return `search "${input.pattern}"${input.path ? ` in ${input.path}` : ''}`;
  if (name === 'Glob') return `list ${input.pattern}`;
  if (name === 'Bash') return input.command;
  return name;
}

const pending = new Map();
function handle(event) {
  if (agent === 'codex') {
    const item = event.item;
    if (event.type !== 'item.completed' || !item) return;
    if (item.type === 'command_execution') show(unwrap(item.command), item.aggregated_output ?? '');
    else if (item.type === 'agent_message') answer = item.text;
    else if (!['reasoning', 'todo_list'].includes(item.type)) show(item.type, '');
    return;
  }
  for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
    if (block.type === 'tool_use') pending.set(block.id, describe(block.name, block.input ?? {}));
    if (block.type === 'tool_result') {
      const output = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
      show(pending.get(block.tool_use_id) ?? 'tool', output);
    }
  }
  if (event.type === 'result') answer = event.result ?? '';
}

console.log(`Asking ${agent}…\n`);
// Windows starts the agent through cmd.exe, which splits unquoted arguments at spaces.
const windows = process.platform === 'win32';
const child = spawn(agent, windows ? args.map((a) => `"${a}"`) : args, { stdio: ['pipe', 'pipe', 'inherit'], shell: windows });
child.on('error', (error) => {
  console.error(`Could not start ${agent}: ${error.message}. Is it installed and signed in?`);
  process.exit(1);
});
const exited = new Promise((done) => child.on('close', done));
child.stdin.end(prompt);
for await (const line of createInterface({ input: child.stdout })) {
  try { handle(JSON.parse(line)); } catch { /* not an event line */ }
}
const code = await exited;
console.log(`\n${answer.trim()}\n`);
console.log(`${steps} steps · ${Math.round(characters / 1000)}k characters read · project docs used: ${usedDocs ? 'yes' : 'no'}`);
process.exit(code ?? 1);
