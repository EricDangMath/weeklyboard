import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import Database from '../node_modules/better-sqlite3/lib/index.js';
import ical from 'node-ical';
import { buildPublishedCalendar } from '../calendar-publish.js';
import { parseCalendar } from '../calendar-feed.js';
import { eventCopyPayload } from '../../src/event-copy.mjs';

const settings = { title: '测试周看板', timezone: 'America/New_York', layers: ['fixed', 'once'], include_deadlines: true };
const event = { title: '语文', day: '周一', start_minute: 540, end_minute: 600, layer: 'once', category: 'study', week_key: '2026-W41' };
const parsedEvents = (text) => Object.values(ical.sync.parseICS(text)).filter((item) => item.type === 'VEVENT');

test('published calendars preserve all-day dates, exact deadlines and recurring local time across DST', async () => {
  const profile = { ...settings, layers: JSON.stringify(settings.layers), user_id: 1, anchor_date: '2026-10-05', updated_at: '2026-10-01T00:00:00Z', revision: 0 };
  const text = buildPublishedCalendar(profile, [
    { ...event, feed_uid: 'repeat', layer: 'fixed', repeat_rule: 'weekly' },
    { ...event, feed_uid: 'deadline', title: '考试', deadline_kind: 'exam', all_day: 1, due_minute: 840 },
    { ...event, feed_uid: 'date', title: '全天', all_day: 1, external_date: '2026-10-06' },
    { ...event, feed_uid: 'hidden', title: '隐藏实际', layer: 'actual' },
  ]);
  assert.match(text, /DTSTAMP:20261001T000000Z/);
  assert.match(text, /DTSTART;TZID=America\/New_York:20261005T090000/);
  assert.match(text, /RRULE:FREQ=WEEKLY/);
  assert.match(text, /BEGIN:VTIMEZONE/);
  assert.match(text, /DTSTART;VALUE=DATE:20261006/);
  assert.match(text, /DTEND;VALUE=DATE:20261007/);
  assert.match(text, /BEGIN:VALARM/);
  assert.equal(parsedEvents(text).length, 3);
  assert.equal(parsedEvents(text).find((row) => row.summary === '考试').start.toISOString(), '2026-10-05T18:00:00.000Z');
  const imported = await parseCalendar(text, { timezone: 'America/New_York', now: '2026-10-19T00:00:00Z' });
  const recurring = imported.blocks.filter((row) => row.title === '语文');
  assert.ok(recurring.some((row) => row.week_key === '2026-W44'));
  assert.ok(recurring.some((row) => row.week_key === '2026-W45'));
  assert.ok(recurring.every((row) => row.start_minute === 540 && row.end_minute === 600));
});

test('fixed schedules and manual deadline flags are projected without private source URLs', () => {
  const profile = { ...settings, layers: JSON.stringify(settings.layers), user_id: 1, anchor_date: '2026-10-05', updated_at: '2026-10-01T00:00:00Z', revision: 3 };
  const fixed = [{ day: '周三', start_minute: 420, end_minute: 450, title: '晨读' }];
  const reminders = [{ user_id: 1, entity_key: 'test-deadline', week_key: '2026-W41', updated_at: '2026-10-02T00:00:00Z', payload_json: JSON.stringify({ day: '周二', text: '交作业', due_minute: 840, kind: 'hw' }) }];
  const parsed = parsedEvents(buildPublishedCalendar(profile, [], fixed, reminders));
  assert.equal(parsed.length, 2);
  assert.equal(parsed.find((row) => row.summary === '晨读').rrule.options.freq, 'WEEKLY');
  assert.equal(parsed.find((row) => row.summary === '交作业').start.toISOString(), '2026-10-06T18:00:00.000Z');
  assert.equal(parsedEvents(buildPublishedCalendar({ ...profile, include_deadlines: false }, [], fixed, reminders)).length, 1);
  const text = buildPublishedCalendar(profile, [{ ...event, feed_uid: 'public', subscription_id: 8, url: 'https://private.example/feed?secret=do-not-export', external_key: 'secret-uid' }]);
  assert.ok(!text.includes('do-not-export') && !text.includes('secret-uid'));
});

