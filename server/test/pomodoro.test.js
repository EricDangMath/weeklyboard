import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mergeRanges, summarizePomodoros } from '../pomodoro.js';

test('pomodoro counts use 30 minutes, exact boxes, overlap union and unchanged targets', () => {
  const tasks = [{ id: 1, title: 'Math', estimate_minutes: 60 }];
  const events = [
    { id: 1, task_id: 1, title: 'Math', day: '周一', start_minute: 540, end_minute: 600, layer: 'flex' },
    { id: 2, task_id: 1, title: 'Different title', day: '周一', start_minute: 540, end_minute: 570, layer: 'actual' },
    { id: 3, task_id: 1, title: 'Overlap', day: '周一', start_minute: 550, end_minute: 565, layer: 'actual' },
  ];
  let result = summarizePomodoros(tasks, events);
  assert.equal(result.rows[0].plan_units, 2);
  assert.equal(result.rows[0].actual_units, 1);
  assert.equal(result.rows[0].daily[0].boxes, 2);
  assert.equal(result.rows[0].daily[1].boxes, 0);
  events.push({ id: 4, task_id: 1, day: '周一', start_minute: 570, end_minute: 630, layer: 'actual' });
  result = summarizePomodoros(tasks, events, { 'task:1': 2 });
  assert.equal(result.rows[0].plan_units, 2);
  assert.equal(result.rows[0].actual_units, 3);
  assert.equal(result.rows[0].percent, 150);
  assert.equal(result.rows[0].daily[0].boxes, 3);
  assert.equal(result.rows[0].complete, true);
  assert.deepEqual(mergeRanges([[30, 60], [10, 40], [80, 100]]), [[10, 60], [80, 100]]);
});

test('partial actual time stays integer and ambiguous names do not mix projects', () => {
  const tasks = [{ id: 1, title: 'Reading', estimate_minutes: 60 }, { id: 2, title: 'Reading', estimate_minutes: 30 }];
  const result = summarizePomodoros(tasks, [{ id: 1, title: 'Reading', day: '周二', start_minute: 540, end_minute: 585, layer: 'actual', category: 'study' }]);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].actual_units, 0);
  assert.equal(result.rows[1].actual_units, 0);
  assert.equal(result.rows[2].actual_units, 1);
  assert.equal(result.rows[2].daily[1].boxes, 2);
  assert.equal(result.total.actual_units, 1);
});

