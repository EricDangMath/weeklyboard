export function getDeadlines(db, userId) {
  const manual = db.prepare("SELECT * FROM workspace_scratch WHERE user_id=? AND kind='deadline'").all(userId).flatMap((row) => {
    try { return [{ ...JSON.parse(row.payload_json), __scratchId: row.id, entity_key: row.entity_key, weekKey: row.week_key }]; } catch { return []; }
  });
  const subscribed = db.prepare(`SELECT e.*,s.name AS subscription_name,s.timezone FROM calendar_events e
    LEFT JOIN calendar_subscriptions s ON s.id=e.subscription_id AND s.user_id=e.user_id
    WHERE e.user_id=? AND e.deadline_kind IS NOT NULL`).all(userId).map((row) => ({
    id: `calendar-deadline-${row.id}`, event_id: row.id, subscription_id: row.subscription_id,
    text: row.title, kind: row.deadline_kind_override || row.deadline_kind,
    date: row.external_date, weekKey: row.week_key, day: row.day, due_minute: row.due_minute,
    description: row.description, course: row.course, url: row.event_url,
    layer: row.layer, completed: Boolean(row.deadline_completed), subscription_name: row.subscription_name, timezone: row.timezone,
  }));
  return [...manual, ...subscribed].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.due_minute ?? 1440) - (b.due_minute ?? 1440) || String(a.id).localeCompare(String(b.id)));
}

export function registerDeadlines(app, db, auth) {
  app.get('/api/calendar/deadlines', auth, (req, res) => res.json(getDeadlines(db, req.user.id)));
  app.patch('/api/calendar/deadlines/:id', auth, (req, res) => {
    const row = db.prepare('SELECT * FROM calendar_events WHERE id=? AND user_id=? AND deadline_kind IS NOT NULL').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: '截止提醒不存在' });
    const { completed, kind } = req.body || {};
    if ((completed !== undefined && typeof completed !== 'boolean') || (kind !== undefined && !['hw', 'exam', null].includes(kind))) return res.status(400).json({ error: '提醒状态或类型无效' });
    db.prepare('UPDATE calendar_events SET deadline_completed=?,deadline_kind_override=? WHERE id=? AND user_id=?').run(completed === undefined ? row.deadline_completed : Number(completed), kind === undefined ? row.deadline_kind_override : kind, row.id, req.user.id);
    res.json(getDeadlines(db, req.user.id).find((item) => item.event_id === row.id));
  });
}
