import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

test('confirmation persists atomically and handles retries and invalid drafts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-test-'));
  const database = join(directory, 'test.sqlite');
  // Port zero asks the OS to allocate a free local port.
  const child = spawn(process.execPath, [resolve('server/index.js')], {
    env: { ...process.env, DB_FILE: database, PORT: '0', JWT_SECRET: randomBytes(32).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = once(child, 'exit');
  let db;
  try {
    const port = await new Promise((resolvePort, reject) => {
      const timeout = setTimeout(() => reject(new Error('API startup timeout: ' + output)), 10000);
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/weeklyboard api listening (\d+)/);
        if (match) { clearTimeout(timeout); resolvePort(Number(match[1])); }
      });
      child.stderr.on('data', chunk => { output += chunk; });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(output)); });
    });
    let token;
    async function request(path, body) {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }
    const registration = await request('/auth/register', { email: 'test@example.test', password: randomBytes(18).toString('hex') });
    assert.equal(registration.status, 201);
    token = registration.body.token;
    const project = await request('/projects', { title: 'Confirmation integration test' });
    const draft = { project_id: project.body.id, request_key: randomUUID(), week_key: '2026-W37', summary: 'Two tasks', blocks: [
      { title: 'First', day: '周一', start_minute: 540, end_minute: 600, category: 'study', description: 'deep work' },
      { title: 'Second', day: '周一', start_minute: 615, end_minute: 645, category: 'work', description: 'follow-up' },
    ] };
    assert.equal((await request('/plan/confirm', draft)).status, 201);
    const replay = await request('/plan/confirm', draft);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal((await request('/calendar')).body.length, 2);
    const savedBlocks = (await request('/calendar')).body;
    assert.deepEqual(savedBlocks.map((block) => block.week_key), ['2026-W37', '2026-W37']);
    assert.deepEqual(savedBlocks.map((block) => block.category), ['study', 'work']);
    assert.deepEqual(savedBlocks.map((block) => block.description), ['deep work', 'follow-up']);
    const conflict = await request('/plan/confirm', { ...draft, request_key: randomUUID() });
    assert.equal(conflict.status, 409);
    const nextWeek = await request('/plan/confirm', { ...draft, request_key: randomUUID(), week_key: '2026-W38' });
    assert.equal(nextWeek.status, 201);
    assert.equal((await request('/calendar')).body.length, 4);
    const invalid = await request('/plan/confirm', { ...draft, request_key: randomUUID(), blocks: [
      { title: 'Invalid', day: '周二', start_minute: 600, end_minute: 500 },
    ] });
    assert.equal(invalid.status, 400);
    db = new Database(database);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plan_runs').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n, 4);
    // Exercise an actual storage failure after the plan-run insert.
    db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON calendar_events WHEN NEW.title='storage-failure' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    const response = await fetch(`http://127.0.0.1:${port}/api/plan/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...draft, request_key: randomUUID(), blocks: [
        { title: 'storage-failure', day: '周二', start_minute: 540, end_minute: 600 },
      ] }),
    });
    assert.equal(response.status, 500);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plan_runs').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n, 4);
  } finally {
    db?.close();
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
