import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import ical from 'ical-generator';
import { getVtimezoneComponent } from '@touch4it/ical-timezones';
import { Temporal } from 'temporal-polyfill';

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const LAYERS = ['fixed', 'flex', 'once', 'actual'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const mintNonce = () => randomBytes(32).toString('hex');

function monday(week, fallback) {
  if (!/^\d{4}-W\d{2}$/.test(week || '')) return Temporal.PlainDate.from(fallback);
  const jan4 = Temporal.PlainDate.from(`${week.slice(0, 4)}-01-04`);
  return jan4.subtract({ days: jan4.dayOfWeek - 1 }).add({ weeks: Number(week.slice(6)) - 1 });
}

function dateFor(row, anchor) {
  if (row.external_date) return Temporal.PlainDate.from(row.external_date);
  return monday(row.week_key, anchor).add({ days: Math.max(0, DAYS.indexOf(row.day)) });
}

function zoned(date, minute, timezone) {
  return date.toPlainDateTime().add({ minutes: minute }).toZonedDateTime(timezone);
}

export function buildPublishedCalendar(profile, events, fixed = [], deadlines = []) {
  const layers = JSON.parse(profile.layers);
  const cal = ical({ name: profile.title, prodId: '//WeeklyBoard//Calendar Subscription//EN', ttl: 1800 });
  // Leave the calendar-level zone unset so DTSTAMP remains UTC; each event
  // carries its own zone and the generator adds the matching VTIMEZONE.
  cal.timezone({ generator: getVtimezoneComponent });
  const create = (row) => {
    if (!layers.includes(row.layer) || (row.deadline_kind && !profile.include_deadlines)) return;
    const date = dateFor(row, profile.anchor_date);
    const allDay = row.deadline_kind ? row.due_minute == null : Boolean(row.all_day);
    const minute = row.deadline_kind ? row.due_minute : Number(row.start_minute);
    const endMinute = row.deadline_kind ? minute : Number(row.end_minute);
    const modified = new Date(Math.max(Date.parse(row.modified || profile.updated_at), Date.parse(profile.updated_at)));
    const event = cal.createEvent({
      id: `${row.feed_uid}@weeklyboard`,
      summary: row.deadline_kind ? `${row.deadline_completed ? '[已完成] ' : ''}${row.title}` : row.title,
      description: row.description || '',
      start: allDay ? new Date(`${date}T00:00:00Z`) : zoned(date, minute, profile.timezone),
      end: allDay ? new Date(`${date.add({ days: 1 })}T00:00:00Z`) : zoned(date, endMinute, profile.timezone),
      allDay,
      timezone: allDay ? null : profile.timezone,
      stamp: modified,
      lastModified: modified,
      sequence: Number(row.sequence || 0) + profile.revision,
      repeating: row.repeat_rule === 'weekly' && row.layer !== 'actual' ? { freq: 'WEEKLY' } : null,
    });
    if (row.deadline_kind && !row.deadline_completed) event.createAlarm({ type: 'display', trigger: 0, description: row.title });
  };
  for (const row of events) create(row);
  for (const row of fixed) create({ ...row, layer: 'fixed', repeat_rule: 'weekly', title: row.title || '固定事项', feed_uid: `fixed-${hash(JSON.stringify([profile.user_id, row.day, row.start_minute, row.end_minute]))}` });
  if (profile.include_deadlines) for (const row of deadlines) {
    let item;
    try { item = JSON.parse(row.payload_json); } catch { continue; }
    if (!item.text || !DAYS.includes(item.day)) continue;
    create({ ...item, title: item.text, week_key: row.week_key, external_date: item.date,
      layer: item.layer || 'once', deadline_kind: item.kind || 'hw', deadline_completed: item.completed,
      feed_uid: `deadline-${hash(JSON.stringify([profile.user_id, row.entity_key]))}`,
      modified: row.updated_at, sequence: Math.floor(Date.parse(row.updated_at) / 1000),
    });
  }
  return cal.toString();
}

export function registerCalendarPublish(app, db, auth, secret) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_publications (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0, nonce TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL, timezone TEXT NOT NULL, layers TEXT NOT NULL,
      include_deadlines INTEGER NOT NULL DEFAULT 1, anchor_date TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS calendar_feed_identity (
      event_id INTEGER PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
      feed_uid TEXT NOT NULL UNIQUE, sequence INTEGER NOT NULL DEFAULT 0, modified TEXT NOT NULL
    );
    INSERT OR IGNORE INTO calendar_feed_identity(event_id,feed_uid,modified)
      SELECT id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM calendar_events;
    CREATE TRIGGER IF NOT EXISTS calendar_feed_insert AFTER INSERT ON calendar_events BEGIN
      INSERT INTO calendar_feed_identity(event_id,feed_uid,modified)
        VALUES(NEW.id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    END;
    CREATE TRIGGER IF NOT EXISTS calendar_feed_update AFTER UPDATE ON calendar_events BEGIN
      UPDATE calendar_feed_identity SET sequence=sequence+1,modified=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS calendar_fixed_insert AFTER INSERT ON availability BEGIN
      UPDATE calendar_publications SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=NEW.user_id;
    END;
    CREATE TRIGGER IF NOT EXISTS calendar_fixed_delete AFTER DELETE ON availability BEGIN
      UPDATE calendar_publications SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=OLD.user_id;
    END;
  `);
  const tokenFor = (row) => createHmac('sha256', secret).update(`calendar-feed\0${row.user_id}\0${row.nonce}`).digest('hex');
  const get = (userId) => db.prepare('SELECT * FROM calendar_publications WHERE user_id=?').get(userId);
  const publicBase = () => {
    if (!process.env.PUBLIC_CALENDAR_BASE_URL) return null;
    try {
      const url = new URL(process.env.PUBLIC_CALENDAR_BASE_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
      return url.href.replace(/\/$/, '');
    } catch { return null; }
  };
  const response = (row) => {
    const base = publicBase();
    if (!row) return { enabled: false, public_base: base };
    const enabled = Boolean(row.enabled && row.token_hash === hash(tokenFor(row)));
    const path = enabled ? `/calendar/feeds/${tokenFor(row)}.ics` : null;
    return { enabled, title: row.title, timezone: row.timezone,
      layers: JSON.parse(row.layers), include_deadlines: Boolean(row.include_deadlines),
      path, public_base: base, url: path && base ? `${base}${path}` : null };
  };
  app.get('/api/calendar/publish', auth, (req, res) => {
    res.set('Cache-Control', 'no-store').json(response(get(req.user.id)));
  });
  app.put('/api/calendar/publish', auth, (req, res) => {
    const { title, timezone, layers, include_deadlines } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || title.length > 100 ||
        !Array.isArray(layers) || !layers.length || layers.some((layer) => !LAYERS.includes(layer)) ||
        typeof include_deadlines !== 'boolean' || typeof timezone !== 'string') return res.status(400).json({ error: '请填写名称并至少选择一个图层' });
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
      if (timezone !== 'UTC' && !getVtimezoneComponent(timezone)) throw new Error();
    } catch { return res.status(400).json({ error: '不支持的时区' }); }
    const existing = get(req.user.id);
    const nonce = existing?.enabled ? existing.nonce : mintNonce();
    const today = Temporal.Now.plainDateISO(timezone);
    const anchor = existing?.anchor_date || today.subtract({ days: today.dayOfWeek - 1 }).toString();
    db.prepare(`INSERT INTO calendar_publications(user_id,enabled,nonce,token_hash,title,timezone,layers,include_deadlines,anchor_date,updated_at)
      VALUES(?,1,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=1,nonce=excluded.nonce,token_hash=excluded.token_hash,
      title=excluded.title,timezone=excluded.timezone,layers=excluded.layers,include_deadlines=excluded.include_deadlines,
      revision=calendar_publications.revision+1,updated_at=excluded.updated_at`).run(
      req.user.id, nonce, hash(tokenFor({ user_id: req.user.id, nonce })), title.trim(), timezone,
      JSON.stringify([...new Set(layers)]), Number(include_deadlines), anchor, new Date().toISOString());
    res.set('Cache-Control', 'no-store').json(response(get(req.user.id)));
  });
  app.delete('/api/calendar/publish', auth, (req, res) => {
    db.prepare('UPDATE calendar_publications SET enabled=0 WHERE user_id=?').run(req.user.id);
    res.status(204).end();
  });
  app.get('/api/calendar/feeds/:token.ics', (req, res) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    const token = req.params.token;
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(404).end();
    const profile = db.prepare('SELECT * FROM calendar_publications WHERE enabled=1 AND token_hash=?').get(hash(token));
    if (!profile || !timingSafeEqual(Buffer.from(token), Buffer.from(tokenFor(profile)))) return res.status(404).end();
    try {
      const events = db.prepare(`SELECT e.*,i.feed_uid,i.sequence,i.modified FROM calendar_events e
        JOIN calendar_feed_identity i ON i.event_id=e.id WHERE e.user_id=? ORDER BY e.id`).all(profile.user_id);
      const fixed = db.prepare("SELECT * FROM availability WHERE user_id=? AND kind='fixed'").all(profile.user_id);
      const deadlines = db.prepare("SELECT * FROM workspace_scratch WHERE user_id=? AND kind='deadline'").all(profile.user_id);
      res.set('Content-Disposition', 'inline; filename="weeklyboard.ics"').type('text/calendar').send(buildPublishedCalendar(profile, events, fixed, deadlines));
    } catch {
      // Do not log the token, event text, or subscribed source URLs on errors.
      res.status(503).json({ error: '日历暂时无法生成，请稍后重试' });
    }
  });
}
