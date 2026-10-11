import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { excludedWeeks, occursInWeek } from '../../src/calendar-occurrences.mjs';
import { parseCalendar } from '../calendar-feed.js';

test('weekly exceptions hide only the selected week and survive encoded storage', () => {
  const event = { week_key: '2026-W41', repeat_rule: 'weekly', layer: 'once', excluded_weeks: '["2026-W42","bad","2026-W42"]' };
  assert.deepEqual(excludedWeeks(event), ['2026-W42']);
  assert.equal(occursInWeek(event, '2026-W41'), true);
  assert.equal(occursInWeek(event, '2026-W42'), false);
  assert.equal(occursInWeek(event, '2026-W43'), true);
  assert.equal(occursInWeek({ ...event, repeat_rule: null }, '2026-W43'), false);
  assert.equal(occursInWeek({ ...event, layer: 'actual' }, '2026-W43'), false);
  assert.deepEqual(excludedWeeks({ excluded_weeks: '{invalid' }), []);
});

test('week-only deletion persists, updates stats and subscribed ICS, restores from backup and leaves other weeks intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-occurrences-'));
  const database = join(directory, 'test.sqlite');
  const env = { ...process.env, DB_FILE: database, PORT: '0', DEBUG_MODE: 'true', JWT_SECRET: randomBytes(32).toString('hex'), PUBLIC_CALENDAR_BASE_URL: '' };
  let child, exited;
  const start = async () => {
    child = spawn(process.execPath, [resolve('server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    exited = once(child, 'exit');
    const port = await new Promise((resolvePort, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('API startup timeout')), 10000);
      child.stdout.on('data', (chunk) => { output += chunk; const match = output.match(/weeklyboard api listening (\d+)/); if (match) { clearTimeout(timer); resolvePort(match[1]); } });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('API exited')); });
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
    const task = await request(`/projects/${session.demo.projectId}/tasks`, 'POST', { title: 'Weekly deletion integration', estimate_minutes: 60 }, 201);
    const recurring = await request('/calendar/events', 'POST', { title: task.title, task_id: task.id, day: '周一', start_minute: 540, end_minute: 600, layer: 'once', week_key: '2026-W41', repeat: true }, 201);
    const row = (data) => data.rows.find((item) => item.task_id === task.id);
    assert.equal(row(await request('/pomodoro?week_key=2026-W42')).daily[0].planned_units, 2);
    await request(`/calendar/events/${recurring.id}?scope=week`, 'DELETE', null, 400);
    await request(`/calendar/events/${recurring.id}?scope=week&week_key=bad`, 'DELETE', null, 400);
    const other = await request('/auth/register', 'POST', { email: 'occurrence-other@example.test', password: 'test-password-123' }, 201);
    await request(`/calendar/events/${recurring.id}?scope=week&week_key=2026-W42`, 'DELETE', null, 404, other.token);
    const deleted = await request(`/calendar/events/${recurring.id}?scope=week&week_key=2026-W42`, 'DELETE');
    assert.equal(deleted.event.repeat_rule, 'weekly');
    assert.equal(deleted.event.week_key, '2026-W41');
    assert.deepEqual(excludedWeeks(deleted.event), ['2026-W42']);
    assert.equal(row(await request('/pomodoro?week_key=2026-W42')).daily[0].planned_units, 0);
    assert.equal(row(await request('/pomodoro?week_key=2026-W43')).daily[0].planned_units, 2);
    const retry = await request(`/calendar/events/${recurring.id}?scope=week&week_key=2026-W42`, 'DELETE');
    assert.deepEqual(excludedWeeks(retry.event), ['2026-W42']);
    const publication = await request('/calendar/publish', 'PUT', { title: 'Test', timezone: 'America/New_York', layers: ['once'], include_deadlines: false });
    const ics = await (await fetch(base + publication.path)).text();
    assert.match(ics, /EXDATE;TZID=America\/New_York:20261012T090000/);
    const imported = await parseCalendar(ics, { timezone: 'America/New_York', now: '2026-10-05T00:00:00Z' });
    const dates = imported.blocks.filter((item) => item.title === task.title);
    assert.ok(dates.some((item) => item.week_key === '2026-W41'));
    assert.ok(!dates.some((item) => item.week_key === '2026-W42'));
    assert.ok(dates.some((item) => item.week_key === '2026-W43'));
    const backup = await request('/backup');
    child.kill(); await exited;
    base = await start();
    assert.deepEqual(excludedWeeks((await request('/calendar')).find((item) => item.id === recurring.id)), ['2026-W42']);
    await request('/backup/restore', 'POST', backup);
    assert.equal(row(await request('/pomodoro?week_key=2026-W42')).daily[0].planned_units, 0);
    assert.equal(row(await request('/pomodoro?week_key=2026-W43')).daily[0].planned_units, 2);
    const once = await request('/calendar/events', 'POST', { title: 'Once only', day: '周一', start_minute: 600, end_minute: 630, week_key: '2026-W42' }, 201);
    await request(`/calendar/events/${once.id}?scope=week&week_key=2026-W43`, 'DELETE', null, 404);
    await request(`/calendar/events/${once.id}?scope=week&week_key=2026-W42`, 'DELETE', null, 204);
    await request(`/calendar/events/${recurring.id}?scope=all`, 'DELETE', null, 204);
    assert.ok(!(await request('/calendar')).some((item) => item.id === recurring.id));
  } finally {
    child?.kill(); if (exited) await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
