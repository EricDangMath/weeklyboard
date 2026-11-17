import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';

async function startServer(database, debug = true) {
  const child = spawn(process.execPath, [resolve('server/index.js')], {
    env: {
      ...process.env,
      DEBUG_MODE: String(debug),
      DB_FILE: database,
      PORT: '0',
      JWT_SECRET: randomBytes(32).toString('hex'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = once(child, 'exit');
  const port = await new Promise((resolvePort, reject) => {
    const timeout = setTimeout(() => reject(new Error('API startup timeout: ' + output)), 10000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/weeklyboard api listening (\d+)/);
      if (match) { clearTimeout(timeout); resolvePort(Number(match[1])); }
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(output)); });
  });
  return { child, exited, base: `http://127.0.0.1:${port}/api` };
}

test('scratch writes are idempotent and SQL backup round-trips', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-storage-'));
  const database = join(directory, 'storage.sqlite');
  const server = await startServer(database);
  try {
    const debug = await (await fetch(`${server.base}/auth/debug`)).json();
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${debug.token}` };
    const payload = { id: 'inbox-storage-test', text: 'first' };
    const first = await fetch(`${server.base}/workspace/scratch`, { method: 'PUT', headers, body: JSON.stringify({ kind: 'inbox', week_key: '2026-W37', entity_key: payload.id, payload }) });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    const second = await fetch(`${server.base}/workspace/scratch`, { method: 'PUT', headers, body: JSON.stringify({ kind: 'inbox', week_key: '2026-W37', entity_key: payload.id, payload: { ...payload, text: 'updated' } }) });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.id, firstBody.id);
    const rows = await (await fetch(`${server.base}/workspace/scratch?week_key=2026-W37`, { headers })).json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.text, 'updated');

    const backupResponse = await fetch(`${server.base}/backup`, { headers });
    assert.equal(backupResponse.status, 200);
    const backup = await backupResponse.json();
    assert.equal(backup.schemaVersion, 3);
    assert.ok(/^[a-f0-9]{64}$/.test(backup.sha256));
    assert.equal(backup.tables.workspace_scratch.length, 1);

    const extra = await fetch(`${server.base}/projects`, { method: 'POST', headers, body: JSON.stringify({ title: '临时项目' }) });
    assert.equal(extra.status, 201);
    const restore = await fetch(`${server.base}/backup/restore`, { method: 'POST', headers, body: JSON.stringify({ backup }) });
    assert.equal(restore.status, 200);
    const projects = await (await fetch(`${server.base}/projects`, { headers })).json();
    assert.equal(projects.some((project) => project.title === '临时项目'), false);
    const restoredScratch = await (await fetch(`${server.base}/workspace/scratch?week_key=2026-W37`, { headers })).json();
    assert.equal(restoredScratch.length, 1);

    const tampered = structuredClone(backup);
    tampered.tables.projects[0].title = '被篡改的数据';
    const rejected = await fetch(`${server.base}/backup/restore`, { method: 'POST', headers, body: JSON.stringify({ backup: tampered }) });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /checksum/i);
    const projectsAfterReject = await (await fetch(`${server.base}/projects`, { headers })).json();
    assert.equal(projectsAfterReject[0].title, backup.tables.projects[0].title);

    const deleted = await fetch(`${server.base}/workspace/scratch?kind=inbox&week_key=2026-W37&entity_key=${encodeURIComponent(payload.id)}`, { method: 'DELETE', headers });
    assert.equal(deleted.status, 204);
  } finally {
    server.child.kill();
    await server.exited;
    await rm(directory, { recursive: true, force: true });
  }
});
