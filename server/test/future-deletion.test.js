import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { occursInWeek, recurrenceEndWeek } from '../../src/calendar-occurrences.mjs';
import { parseCalendar } from '../calendar-feed.js';
import { buildPublishedCalendar } from '../calendar-publish.js';

test('future deletion uses an exclusive ISO-week boundary and preserves earlier exceptions across years', () => {
  const event = { week_key: '2026-W51', repeat_rule: 'weekly', layer: 'once', ends_before_week: '2027-W01', excluded_weeks: '["2026-W52"]' };
  assert.equal(occursInWeek(event, '2026-W51'), true);
  assert.equal(occursInWeek(event, '2026-W52'), false);
  assert.equal(occursInWeek(event, '2026-W53'), true);
  assert.equal(occursInWeek(event, '2027-W01'), false);
  assert.equal(occursInWeek(event, '2028-W01'), false);
  assert.equal(occursInWeek({ ...event, week_key: null, repeat_rule: null }, '2027-W01'), false);
  assert.equal(recurrenceEndWeek({ ends_before_week: 'invalid' }), null);
});

test('subscription feeds stop timed and all-day recurrence at the cutoff, including DST and empty series', async () => {
  const profile = { layers: '["once"]', user_id: 1, title: 'Test', timezone: 'America/New_York', anchor_date: '2026-10-05', updated_at: '2026-10-01T00:00:00Z', revision: 0 };
  const event = { title: 'Timed', day: '周日', start_minute: 540, end_minute: 600, layer: 'once', week_key: '2026-W41', repeat_rule: 'weekly', ends_before_week: '2026-W45', feed_uid: 'timed' };
  const feed = buildPublishedCalendar(profile, [event, { ...event, title: 'All day', all_day: 1, feed_uid: 'all-day' }, { ...event, title: 'No occurrences', week_key: '2026-W46', feed_uid: 'empty' }]);
  assert.match(feed, /UNTIL=20261102T045959Z/);
  assert.doesNotMatch(feed, /No occurrences/);
  const parsed = await parseCalendar(feed, { timezone: 'America/New_York', now: '2026-10-26T00:00:00Z' });
  for (const title of ['Timed', 'All day']) {
    const rows = parsed.blocks.filter((item) => item.title === title);
    assert.ok(rows.some((item) => item.week_key === '2026-W44'));
    assert.ok(rows.every((item) => item.week_key < '2026-W45'));
  }
});

test('future deletion persists history, statistics and feed limits through retries, restarts and backup restore', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-future-delete-'));
  const env = { ...process.env, DB_FILE: join(directory, 'test.sqlite'), PORT: '0', DEBUG_MODE: 'true', JWT_SECRET: randomBytes(32).toString('hex'), PUBLIC_CALENDAR_BASE_URL: '' };
  let child, exited;
  const start = async () => {
    child = spawn(process.execPath, [resolve('server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    exited = once(child, 'exit');
    const port = await new Promise((resolvePort, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error(`API startup timed out: ${output}`)), 10000);
      child.stdout.on('data', (chunk) => { output += chunk; const match = output.match(/weeklyboard api listening (\d+)/); if (match) { clearTimeout(timeout); resolvePort(match[1]); } });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(output)); });
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
    const task = await request(`/projects/${session.demo.projectId}/tasks`, 'POST', { title: 'Future deletion', estimate_minutes: 60 }, 201);
    const event = await request('/calendar/events', 'POST', { title: task.title, task_id: task.id, day: '周一', start_minute: 540, end_minute: 600, layer: 'once', week_key: '2026-W41', repeat: true }, 201);
    const endpoint = `/calendar/events/${event.id}?scope=future`;
    await request(endpoint, 'DELETE', null, 400);
    await request(`${endpoint}&week_key=invalid`, 'DELETE', null, 400);
    const other = await request('/auth/register', 'POST', { email: 'future-other@example.test', password: 'test-password-123' }, 201);
    await request(`${endpoint}&week_key=2026-W45`, 'DELETE', null, 404, other.token);
    await request(`/calendar/events/${event.id}?scope=week&week_key=2026-W42`, 'DELETE');
    const cut = await request(`${endpoint}&week_key=2026-W45`, 'DELETE');
    assert.equal(cut.event.ends_before_week, '2026-W45');
    assert.equal(cut.event.repeat_rule, 'weekly');
    const units = async (week) => (await request(`/pomodoro?week_key=${week}`)).rows.find((row) => row.task_id === task.id).daily[0].planned_units;
    assert.equal(await units('2026-W43'), 2);
    assert.equal(await units('2026-W42'), 0);
    assert.equal(await units('2026-W45'), 0);
    assert.equal(await units('2027-W01'), 0);
    const retry = await request(`${endpoint}&week_key=2026-W46`, 'DELETE');
    assert.equal(retry.event.ends_before_week, '2026-W45');
    const publication = await request('/calendar/publish', 'PUT', { title: 'Future test', timezone: 'America/New_York', layers: ['once'], include_deadlines: false });
    const feed = await (await fetch(base + publication.path)).text();
    assert.match(feed, /UNTIL=20261102T045959Z/);
    assert.match(feed, /EXDATE;TZID=America\/New_York:20261012T090000/);
    const backup = await request('/backup');
    child.kill(); await exited;
    base = await start();
    assert.equal((await request('/calendar')).find((item) => item.id === event.id).ends_before_week, '2026-W45');
    await request('/backup/restore', 'POST', { backup });
    assert.equal(await units('2026-W43'), 2);
    assert.equal(await units('2026-W45'), 0);
    assert.equal((await request('/calendar')).find((item) => item.id === event.id).ends_before_week, '2026-W45');
    const earlier = await request(`${endpoint}&week_key=2026-W44`, 'DELETE');
    assert.equal(earlier.event.ends_before_week, '2026-W44');
    const once = await request('/calendar/events', 'POST', { title: 'Single', day: '周一', start_minute: 600, end_minute: 630, week_key: '2026-W43', layer: 'once' }, 201);
    await request(`/calendar/events/${once.id}?scope=future&week_key=2026-W44`, 'DELETE', null, 404);
    await request(`/calendar/events/${once.id}?scope=future&week_key=2026-W43`, 'DELETE', null, 204);
    await request(`/calendar/events/${event.id}?scope=all`, 'DELETE', null, 204);
  } finally {
    child?.kill(); if (exited) await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
