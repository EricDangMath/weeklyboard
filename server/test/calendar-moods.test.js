import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MOODS, validMoodDate, moodDays, moodTrend, localDateKey } from '../../src/mood-data.mjs';

test('reference moods and 28-day trends use local calendar dates, deduplicate days and exclude future/outside dates', () => {
  assert.equal(MOODS.length, 12);
  assert.equal(validMoodDate('2028-02-29'), true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-10-25T00:00:00Z', null, ['2026-10-25']]) assert.equal(validMoodDate(date), false);
  assert.equal(localDateKey(new Date(2026, 9, 25, 23, 59)), '2026-10-25');
  const dates = moodDays('2026-11-03');
  assert.equal(dates.length, 28);
  assert.equal(dates[0], '2026-10-07');
  assert.equal(dates.at(-1), '2026-11-03');
  const result = moodTrend([
    { date: '2026-10-06', mood: 'angry' }, { date: '2026-10-07', mood: 'happy' },
    { date: '2026-11-01', mood: 'sad' }, { date: '2026-11-01', mood: 'calm' },
    { date: '2026-11-03', mood: 'calm' }, { date: '2026-11-04', mood: 'great' },
  ], '2026-11-03');
  assert.equal(result.recorded, 3);
  assert.deepEqual(result.top.map(({ id, count }) => ({ id, count })), [{ id: 'calm', count: 2 }, { id: 'happy', count: 1 }]);
  assert.equal(result.days.find((day) => day.date === '2026-11-01').mood.id, 'calm');
});

test('mood API persists unique daily check-ins, moves atomically, isolates accounts and round-trips SQL backups', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-moods-'));
  const env = { ...process.env, DB_FILE: join(directory, 'test.sqlite'), PORT: '0', DEBUG_MODE: 'true', JWT_SECRET: randomBytes(32).toString('hex') };
  let child, exited;
  const start = async () => {
    child = spawn(process.execPath, [resolve('server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    exited = once(child, 'exit');
    const port = await new Promise((resolvePort, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`API startup timeout: ${output}`)), 10000);
      child.stdout.on('data', (chunk) => { output += chunk; const match = output.match(/weeklyboard api listening (\d+)/); if (match) { clearTimeout(timer); resolvePort(match[1]); } });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`API exited: ${output}`)); });
    });
    return `http://127.0.0.1:${port}/api`;
  };
  try {
    let base = await start();
    const session = await (await fetch(`${base}/auth/debug`)).json();
    const request = async (path, method = 'GET', body, status = 200, token = session.token) => {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.status, status, `${method} ${path}`);
      return response.json().catch(() => null);
    };
    const range = '/calendar/moods?from=2026-10-01&to=2026-11-30';
    const event = await request('/calendar/events', 'POST', { title: 'Unrelated event', day: '周一', start_minute: 540, end_minute: 600, week_key: '2026-W43', layer: 'once' }, 201);
    await request(range, 'GET', null, 401, '');
    for (const query of ['', '?from=2026-02-30&to=2026-11-30', '?from=2026-11-01&to=2026-10-01', '?from=2024-01-01&to=2026-10-01']) await request(`/calendar/moods${query}`, 'GET', null, 400);
    for (const mood of ['invalid', '__proto__', 'constructor', null]) await request('/calendar/moods/2026-10-25', 'PUT', { mood }, 400);
    await request('/calendar/moods/2026-02-30', 'PUT', { mood: 'happy' }, 400);
    await request('/calendar/moods/2026-10-25', 'PUT', { mood: 'happy', from_date: 'bad' }, 400);
    await request('/calendar/moods/2026-10-25', 'PUT', { mood: 'happy' });
    await request('/calendar/moods/2026-10-25', 'PUT', { mood: 'calm' });
    assert.deepEqual(await request(range), [{ date: '2026-10-25', mood: 'calm' }]);
    await request('/calendar/moods/2026-11-01', 'PUT', { mood: 'sad' });
    await request('/calendar/moods/2026-11-01', 'PUT', { mood: 'calm', from_date: '2026-10-25' });
    assert.deepEqual(await request(range), [{ date: '2026-11-01', mood: 'calm' }]);
    await request('/calendar/moods/2026-10-25', 'PUT', { mood: 'calm', from_date: '2026-10-25' });
    await request('/calendar/moods/2026-11-01', 'PUT', { mood: 'happy', from_date: '2026-10-25' }, 409);
    assert.deepEqual(await request(range), [{ date: '2026-10-25', mood: 'calm' }, { date: '2026-11-01', mood: 'calm' }]);
    const other = await request('/auth/register', 'POST', { email: 'mood-other@example.test', password: 'test-password-123' }, 201);
    assert.deepEqual(await request(range, 'GET', null, 200, other.token), []);
    await request('/calendar/moods/2026-10-25', 'DELETE', null, 204, other.token);
    await request('/calendar/moods/2026-11-02', 'PUT', { mood: 'calm', from_date: '2026-10-25' }, 409, other.token);
    await request('/calendar/moods/2026-10-25', 'PUT', { mood: 'great' }, 200, other.token);
    assert.equal((await request(range))[0].mood, 'calm');
    const backup = await request('/backup');
    assert.equal(backup.tables.workspace_scratch.filter((item) => item.kind === 'mood').length, 2);
    assert.deepEqual(await request('/calendar/moods?from=2026-11-01&to=2026-11-30'), [{ date: '2026-11-01', mood: 'calm' }]);
    child.kill(); await exited;
    base = await start();
    assert.equal((await request(range)).length, 2);
    await request('/calendar/moods/2026-10-25', 'DELETE', null, 204);
    await request('/calendar/moods/2026-10-25', 'DELETE', null, 204);
    assert.equal((await request(range)).length, 1);
    await request('/backup/restore', 'POST', { backup });
    assert.equal((await request(range)).length, 2);
    assert.deepEqual(await request(range, 'GET', null, 200, other.token), [{ date: '2026-10-25', mood: 'great' }]);
    assert.ok((await request('/calendar')).some((item) => item.id === event.id && item.title === event.title), 'unrelated calendar events remain intact');
  } finally {
    child?.kill();
    if (exited) await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
