import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from '../node_modules/express/index.js';
import Database from '../node_modules/better-sqlite3/lib/index.js';
import { parseFeed } from '../calendar-parser.js';
import { parseCalendar, normalizeFeedUrl, isPublicAddress, fetchCalendar, feedError } from '../calendar-feed.js';
import { registerSubscriptions } from '../subscriptions.js';
import { getDeadlines } from '../deadlines.js';

const calendar = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((event) => ['BEGIN:VEVENT', ...event, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const event = (title = 'School course', start = '20260914T090000', end = '20260914T100000') => ['UID:course-1', `SUMMARY:${title}`, `DTSTART;TZID=America/New_York:${start}`, `DTEND;TZID=America/New_York:${end}`];
const options = { timezone: 'America/New_York', now: '2026-09-13T12:00:00Z' };

test('calendar parser handles time zones, folding, all-day dates, midnight and ISO years', async () => {
  const result = await parseCalendar(calendar(
    [...event('Long'), 'DESCRIPTION:Folded', ' description'],
    ['UID:utc', 'SUMMARY:UTC', 'DTSTART:20260914T130000Z', 'DTEND:20260914T140000Z'],
    ['UID:float', 'SUMMARY:Floating', 'DTSTART:20260914T090000', 'DTEND:20260914T100000'],
    ['UID:allday', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20260914', 'DTEND;VALUE=DATE:20260916'],
    ['UID:midnight', 'SUMMARY:Overnight', 'DTSTART;TZID=America/New_York:20260914T233000', 'DTEND;TZID=America/New_York:20260915T003000'],
    ['UID:newyear', 'SUMMARY:New Year', 'DTSTART:20270101T150000Z', 'DTEND:20270101T160000Z'],
  ), options);
  for (const title of ['Long', 'UTC', 'Floating']) assert.equal(result.blocks.find((b) => b.title === title).start_minute, 540);
  assert.equal(result.blocks.find((b) => b.title === 'Long').description, 'Foldeddescription');
  assert.deepEqual(result.blocks.filter((b) => b.all_day).map((b) => b.date), ['2026-09-14', '2026-09-15']);
  assert.deepEqual(result.blocks.filter((b) => b.title === 'Overnight').map((b) => [b.start_minute, b.end_minute]), [[1410, 1440], [0, 30]]);
  assert.equal(result.blocks.find((b) => b.title === 'New Year').week_key, '2026-W53');
  await assert.rejects(parseCalendar('<html>Login</html>', options), /ICS/);
  await assert.rejects(parseCalendar('BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VCALENDAR', options), /完整/);
  const inclusive = parseFeed(calendar(['UID:school-day', 'SUMMARY:School day', 'DTSTART;VALUE=DATE:20260914', 'DTEND;VALUE=DATE:20260914']), options).blocks;
  assert.deepEqual(inclusive.map((b) => [b.date, b.all_day, b.start_minute, b.end_minute]), [['2026-09-14', 1, 0, 1440]]);
});

test('recurrences keep local time across DST and apply exceptions and moved/cancelled occurrences', () => {
  const raw = calendar(
    [...event('Recurring', '20261019T090000', '20261019T100000'), 'RRULE:FREQ=WEEKLY;COUNT=5', 'EXDATE;TZID=America/New_York:20261026T090000'],
    [...event('Moved', '20261103T110000', '20261103T120000'), 'RECURRENCE-ID;TZID=America/New_York:20261102T090000'],
    [...event('Cancelled', '20261109T090000', '20261109T100000'), 'RECURRENCE-ID;TZID=America/New_York:20261109T090000', 'STATUS:CANCELLED'],
  );
  const result = parseFeed(raw, options).blocks;
  assert.deepEqual(result.map((b) => [b.date, b.start_minute]), [['2026-10-19', 540], ['2026-11-03', 660], ['2026-11-16', 540]]);
  const again = parseFeed(raw.replace('20261103T110000', '20261103T113000'), options).blocks;
  assert.equal(again[1].external_key, result[1].external_key);
});

test('subscription URLs reject unsafe schemes, private IPs and loopback DNS without exposing secrets', async () => {
  assert.equal(normalizeFeedUrl('webcal://school.example/feed?key=private'), 'https://school.example/feed?key=private');
  for (const url of ['http://school.example/feed', 'file:///etc/passwd', 'https://user:pass@school.example/feed', 'https://school.example:8787/feed']) assert.throws(() => normalizeFeedUrl(url));
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '0.0.0.0']) assert.equal(isPublicAddress(ip), false);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  await assert.rejects(fetchCalendar('https://localhost/feed?secret=private'), (error) => !error.message.includes('private') && !error.message.includes('localhost'));
});

test('Canvas deadlines preserve zero-duration due times, date-only reminders, course and full descriptions', async () => {
  const description = 'Full assignment instructions. '.repeat(200);
  const result = await parseCalendar(calendar(
    ['UID:canvas-assignment-1', 'SUMMARY:Read chapter 3 [History A]', 'DTSTART:20260915T035900Z', 'DTEND:20260915T035900Z', `DESCRIPTION:${description}`, 'URL;VALUE=URI:https://school.instructure.com/courses/1/assignments/2'],
    ['UID:canvas-assignment-2', 'SUMMARY:Unit Quiz [Chemistry]', 'DTSTART;VALUE=DATE:20260916', 'DTEND;VALUE=DATE:20260916'],
    ['UID:canvas-assignment-3', 'SUMMARY:Cancelled [Math]', 'DTSTART:20260916T150000Z', 'DTEND:20260916T150000Z', 'STATUS:CANCELLED'],
  ), { ...options, mode: 'deadlines' });
  assert.equal(result.blocks.length, 2);
  const timed = result.blocks[0];
  assert.equal(timed.title, 'Read chapter 3'); assert.equal(timed.course, 'History A');
  assert.equal(timed.date, '2026-09-14'); assert.equal(timed.due_minute, 1439);
  assert.equal(timed.week_key, '2026-W38'); assert.equal(timed.description, description);
  assert.equal(timed.event_url, 'https://school.instructure.com/courses/1/assignments/2');
  assert.equal(timed.deadline_kind, 'hw'); assert.equal(timed.all_day, 1);
  assert.equal(result.blocks[1].deadline_kind, 'exam'); assert.equal(result.blocks[1].due_minute, null);
  assert.equal(result.blocks[1].date, '2026-09-16');
});

test('subscriptions deduplicate, update, reconcile future events, preserve history and isolate accounts', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);
    CREATE TABLE calendar_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,title TEXT,day TEXT,start_minute INTEGER,end_minute INTEGER,locked INTEGER,category TEXT,description TEXT,layer TEXT,week_key TEXT,source TEXT);
    CREATE TABLE workspace_scratch(id INTEGER PRIMARY KEY,user_id INTEGER,kind TEXT,week_key TEXT,entity_key TEXT,payload_json TEXT);`);
  const app = express(); app.use(express.json());
  let raw = calendar(event()); let failed = false; let requests = 0; let gate = null;
  const service = registerSubscriptions(app, db, (req, _res, next) => { req.user = { id: Number(req.headers['x-user'] || 1) }; next(); }, {
    autoSync: false, fetchFeed: async () => { requests++; if (gate) await gate; if (failed) throw feedError('模拟网络中断'); return raw; },
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/calendar/subscriptions`;
  const call = async (path = '', body, method = 'GET', user = 1) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-user': String(user) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const input = { name: 'School', url: 'https://school.example/feed?key=secret-test-value', timezone: options.timezone };
    const added = await call('', input, 'POST'); assert.equal(added.status, 201);
    const id = added.body.id;
    assert.equal(JSON.stringify(added.body).includes('secret-test-value'), false);
    assert.equal(JSON.stringify((await call()).body).includes('secret-test-value'), false);
    const first = db.prepare('SELECT * FROM calendar_events').get();
    assert.equal(first.layer, 'once'); assert.equal(first.start_minute, 540);
    const noFetch = requests;
    for (const layer of ['fixed', 'flex', 'actual', 'once']) {
      assert.equal((await call(`/${id}`, { layer }, 'PATCH')).body.layer, layer);
      assert.equal(db.prepare('SELECT layer FROM calendar_events').get().layer, layer);
    }
    assert.equal(requests, noFetch, 'layer-only change also works offline');
    assert.equal((await call(`/${id}`, { layer: 'invalid' }, 'PATCH')).status, 400);
    assert.equal((await call(`/${id}`, { layer: 'actual' }, 'PATCH', 2)).status, 404);
    await call('', input, 'POST'); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n, 1);
    raw = calendar(event('Updated', '20260914T110000', '20260914T120000'));
    await call(`/${id}/sync`, {}, 'POST');
    assert.equal(db.prepare('SELECT * FROM calendar_events').get().id, first.id);
    assert.equal(db.prepare('SELECT * FROM calendar_events').get().start_minute, 660);
    let release;
    gate = new Promise(resolve => { release = resolve; });
    const priorRequests = requests;
    const changing = call(`/${id}`, { mode: 'deadlines' }, 'PATCH');
    for (let n = 0; n < 100 && requests === priorRequests; n++) await new Promise(resolve => setTimeout(resolve, 5));
    const joiningSync = service.sync(id);
    release(); gate = null;
    assert.equal((await changing).status, 200);
    assert.equal(JSON.stringify(await joiningSync).includes('secret-test-value'), false, 'joining a settings operation must not reveal the feed URL');
    await call(`/${id}`, { mode: 'schedule' }, 'PATCH');
    assert.equal((await call(`/${id}/sync`, {}, 'POST', 2)).status, 404);
    assert.equal((await call(`/${id}`, {}, 'DELETE', 2)).status, 404);
    failed = true;
    assert.equal((await call(`/${id}/sync`, {}, 'POST')).status, 502);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n, 1);
    failed = false;
    db.prepare("UPDATE calendar_events SET external_date='2020-01-01'").run();
    raw = calendar(); await call(`/${id}/sync`, {}, 'POST');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n, 1, 'history survives rolling feed');
    db.prepare("UPDATE calendar_events SET external_date='2099-01-01'").run();
    await call(`/${id}/sync`, {}, 'POST'); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n, 0);
    raw = calendar(event()); await call(`/${id}/sync`, {}, 'POST');
    const before = requests; await Promise.all([service.sync(id), service.sync(id)]); assert.equal(requests, before + 1);
    await call(`/${id}`, null, 'DELETE');
    const retained = db.prepare('SELECT * FROM calendar_events').get();
    assert.equal(retained.subscription_id, null); assert.equal(retained.locked, 0);
    const second = await call('', input, 'POST');
    await call(`/${second.body.id}?remove_events=true`, null, 'DELETE');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n, 1, 'unrelated retained event remains');
  } finally { service.stop(); await new Promise((resolve) => server.close(resolve)); db.close(); }
});

