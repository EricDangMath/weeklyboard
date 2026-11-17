import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import Database from '../node_modules/better-sqlite3/lib/index.js';

async function startServer(database) {
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

test('ICS export/import keeps ISO week keys and real dates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weeklyboard-calendar-'));
  const server = await startServer(join(directory, 'calendar.sqlite'));
  try {
    const debug = await (await fetch(`${server.base}/auth/debug`)).json();
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${debug.token}` };
    const created = await fetch(`${server.base}/calendar/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: '跨周 ICS 事件', day: '周三', start_minute: 600, end_minute: 660,
        week_key: '2026-W37', category: 'study', description: 'round trip',
      }),
    });
    assert.equal(created.status, 201);

    const exportResponse = await fetch(`${server.base}/calendar.ics`, { headers });
    assert.equal(exportResponse.status, 200);
    const ics = await exportResponse.text();
    assert.match(ics, /X-WB-WEEK:2026-W37/);
    assert.match(ics, /DTSTART:20260909T100000Z/);
    assert.match(ics, /DTEND:20260909T110000Z/);

    const imported = await fetch(`${server.base}/calendar/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ics, week_key: '2026-W38' }),
    });
    assert.equal(imported.status, 201);
    assert.equal((await imported.json()).imported, 1);
    const rows = await (await fetch(`${server.base}/calendar`, { headers })).json();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.week_key), ['2026-W37', '2026-W37']);

    const standardIcs = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
      'SUMMARY:无扩展字段', 'DTSTART:20260914T090000Z', 'DTEND:20260914T093000Z',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const importedStandard = await fetch(`${server.base}/calendar/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ics: standardIcs, week_key: '2026-W38' }),
    });
    assert.equal(importedStandard.status, 201);
    const rowsAfterStandard = await (await fetch(`${server.base}/calendar`, { headers })).json();
    const standard = rowsAfterStandard.find((row) => row.title === '无扩展字段');
    assert.equal(standard.week_key, '2026-W38');
    assert.equal(standard.day, '周一');
    assert.equal(standard.start_minute, 540);
    assert.equal(standard.end_minute, 570);
    const duplicate = await fetch(`${server.base}/calendar/import`, {
      method: 'POST', headers, body: JSON.stringify({ ics: standardIcs, timezone: 'UTC' }),
    });
    assert.equal(duplicate.status, 201);
    assert.equal((await (await fetch(`${server.base}/calendar`, { headers })).json()).length, 3);

    const database = new Database(join(directory, 'calendar.sqlite'));
    const subscription = database.prepare('INSERT INTO calendar_subscriptions(user_id,name,url,timezone,last_attempt) VALUES(?,?,?,?,?)').run(debug.user.id, 'Private test', 'https://school.example/feed?key=secret-test-value', 'America/New_York', '2099-01-01T00:00:00Z');
    const reminder = database.prepare("INSERT INTO calendar_events(user_id,title,day,start_minute,end_minute,locked,layer,week_key,source,subscription_id,all_day) VALUES(?,'Day reminder','周一',0,1440,1,'once','2026-W38','ics-subscription',?,1)").run(debug.user.id, subscription.lastInsertRowid);
    database.prepare("UPDATE calendar_events SET deadline_kind='hw',deadline_kind_override='exam',due_minute=1439,course='History',event_url='https://school.example/task',external_date='2026-09-14',deadline_completed=1 WHERE id=?").run(reminder.lastInsertRowid);
    database.close();
    const readonly = await fetch(`${server.base}/calendar/events/${reminder.lastInsertRowid}`, { method: 'PATCH', headers, body: JSON.stringify({ title: 'Changed' }) });
    assert.equal(readonly.status, 409);
    assert.equal((await fetch(`${server.base}/calendar/events/${reminder.lastInsertRowid}`, { method: 'DELETE', headers })).status, 409);
    const exportedAllDay = await (await fetch(`${server.base}/calendar.ics`, { headers })).text();
    assert.match(exportedAllDay, /DTSTART;VALUE=DATE:20260914/);
    assert.match(exportedAllDay, /DTEND;VALUE=DATE:20260915/);
    const backup = await (await fetch(`${server.base}/backup`, { headers })).json();
    assert.equal(JSON.stringify(backup).includes('secret-test-value'), false);
    assert.equal((await fetch(`${server.base}/backup/restore`, { method: 'POST', headers, body: JSON.stringify(backup) })).status, 200);
    assert.deepEqual(await (await fetch(`${server.base}/calendar/subscriptions`, { headers })).json(), []);
    const restored = (await (await fetch(`${server.base}/calendar`, { headers })).json()).find((row) => row.id === Number(reminder.lastInsertRowid));
    assert.equal(restored.all_day, 1);
    assert.equal(restored.subscription_id, null);
    assert.equal(restored.locked, 0);
    const deadlines = await (await fetch(`${server.base}/calendar/deadlines`, { headers })).json();
    const restoredDeadline = deadlines.find((item) => item.event_id === restored.id);
    assert.equal(restoredDeadline.completed, true); assert.equal(restoredDeadline.kind, 'exam');
    assert.equal(restoredDeadline.due_minute, 1439); assert.equal(restoredDeadline.course, 'History');
    assert.equal(restoredDeadline.date, '2026-09-14');
    const beforeReimport = (await (await fetch(`${server.base}/calendar`, { headers })).json()).length;
    await fetch(`${server.base}/calendar/import`, { method: 'POST', headers, body: JSON.stringify({ ics: standardIcs }) });
    assert.equal((await (await fetch(`${server.base}/calendar`, { headers })).json()).length, beforeReimport);
  } finally {
    server.child.kill();
    await server.exited;
    await rm(directory, { recursive: true, force: true });
  }
});