test('private opt-in feed is user-scoped, live, revocable, has stable UIDs and copies are independent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-publish-'));
  const filename = join(directory, 'test.sqlite');
  const child = spawn(process.execPath, [resolve('server/index.js')], {
    env: { ...process.env, DEBUG_MODE: 'true', DB_FILE: filename, PORT: '0', JWT_SECRET: randomBytes(32).toString('hex'), PUBLIC_CALENDAR_BASE_URL: 'https://calendar.example/api' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  try {
    const port = await new Promise((resolvePort, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('API startup timed out')), 10000);
      child.stdout.on('data', (chunk) => { output += chunk; const match = output.match(/weeklyboard api listening (\d+)/); if (match) { clearTimeout(timeout); resolvePort(Number(match[1])); } });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('API exited')); });
    });
    const base = `http://127.0.0.1:${port}/api`;
    const debug = await (await fetch(`${base}/auth/debug`)).json();
    const headers = { Authorization: `Bearer ${debug.token}`, 'Content-Type': 'application/json' };
    const request = (path, method = 'GET', body) => fetch(base + path, { headers, method, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await fetch(`${base}/calendar/publish`)).status, 401);
    assert.equal((await (await request('/calendar/publish')).json()).enabled, false);
    assert.equal((await request('/calendar/publish', 'PUT', { ...settings, layers: [] })).status, 400);
    assert.equal((await request('/calendar/publish', 'PUT', { ...settings, timezone: '../../etc/passwd' })).status, 400);
    const original = await (await request('/calendar/events', 'POST', event)).json();
    await request('/calendar/events', 'POST', { ...event, title: '实际隐藏', layer: 'actual' });
    const db = new Database(filename);
    const other = db.prepare("INSERT INTO users(email,password_hash,created_at) VALUES('other@example.test','unused','2026-10-01')").run();
    db.prepare("INSERT INTO calendar_events(user_id,title,day,start_minute,end_minute,layer,week_key) VALUES(?,'其他用户秘密','周一',600,630,'once','2026-W41')").run(other.lastInsertRowid);
    db.close();
    const published = await (await request('/calendar/publish', 'PUT', settings)).json();
    assert.match(published.path, /^\/calendar\/feeds\/[a-f0-9]{64}\.ics$/);
    assert.equal(published.url, 'https://calendar.example/api' + published.path);
    assert.equal((await (await request('/calendar/publish')).json()).path, published.path);
    const getFeed = () => fetch(base + published.path);
    const initialResponse = await getFeed();
    assert.match(initialResponse.headers.get('content-type'), /text\/calendar/);
    assert.match(initialResponse.headers.get('cache-control'), /no-store/);
    const initialText = await initialResponse.text();
    const initial = parsedEvents(initialText);
    assert.equal(initial.length, 1);
    assert.equal(initial[0].summary, event.title);
    assert.equal((await (await getFeed()).text()), initialText);
    await request(`/calendar/events/${original.id}`, 'PATCH', { title: '新标题', start_minute: 600, end_minute: 660 });
    const updated = parsedEvents(await (await getFeed()).text())[0];
    assert.equal(updated.uid, initial[0].uid);
    assert.equal(updated.summary, '新标题');
    assert.ok(updated.sequence > initial[0].sequence);
    assert.equal(updated.start.toISOString(), '2026-10-05T14:00:00.000Z');
    const copy = await (await request('/calendar/events', 'POST', eventCopyPayload(original, { day: '周二', start_minute: 840, end_minute: 900 }, '2026-W41'))).json();
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.day, '周二'); assert.equal(copy.locked, 0); assert.equal(copy.repeat_rule, null);
    assert.equal(parsedEvents(await (await getFeed()).text()).length, 2);
    await request(`/calendar/events/${copy.id}`, 'PATCH', { title: '只改副本' });
    assert.equal((await (await request('/calendar')).json()).find((row) => row.id === original.id).title, '新标题');
    const dbIdentity = new Database(filename);
    const inserted = dbIdentity.prepare("INSERT INTO calendar_events(user_id,title,day,start_minute,end_minute,layer,week_key) VALUES(?,'UID test','周一',600,630,'once','2026-W41')").run(debug.user.id);
    const oldUid = dbIdentity.prepare('SELECT feed_uid FROM calendar_feed_identity WHERE event_id=?').get(inserted.lastInsertRowid).feed_uid;
    dbIdentity.prepare('DELETE FROM calendar_events WHERE id=?').run(inserted.lastInsertRowid);
    dbIdentity.prepare("INSERT INTO calendar_events(id,user_id,title,day,start_minute,end_minute,layer,week_key) VALUES(?,?,'UID replacement','周一',600,630,'once','2026-W41')").run(inserted.lastInsertRowid, debug.user.id);
    assert.notEqual(dbIdentity.prepare('SELECT feed_uid FROM calendar_feed_identity WHERE event_id=?').get(inserted.lastInsertRowid).feed_uid, oldUid);
    dbIdentity.prepare('DELETE FROM calendar_events WHERE id=?').run(inserted.lastInsertRowid);
    dbIdentity.close();
    await request(`/calendar/events/${original.id}`, 'DELETE');
    assert.ok(!parsedEvents(await (await getFeed()).text()).some((row) => row.uid === initial[0].uid));
    const filtered = await (await request('/calendar/publish', 'PUT', { ...settings, layers: ['actual'] })).json();
    assert.equal(filtered.path, published.path);
    assert.deepEqual(parsedEvents(await (await getFeed()).text()).map((row) => row.summary), ['实际隐藏']);
    const backup = await (await request('/backup')).json();
    assert.ok(!JSON.stringify(backup).includes(published.path));
    assert.ok(!('calendar_publications' in backup.tables));
    assert.equal((await request('/calendar/publish', 'DELETE')).status, 204);
    assert.equal((await getFeed()).status, 404);
    const enabled = await (await request('/calendar/publish', 'PUT', settings)).json();
    assert.notEqual(enabled.path, published.path);
    assert.equal((await getFeed()).status, 404);
    assert.equal((await request('/backup/restore', 'POST', backup)).status, 200);
    assert.equal((await fetch(base + enabled.path)).status, 404);
    assert.equal((await (await request('/calendar/publish')).json()).enabled, false);
    assert.equal((await fetch(`${base}/calendar/feeds/not-a-token.ics`)).status, 404);
  } finally {
    child.kill(); await exited; await rm(directory, { recursive: true, force: true });
  }
});
