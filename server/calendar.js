import { parseCalendar } from './calendar-feed.js';

const DAY_NAMES = ['周一','周二','周三','周四','周五','周六','周日'];
const DAYS = new Set(DAY_NAMES);
const WEEK_KEY = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;
const escape = value => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;')
  .replace(/\r?\n/g, '\\n');

function isWeekKey(value) {
  return value == null || (typeof value === 'string' && WEEK_KEY.test(value));
}

function normalizeWeekKey(value) {
  return value == null || value === '' ? null : value;
}

// Return the Monday of an ISO week as a UTC date. Keeping this calculation in
// UTC makes exported DTSTART values deterministic across server time zones.
function mondayForWeekKey(value) {
  if (!WEEK_KEY.test(String(value))) return null;
  const [, yearText, weekText] = String(value).match(/^(\d{4})-W(\d{2})$/);
  const year = Number(yearText);
  const week = Number(weekText);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  return monday;
}

function weekKeyForDate(date) {
  const value = new Date(date);
  const utc = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function registerCalendar(app, db, auth) {
  const validTask = (userId, id) => id == null || (Number.isInteger(id) && Boolean(db.prepare('SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.user_id=?').get(id, userId)));
  app.get('/api/calendar.ics', auth, (req, res) => {
    const rows = db.prepare('SELECT * FROM calendar_events WHERE user_id=? ORDER BY day,start_minute').all(req.user.id);
    const today = new Date();
    const currentWeek = weekKeyForDate(today);
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//WeeklyBoard//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
    for (const row of rows) {
      const eventWeek = isWeekKey(row.week_key) && row.week_key ? row.week_key : currentWeek;
      const monday = mondayForWeekKey(eventWeek) || mondayForWeekKey(currentWeek);
      const dayOffset = DAY_NAMES.indexOf(row.day);
      const date = new Date(monday);
      date.setUTCDate(date.getUTCDate() + Math.max(0, dayOffset));
      const stamp = (minute) => {
        const value = new Date(date);
        value.setUTCMinutes(Number(minute));
        return value.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
      };
      if (row.all_day) {
        lines.push('BEGIN:VEVENT', `UID:wb-${row.id}@weeklyboard`, `SUMMARY:${escape(row.title)}`,
          `DTSTART;VALUE=DATE:${stamp(0).slice(0, 8)}`, `DTEND;VALUE=DATE:${stamp(1440).slice(0, 8)}`, 'END:VEVENT');
        continue;
      }
      lines.push(
        'BEGIN:VEVENT',
        `UID:wb-${row.id}@weeklyboard`,
        `SUMMARY:${escape(row.title)}`,
        `DTSTART:${stamp(row.start_minute)}`,
        `DTEND:${stamp(row.end_minute)}`,
        `X-WB-DAY:${row.day}`,
        `X-WB-START:${row.start_minute}`,
        `X-WB-END:${row.end_minute}`,
        `X-WB-WEEK:${eventWeek}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    res.type('text/calendar').send(lines.join('\r\n') + '\r\n');
  });
  app.post('/api/calendar/import', auth, async (req, res) => {
    try {
      const requestedWeekKey = req.body?.week_key ?? null;
      if (!isWeekKey(requestedWeekKey)) return res.status(400).json({ error: 'invalid week_key' });
      const parsed = await parseCalendar(req.body?.ics, {
        timezone: req.body?.timezone || 'UTC',
        now: (mondayForWeekKey(requestedWeekKey) || new Date()).toISOString(),
      });
      if (!parsed.blocks.length) return res.status(400).json({ error: '日历中没有可导入的日程' });
      const insert = db.prepare(`INSERT INTO calendar_events(
        user_id,title,day,start_minute,end_minute,category,description,layer,week_key,source,external_key,external_date,all_day
      ) VALUES(?,?,?,?,?,'class',?,'once',?,'ics-import',?,?,?)
      ON CONFLICT DO UPDATE SET title=excluded.title,day=excluded.day,start_minute=excluded.start_minute,end_minute=excluded.end_minute,
      description=excluded.description,week_key=excluded.week_key,external_date=excluded.external_date,all_day=excluded.all_day`);
      db.transaction(() => { for (const b of parsed.blocks) insert.run(req.user.id,b.title,b.day,b.start_minute,b.end_minute,b.description,b.week_key,b.external_key,b.date || null,b.all_day); })();
      res.status(201).json({ imported: parsed.blocks.length });
    } catch (error) { res.status(400).json({ error: error.calendarError ? error.message : '日历导入失败' }); }
  });
  app.post('/api/calendar/events', auth, (req, res) => {
    const body = req.body || {};
    if (!validTask(req.user.id, body.task_id)) return res.status(400).json({ error: 'invalid task_id' });
    if (!DAYS.has(body.day) || typeof body.title !== 'string' || !body.title.trim() || !Number.isInteger(body.start_minute) || !Number.isInteger(body.end_minute) || body.start_minute < 0 || body.end_minute > 1440 || body.start_minute >= body.end_minute || !isWeekKey(body.week_key ?? null)) return res.status(400).json({ error: 'invalid calendar event' });
    const result = db.prepare(`INSERT INTO calendar_events(
      user_id,title,day,start_minute,end_minute,locked,category,description,layer,week_key,repeat_rule,source,task_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      req.user.id,
      body.title.trim().slice(0, 200),
      body.day,
      body.start_minute,
      body.end_minute,
      body.locked ? 1 : 0,
      String(body.category || body.cat || 'other').slice(0, 32),
      String(body.description || '').slice(0, 2000),
      String(body.layer || 'actual').slice(0, 32),
      normalizeWeekKey(body.week_key),
      body.repeat_rule || (body.repeat ? 'weekly' : null),
      String(body.source || 'calendar').slice(0, 32),
      body.task_id ?? null,
    );
    res.status(201).json(db.prepare('SELECT * FROM calendar_events WHERE id=?').get(result.lastInsertRowid));
  });
  app.patch('/api/calendar/events/:id', auth, (req, res) => {
    const existing = db.prepare('SELECT * FROM calendar_events WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'calendar event not found' });
    if (existing.subscription_id) return res.status(409).json({ error: '订阅日程由来源日历更新；请在来源日历修改，或先取消订阅并保留日程' });
    const body = { ...existing, ...(req.body || {}) };
    if (!validTask(req.user.id, body.task_id)) return res.status(400).json({ error: 'invalid task_id' });
    const repeatRule = Object.hasOwn(req.body || {}, 'repeat') ? (req.body.repeat ? 'weekly' : null) : body.repeat_rule || null;
    if (!DAYS.has(body.day) || typeof body.title !== 'string' || !body.title.trim() || !Number.isInteger(Number(body.start_minute)) || !Number.isInteger(Number(body.end_minute)) || Number(body.start_minute) < 0 || Number(body.end_minute) > 1440 || Number(body.start_minute) >= Number(body.end_minute) || !isWeekKey(body.week_key ?? null)) return res.status(400).json({ error: 'invalid calendar event' });
    db.prepare(`UPDATE calendar_events SET
      title=?,day=?,start_minute=?,end_minute=?,locked=?,category=?,description=?,layer=?,week_key=?,repeat_rule=?,source=?,task_id=?
      WHERE id=? AND user_id=?
    `).run(
      body.title.trim().slice(0, 200),
      body.day,
      Number(body.start_minute),
      Number(body.end_minute),
      body.locked ? 1 : 0,
      String(body.category || body.cat || existing.category || 'other').slice(0, 32),
      String(body.description || '').slice(0, 2000),
      String(body.layer || existing.layer || 'actual').slice(0, 32),
      normalizeWeekKey(body.week_key === undefined ? existing.week_key : body.week_key),
      repeatRule,
      String(body.source || existing.source || 'calendar').slice(0, 32),
      body.task_id ?? null,
      existing.id,
      req.user.id,
    );
    res.json(db.prepare('SELECT * FROM calendar_events WHERE id=?').get(existing.id));
  });
  app.delete('/api/calendar/events/:id', auth, (req, res) => {
    const existing = db.prepare('SELECT subscription_id FROM calendar_events WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (existing?.subscription_id) return res.status(409).json({ error: '请在订阅管理中取消订阅，或在来源日历删除此日程' });
    const result = db.prepare('DELETE FROM calendar_events WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'calendar event not found' });
    res.status(204).end();
  });
}
