import { MOOD_BY_ID, validMoodDate } from '../src/mood-data.mjs';

// Mood records share the account-scoped scratch store, including its SQL backup/restore.
export function registerCalendarMoods(app, db, auth) {
  const select = db.prepare("SELECT payload_json FROM workspace_scratch WHERE user_id=? AND kind='mood' AND week_key='calendar' AND entity_key=?");
  const remove = db.prepare("DELETE FROM workspace_scratch WHERE user_id=? AND kind='mood' AND week_key='calendar' AND entity_key=?");
  const upsert = db.prepare(`INSERT INTO workspace_scratch(user_id,kind,week_key,entity_key,payload_json,created_at,updated_at)
    VALUES(?,'mood','calendar',?,?,?,?)
    ON CONFLICT(user_id,kind,week_key,entity_key) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`);
  const read = (row) => { try { return JSON.parse(row.payload_json); } catch { return null; } };

  app.get('/api/calendar/moods', auth, (req, res) => {
    const { from, to } = req.query;
    if (!validMoodDate(from) || !validMoodDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 366) {
      return res.status(400).json({ error: '请选择有效的日期范围（最多一年）' });
    }
    const rows = db.prepare("SELECT payload_json FROM workspace_scratch WHERE user_id=? AND kind='mood' AND week_key='calendar' AND entity_key BETWEEN ? AND ? ORDER BY entity_key").all(req.user.id, from, to);
    res.set('Cache-Control', 'no-store').json(rows.map(read).filter((item) => item && validMoodDate(item.date) && Object.hasOwn(MOOD_BY_ID, item.mood))
      .map(({ date, mood }) => ({ date, mood })));
  });

  app.put('/api/calendar/moods/:date', auth, (req, res) => {
    const date = req.params.date;
    const { mood, from_date: fromDate } = req.body || {};
    if (!validMoodDate(date) || typeof mood !== 'string' || !Object.hasOwn(MOOD_BY_ID, mood) || (fromDate !== undefined && !validMoodDate(fromDate))) {
      return res.status(400).json({ error: '请选择有效的日期和心情' });
    }
    const record = { date, mood };
    const saved = db.transaction(() => {
      if (fromDate && fromDate !== date) {
        const source = select.get(req.user.id, fromDate);
        if (!source || read(source)?.mood !== mood) return false;
      }
      const now = new Date().toISOString();
      upsert.run(req.user.id, date, JSON.stringify(record), now, now);
      if (fromDate && fromDate !== date) remove.run(req.user.id, fromDate);
      return true;
    })();
    if (!saved) return res.status(409).json({ error: '原日期的心情已更改，请刷新后重试' });
    res.json(record);
  });

  app.delete('/api/calendar/moods/:date', auth, (req, res) => {
    if (!validMoodDate(req.params.date)) return res.status(400).json({ error: '日期无效' });
    remove.run(req.user.id, req.params.date);
    res.status(204).end();
  });
}
