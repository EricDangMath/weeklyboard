import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(root, '.local-run');
const stateFile = resolve(runtime, 'services.json');
const url = 'http://127.0.0.1:4173/';
const services = [
  { name: 'api', entry: resolve(root, 'server/index.js'), args: [], port: 8787, health: 'http://127.0.0.1:8787/api/health' },
  { name: 'website', entry: resolve(root, 'node_modules/vite/bin/vite.js'), args: ['preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], port: 4173, health: url },
];
mkdirSync(runtime, { recursive: true });
let state = {};
try { state = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* First start has no state file. */ }
const saveState = () => writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function owned(service) {
  const pid = state[service.name];
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    return command.includes(service.entry) && command.includes(process.execPath);
  } catch { return false; }
}

async function healthy(service) {
  try {
    const response = await fetch(service.health, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    return service.name !== 'api' || (await response.json()).service === 'weeklyboard-api';
  } catch { return false; }
}

async function available(port) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is in use. No existing service was stopped.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function stop(service) {
  if (owned(service)) {
    process.kill(state[service.name], 'SIGTERM');
    for (let i = 0; i < 50 && owned(service); i++) await sleep(100);
    if (owned(service)) throw new Error(`${service.name} did not stop; inspect .local-run/${service.name}.log.`);
  }
  delete state[service.name];
  saveState();
}

function configure() {
  const envPath = resolve(root, 'server/.env');
  if (!existsSync(envPath)) {
    writeFileSync(envPath, [
      'DEEPSEEK_API_KEY=',
      'DEBUG_MODE=true',
      `JWT_SECRET=${randomBytes(48).toString('hex')}`,
      'PORT=8787',
      'DB_FILE=./weeklyboard.db',
      '',
    ].join('\n'), { mode: 0o600, flag: 'wx' });
  }
}

async function start() {
  if (!existsSync(resolve(root, 'dist/index.html'))) throw new Error('Missing build: run the build command in LOCAL.md first.');
  configure();
  const pending = [];
  for (const service of services) {
    if (owned(service)) {
      if (!(await healthy(service))) throw new Error(`${service.name} is running but not healthy. Stop it with stop.command, then retry.`);
    } else {
      await available(service.port);
      pending.push(service);
    }
  }
  const started = [];
  try {
    for (const service of pending) {
      const output = openSync(resolve(runtime, `${service.name}.log`), 'a', 0o600);
      const child = spawn(process.execPath, [service.entry, ...service.args], {
        cwd: root,
        detached: true,
        stdio: ['ignore', output, output],
        env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH || '/usr/bin:/bin'}`, PORT: '8787' },
      });
      closeSync(output);
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      state[service.name] = child.pid;
      saveState();
      started.push(service);
      child.unref();
      let ready = false;
      for (let i = 0; i < 60; i++) {
        if (await healthy(service)) { ready = true; break; }
        if (!owned(service)) break;
        await sleep(250);
      }
      if (!ready) throw new Error(`${service.name} could not start. See .local-run/${service.name}.log.`);
    }
  } catch (error) {
    for (const service of started.reverse()) await stop(service);
    throw error;
  }
  console.log(`Weeklyboard is ready: ${url}`);
  console.log('Runs locally in the background. Stop with stop.command. Your database is kept.');
  if (process.argv.includes('--open')) execFileSync('/usr/bin/open', [url]);
}

try {
  switch (process.argv[2] || 'start') {
    case 'start': await start(); break;
    case 'stop':
      for (const service of [...services].reverse()) await stop(service);
      console.log('Weeklyboard stopped. Database and settings are unchanged.');
      break;
    case 'status':
      for (const service of services) console.log(`${service.name}: ${owned(service) && await healthy(service) ? 'running' : 'stopped / unavailable'}`);
      break;
    default: throw new Error('Usage: local.mjs start [--open] | stop | status');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