test('deadline projection and completion stay in sync through source edits, layer changes and unsubscribe', async () => {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);
    CREATE TABLE calendar_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,title TEXT,day TEXT,start_minute INTEGER,end_minute INTEGER,locked INTEGER,category TEXT,description TEXT,layer TEXT,week_key TEXT,source TEXT);
    CREATE TABLE workspace_scratch(id INTEGER PRIMARY KEY,user_id INTEGER,kind TEXT,week_key TEXT,entity_key TEXT,payload_json TEXT);`);
  db.prepare('INSERT INTO workspace_scratch VALUES(1,1,?,?,?,?)').run('deadline','2026-W38','manual',JSON.stringify({ id:'manual',text:'Manual reminder',date:'2026-09-15',day:'周二',kind:'hw' }));
  const app = express(); app.use(express.json());
  let raw = calendar(['UID:canvas-assignment', 'SUMMARY:Essay [English]', 'DTSTART:20260915T035900Z', 'DTEND:20260915T035900Z']);
  let failed = false;
  const service = registerSubscriptions(app, db, (req, _res, next) => { req.user = { id: Number(req.headers['x-user'] || 1) }; next(); }, { autoSync:false, fetchFeed:async()=> { if(failed) throw feedError('Offline'); return raw; } });
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/calendar`;
  const call = async (path, method='GET', body, user=1) => {
    const response = await fetch(base+path,{method,headers:{'Content-Type':'application/json','x-user':String(user)},body:body ? JSON.stringify(body) : undefined});
    return {status:response.status,body:await response.json().catch(()=>null)};
  };
  try {
    const sub = await call('/subscriptions','POST',{url:'https://school.instructure.com/feeds/calendars/private-test.ics',timezone:'America/New_York',layer:'flex'});
    assert.equal(sub.body.mode,'deadlines');
    const id = sub.body.id;
    let reminders = (await call('/deadlines')).body;
    assert.equal(reminders.length,2); assert.equal(reminders.find(r=>r.id==='manual').__scratchId,1);
    const item = reminders.find(r=>r.event_id);
    assert.equal(item.layer,'flex'); assert.equal(item.due_minute,1439);
    assert.equal((await call(`/deadlines/${item.event_id}`,'PATCH',{completed:true,kind:'exam'})).body.completed,true);
    assert.equal((await call(`/deadlines/${item.event_id}`,'PATCH',{completed:false},2)).status,404);
    raw = raw.replaceAll('20260915T035900Z','20260922T020000Z');
    await service.sync(id);
    reminders = getDeadlines(db,1);
    const moved = reminders.find(r=>r.event_id);
    assert.equal(moved.id,item.id); assert.equal(moved.weekKey,'2026-W39'); assert.equal(moved.date,'2026-09-21'); assert.equal(moved.due_minute,1320);
    assert.equal(moved.completed,true); assert.equal(moved.kind,'exam');
    await call(`/subscriptions/${id}`,'PATCH',{layer:'fixed'}); await service.sync(id);
    assert.equal(getDeadlines(db,1).find(r=>r.event_id).layer,'fixed');
    failed = true;
    assert.equal((await call(`/subscriptions/${id}`,'PATCH',{mode:'schedule',layer:'actual'})).status,400);
    assert.equal((await call('/subscriptions')).body[0].mode,'deadlines');
    assert.equal((await call('/subscriptions')).body[0].layer,'fixed');
    failed = false;
    await call(`/subscriptions/${id}`,'DELETE');
    assert.equal(getDeadlines(db,1).find(r=>r.event_id).subscription_id,null);
    assert.equal(getDeadlines(db,1).find(r=>r.event_id).completed,true);
    const again = await call('/subscriptions','POST',{url:'https://school.instructure.com/feeds/calendars/private-test.ics',timezone:'America/New_York'});
    await call(`/subscriptions/${again.body.id}?remove_events=true`,'DELETE');
    assert.equal(getDeadlines(db,1).length,2);
  } finally { service.stop(); await new Promise(resolve=>server.close(resolve)); db.close(); }
});