test('pomodoro API synchronizes actual calendar, cancellation, plans, settings and backup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-pomodoro-'));
  const child = spawn(process.execPath, [resolve('server/index.js')], {
    env: { ...process.env, DB_FILE: join(directory, 'test.db'), PORT: '0', JWT_SECRET: randomBytes(32).toString('hex'), DEBUG_MODE: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  try {
    const port = await new Promise((resolvePort, reject) => {
      const timer = setTimeout(() => reject(new Error(output || 'startup timeout')), 10000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/weeklyboard api listening (\d+)/);
        if (match) { clearTimeout(timer); resolvePort(Number(match[1])); }
      });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(output)); });
    });
    const base = `http://127.0.0.1:${port}/api`;
    const session = await (await fetch(`${base}/auth/debug`)).json();
    const request = async (path, method = 'GET', body, expected = 200, token = session.token) => {
      const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json().catch(() => null);
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
      return result;
    };
    const week = '2026-W37';
    const task = await request(`/projects/${session.demo.projectId}/tasks`, 'POST', { title: 'Pomodoro integration', estimate_minutes: 60 }, 201);
    const key = `task:${task.id}`;
    const row = (data) => data.rows.find((item) => item.key === key);
    const get = () => request(`/pomodoro?week_key=${week}`);
    const action = (name, body, expected = 200) => request(`/pomodoro/${name}`, 'PUT', { week_key: week, group_key: key, ...body }, expected);
    const plan = await request('/calendar/events', 'POST', { title: task.title, task_id: task.id, day: '周一', start_minute: 540, end_minute: 600, layer: 'flex', week_key: week, category: 'study' }, 201);
    assert.equal(plan.task_id, task.id);
    assert.equal(row(await get()).daily[0].boxes, 2);
    assert.equal(row(await get()).daily[1].boxes, 0);
    assert.equal(row(await action('plan', { units: 4 })).pending_units, 2);
    await action('plan', { units: 1 }, 400);
    await action('plan', { units: 2.5 }, 400);
    await action('plan', { units: -1 }, 400);

    let data = await action('check', { day: '周一', expected_minutes: 0, target_minutes: 30 });
    assert.equal(row(data).actual_units, 1);
    let calendar = await request('/calendar');
    const created = calendar.filter((event) => event.source === 'pomodoro');
    assert.equal(created.length, 1);
    assert.equal(created[0].start_minute, 540);
    assert.equal(created[0].end_minute, 570);
    await action('check', { day: '周一', expected_minutes: 0, target_minutes: 30 });
    assert.equal((await request('/calendar')).length, calendar.length, 'retry must not duplicate records');
    await action('check', { day: '周一', expected_minutes: 0, target_minutes: 60 }, 409);
    data = await action('check', { day: '周一', expected_minutes: 30, target_minutes: 60 });
    assert.equal(row(data).daily[0].boxes, 2, 'two planned boxes do not become three');
    assert.equal(row(data).actual_units, 2);
    data = await action('plan', { units: 2 });
    assert.equal(row(data).percent, 100);
    assert.equal(row(data).complete, true);

    const actual = await request('/calendar/events', 'POST', { title: 'Actual renamed', task_id: task.id, day: '周二', start_minute: 600, end_minute: 660, layer: 'actual', week_key: week, category: 'study' }, 201);
    data = await get();
    assert.equal(row(data).actual_units, 4);
    assert.equal(row(data).plan_units, 2);
    assert.equal(row(data).percent, 200);
    await request(`/calendar/events/${actual.id}`, 'PATCH', { end_minute: 640 });
    assert.equal(row(await get()).actual_minutes, 100);
    await request(`/calendar/events/${actual.id}`, 'DELETE', null, 204);
    assert.equal(row(await get()).actual_units, 2);

    data = await action('check', { day: '周一', expected_minutes: 60, target_minutes: 0 });
    assert.equal(row(data).actual_units, 0);
    assert.equal(row(data).daily[0].boxes, 2);
    assert.equal((await request('/calendar')).some((event) => event.id === plan.id), true, 'cancel preserves plan');
    data = await action('complete', { day: '周日', completed: true });
    assert.equal(row(data).actual_units, 2);
    assert.equal(row(data).daily[0].actual_units, 2, 'completion uses scheduled day first');
    assert.equal(row(await request('/pomodoro?week_key=2026-W38')).actual_units, 0);
    assert.equal(row(await request('/pomodoro?week_key=2026-W38')).daily[0].boxes, 0);

    calendar = await request('/calendar');
    await request('/pomodoro/settings', 'PUT', { enabled: false });
    assert.equal((await get()).enabled, false);
    assert.deepEqual(await request('/calendar'), calendar, 'switch does not erase time');
    await request('/pomodoro/settings', 'PUT', { enabled: 'false' }, 400);
    const backup = await request('/backup');
    assert.ok(backup.tables.calendar_events.some((event) => event.task_id === task.id));
    await action('complete', { day: '周日', completed: false });
    assert.equal(row(await get()).actual_units, 0);
    await request('/backup/restore', 'POST', { backup });
    data = await get();
    assert.equal(row(data).actual_units, 2);
    assert.equal(row(data).plan_units, 2);
    assert.equal(data.enabled, false);
    await request('/pomodoro/settings', 'PUT', { enabled: true });
    assert.equal(row(await get()).daily[0].boxes, 2);

    await request(`/calendar/events/${plan.id}`, 'PATCH', { repeat: true });
    assert.equal(row(await request('/pomodoro?week_key=2026-W38')).daily[0].boxes, 2);
    await request(`/calendar/events/${plan.id}`, 'PATCH', { repeat: false });
    assert.equal(row(await request('/pomodoro?week_key=2026-W38')).daily[0].boxes, 0);
    const legacy = await request('/calendar/events', 'POST', { title: task.title, task_id: task.id, day: '周二', start_minute: 540, end_minute: 570, layer: 'actual', week_key: null }, 201);
    await action('check', { day: '周二', expected_minutes: 30, target_minutes: 0 }, 409);
    await request(`/calendar/events/${legacy.id}`, 'PATCH', { week_key: week, repeat: false });
    await action('check', { day: '周二', expected_minutes: 30, target_minutes: 0 });
    assert.equal(row(await get()).actual_units, 2);

    const stranger = await request('/auth/register', 'POST', { email: 'other@example.test', password: 'isolated-test-password' }, 201);
    const isolated = await request(`/pomodoro?week_key=${week}`, 'GET', null, 200, stranger.token);
    assert.equal(isolated.rows.length, 0);
    await request('/pomodoro/check', 'PUT', { week_key: week, group_key: key, day: '周一', expected_minutes: 60, target_minutes: 0 }, 404, stranger.token);
    await request('/calendar/events', 'POST', { title: 'invalid association', task_id: task.id, day: '周一', start_minute: 540, end_minute: 570, layer: 'actual', week_key: week }, 400, stranger.token);
    assert.equal(row(await get()).actual_units, 2);
  } finally {
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
