import { fetchCalendar, parseCalendar, normalizeFeedUrl, feedError, SYNC_INTERVAL } from './calendar-feed.js';
import { registerDeadlines } from './deadlines.js';

const LAYERS = new Set(['fixed', 'flex', 'once', 'actual']);
const MODES = new Set(['schedule', 'deadlines']);
const defaultMode = (url) => new URL(url).hostname.endsWith('.instructure.com') ? 'deadlines' : 'schedule';

export function registerSubscriptions(app, db, auth, { fetchFeed = fetchCalendar, autoSync = true } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS calendar_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, url TEXT NOT NULL, timezone TEXT NOT NULL,
    last_synced TEXT, last_attempt TEXT, last_error TEXT, event_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id,url)
  )`);
  const subscriptionColumns = db.prepare('PRAGMA table_info(calendar_subscriptions)').all().map((c) => c.name);
  for (const [name, type] of [['layer', "TEXT NOT NULL DEFAULT 'once'"], ['mode', "TEXT NOT NULL DEFAULT 'schedule'"]]) {
    if (!subscriptionColumns.includes(name)) db.exec(`ALTER TABLE calendar_subscriptions ADD COLUMN ${name} ${type}`);
  }
  const columns = db.prepare('PRAGMA table_info(calendar_events)').all().map((c) => c.name);
  for (const [name, type] of [['subscription_id', 'INTEGER REFERENCES calendar_subscriptions(id) ON DELETE SET NULL'], ['external_key', 'TEXT'], ['external_date', 'TEXT'], ['all_day', 'INTEGER NOT NULL DEFAULT 0'], ['deadline_kind', 'TEXT'], ['deadline_kind_override', 'TEXT'], ['due_minute', 'INTEGER'], ['event_url', "TEXT NOT NULL DEFAULT ''"], ['course', "TEXT NOT NULL DEFAULT ''"], ['deadline_completed', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE calendar_events ADD COLUMN ${name} ${type}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS calendar_external_identity ON calendar_events(user_id,source,COALESCE(subscription_id,0),external_key) WHERE external_key IS NOT NULL');
  const active = new Map();
  const safeRow = (row) => ({ id: row.id, name: row.name, host: new URL(row.url).hostname, timezone: row.timezone, last_synced: row.last_synced, last_error: row.last_error, event_count: row.event_count, syncing: active.has(row.id), interval_minutes: SYNC_INTERVAL / 60000, layer: row.layer, mode: row.mode });
  const insert = db.prepare(`INSERT INTO calendar_events(user_id,title,day,start_minute,end_minute,locked,category,description,layer,week_key,source,subscription_id,external_key,external_date,all_day,deadline_kind,due_minute,event_url,course)
    VALUES(@user_id,@title,@day,@start_minute,@end_minute,1,'class',@description,@layer,@week_key,'ics-subscription',@subscription_id,@external_key,@external_date,@all_day,@deadline_kind,@due_minute,@event_url,@course)`);
  const update = db.prepare(`UPDATE calendar_events SET title=@title,day=@day,start_minute=@start_minute,end_minute=@end_minute,description=@description,layer=@layer,week_key=@week_key,external_date=@external_date,all_day=@all_day,deadline_kind=@deadline_kind,due_minute=@due_minute,event_url=@event_url,course=@course WHERE id=@id AND user_id=@user_id`);
  const apply = db.transaction((subscription, parsed) => {
    if (!db.prepare('SELECT id FROM calendar_subscriptions WHERE id=?').get(subscription.id)) return;
    const existing = db.prepare('SELECT * FROM calendar_events WHERE subscription_id=? AND user_id=?').all(subscription.id, subscription.user_id);
    const byKey = new Map(existing.map((e) => [e.external_key, e]));
    const seen = new Set();
    for (const block of parsed.blocks) {
      const values = { deadline_kind: null, due_minute: null, event_url: '', course: '', ...block, layer: subscription.layer, user_id: subscription.user_id, subscription_id: subscription.id, external_date: block.date || null };
      const previous = byKey.get(block.external_key);
      if (previous) update.run({ ...values, id: previous.id }); else insert.run(values);
      seen.add(block.external_key);
    }
    // Rolling school feeds drop past events. Keep that history; reconcile future cancellations.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: subscription.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    for (const old of existing) {
      if (!seen.has(old.external_key) && old.external_date >= today) db.prepare('DELETE FROM calendar_events WHERE id=? AND user_id=?').run(old.id, subscription.user_id);
    }
    db.prepare('UPDATE calendar_subscriptions SET last_synced=?,last_attempt=?,last_error=NULL,event_count=? WHERE id=?').run(new Date().toISOString(), new Date().toISOString(), parsed.blocks.length, subscription.id);
  });
  const sync = (id) => {
    if (active.has(id)) return active.get(id);
    const subscription = db.prepare('SELECT * FROM calendar_subscriptions WHERE id=?').get(id);
    if (!subscription) return Promise.reject(feedError('订阅不存在'));
    const promise = (async () => {
      try {
        const parsed = await parseCalendar(await fetchFeed(subscription.url), { timezone: subscription.timezone, mode: subscription.mode });
        apply(subscription, parsed);
      } catch (error) {
        const message = error.calendarError ? error.message : '日历同步失败，已有日程未改动';
        db.prepare('UPDATE calendar_subscriptions SET last_attempt=?,last_error=? WHERE id=?').run(new Date().toISOString(), message, id);
        throw feedError(message);
      } finally { active.delete(id); }
      const row = db.prepare('SELECT * FROM calendar_subscriptions WHERE id=?').get(id);
      return row ? safeRow(row) : null;
    })();
    active.set(id, promise);
    return promise;
  };
  app.get('/api/calendar/subscriptions', auth, (req, res) => {
    res.json(db.prepare('SELECT * FROM calendar_subscriptions WHERE user_id=? ORDER BY id').all(req.user.id).map(safeRow));
  });
  app.post('/api/calendar/subscriptions', auth, async (req, res) => {
    try {
      const url = normalizeFeedUrl(req.body?.url);
      const timezone = String(req.body?.timezone || 'America/New_York');
      const layer = req.body?.layer || 'once', mode = req.body?.mode || defaultMode(url);
      if (!LAYERS.has(layer) || !MODES.has(mode)) throw feedError('日历图层或用途无效');
      try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw feedError('时区无效'); }
      let row = db.prepare('SELECT * FROM calendar_subscriptions WHERE user_id=? AND url=?').get(req.user.id, url);
      if (row) { await sync(row.id); return res.json(safeRow(db.prepare('SELECT * FROM calendar_subscriptions WHERE id=?').get(row.id))); }
      if (db.prepare('SELECT COUNT(*) AS n FROM calendar_subscriptions WHERE user_id=?').get(req.user.id).n >= 10) throw feedError('最多可添加 10 个日历订阅');
      const parsed = await parseCalendar(await fetchFeed(url), { timezone, mode });
      row = db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO calendar_subscriptions(user_id,name,url,timezone,layer,mode) VALUES(?,?,?,?,?,?)').run(req.user.id, String(req.body?.name || new URL(url).hostname).trim().slice(0, 100), url, timezone, layer, mode);
        const created = db.prepare('SELECT * FROM calendar_subscriptions WHERE user_id=? AND url=?').get(req.user.id, url);
        apply(created, parsed);
        return db.prepare('SELECT * FROM calendar_subscriptions WHERE id=?').get(created.id);
      })();
      res.status(201).json(safeRow(row));
    } catch (error) { res.status(400).json({ error: error.calendarError ? error.message : '订阅失败，已有日程未改动' }); }
  });
  app.patch('/api/calendar/subscriptions/:id', auth, async (req, res) => {
    const row = db.prepare('SELECT * FROM calendar_subscriptions WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: '订阅不存在' });
    const layer = req.body?.layer ?? row.layer, mode = req.body?.mode ?? row.mode;
    if (!LAYERS.has(layer) || !MODES.has(mode)) return res.status(400).json({ error: '日历图层或用途无效' });
    if (active.has(row.id)) return res.status(409).json({ error: '日历正在同步，请稍后再修改图层' });
    const operation = (async () => {
      const parsed = mode !== row.mode ? await parseCalendar(await fetchFeed(row.url), { timezone: row.timezone, mode }) : null;
      return db.transaction(() => {
        if (!db.prepare('SELECT id FROM calendar_subscriptions WHERE id=? AND user_id=?').get(row.id, req.user.id)) throw feedError('订阅已取消');
        db.prepare('UPDATE calendar_subscriptions SET layer=?,mode=? WHERE id=? AND user_id=?').run(layer, mode, row.id, req.user.id);
        db.prepare('UPDATE calendar_events SET layer=? WHERE subscription_id=? AND user_id=?').run(layer, row.id, req.user.id);
        if (parsed) apply({ ...row, layer, mode }, parsed);
        return safeRow(db.prepare('SELECT * FROM calendar_subscriptions WHERE id=?').get(row.id));
      })();
    })();
    active.set(row.id, operation);
    try { const saved = await operation; active.delete(row.id); res.json({ ...saved, syncing: false }); }
    catch (error) { res.status(400).json({ error: error.calendarError ? error.message : '日历设置未能保存，原设置未改动' }); }
    finally { active.delete(row.id); }
  });
  app.post('/api/calendar/subscriptions/:id/sync', auth, async (req, res) => {
    const row = db.prepare('SELECT * FROM calendar_subscriptions WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: '订阅不存在' });
    try { res.json(await sync(row.id)); } catch (error) { res.status(502).json({ error: error.message }); }
  });
  app.delete('/api/calendar/subscriptions/:id', auth, (req, res) => {
    const row = db.prepare('SELECT * FROM calendar_subscriptions WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: '订阅不存在' });
    db.transaction(() => {
      if (req.query.remove_events === 'true') db.prepare('DELETE FROM calendar_events WHERE subscription_id=? AND user_id=?').run(row.id, req.user.id);
      else db.prepare("UPDATE calendar_events SET subscription_id=NULL,external_key=NULL,locked=0,source='calendar' WHERE subscription_id=? AND user_id=?").run(row.id, req.user.id);
      db.prepare('DELETE FROM calendar_subscriptions WHERE id=? AND user_id=?').run(row.id, req.user.id);
    })();
    res.status(204).end();
  });
  const tick = async () => {
    const due = new Date(Date.now() - SYNC_INTERVAL).toISOString();
    const rows = db.prepare('SELECT id FROM calendar_subscriptions WHERE last_attempt IS NULL OR last_attempt<?').all(due);
    for (const row of rows) { try { await sync(row.id); } catch { /* The redacted error is visible in subscription status. */ } }
  };
  let timer, startup;
  if (autoSync) { timer = setInterval(tick, 60000); timer.unref(); startup = setTimeout(tick, 1000); startup.unref(); }
  registerDeadlines(app, db, auth);
  return { sync, stop: () => { clearInterval(timer); clearTimeout(startup); } };
}
