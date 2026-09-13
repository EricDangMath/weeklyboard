import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import Database from 'better-sqlite3';

test('debug mode creates an SQL-backed workspace without registration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-debug-'));
  const database = join(directory, 'debug.sqlite');
  const child = spawn(process.execPath, [resolve('server/index.js')], {
    env: {
      ...process.env,
      DEBUG_MODE: 'true',
      DB_FILE: database,
      PORT: '0',
      JWT_SECRET: randomBytes(32).toString('hex'),
    },
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
    const base = `http://127.0.0.1:${port}/api`;
    const debug = await fetch(`${base}/auth/debug`);
    assert.equal(debug.status, 200);
    const session = await debug.json();
    assert.equal(session.debugMode, true);
    assert.equal(session.user.email, 'debug@weeklyboard.local');

    const projects = await fetch(`${base}/projects`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    assert.equal(projects.status, 200);
    const rows = await projects.json();
    assert.equal(rows.length, 1);

    const tasks = await fetch(`${base}/projects/${rows[0].id}/tasks`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    assert.equal((await tasks.json()).length, 3);

    const second = await (await fetch(`${base}/auth/debug`)).json();
    assert.equal(second.user.id, session.user.id);
    db = new Database(database, { readonly: true });
    const user = db.prepare('SELECT email, password_hash FROM users WHERE id=?').get(session.user.id);
    assert.equal(user.email, 'debug@weeklyboard.local');
    assert.ok(user.password_hash.length >= 50);
    assert.notEqual(user.password_hash, 'debug');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id=?').get(session.user.id).count, 1);
  } finally {
    db?.close();
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
