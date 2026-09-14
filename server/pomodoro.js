import { createHash } from 'node:crypto';

export const POMODORO_MINUTES = 30;
export const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const validWeek = (value) => /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value || '');
const units = (minutes) => Math.floor(Math.max(0, minutes) / POMODORO_MINUTES);
const capacity = (minutes) => Math.ceil(Math.max(0, minutes) / POMODORO_MINUTES);
const duration = (ranges) => ranges.reduce((sum, [start, end]) => sum + end - start, 0);
const json = (value) => { try { return JSON.parse(value); } catch { return {}; } };

export function mergeRanges(events) {
  const result = [];
  for (const range of events.map((event) => Array.isArray(event) ? [...event] : [Number(event.start_minute), Number(event.end_minute)]).filter(([start, end]) => start >= 0 && end <= 1440 && end > start).sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else result.push(range);
  }
  return result;
}

function subtractRanges(ranges, occupied) {
  let result = ranges;
  for (const [start, end] of occupied) result = result.flatMap(([a, b]) => end <= a || start >= b ? [[a, b]] : [[a, Math.min(b, start)], [Math.max(a, end), b]].filter(([x, y]) => y > x));
  return result;
}

export function summarizePomodoros(tasks, events, targets = {}) {
  const groups = new Map(tasks.map((task) => [`task:${task.id}`, { key: `task:${task.id}`, task_id: task.id, title: task.title, category: 'other', project: task.project_title, estimate: Number(task.estimate_minutes) || 0, events: [] }]));
  for (const event of events) {
    if (event.layer === 'fixed' || event.all_day) continue;
    const matches = event.task_id == null ? tasks.filter((task) => task.title === event.title) : tasks.filter((task) => task.id === event.task_id);
    const task = matches.length === 1 ? matches[0] : null;
    const category = event.category || 'other';
    const key = task ? `task:${task.id}` : `event:${createHash('sha256').update(JSON.stringify([event.title, category])).digest('hex')}`;
    if (!groups.has(key)) groups.set(key, { key, task_id: null, title: event.title, category, project: '', estimate: 0, events: [] });
    const group = groups.get(key);
    group.events.push(event);
    if (group.category === 'other') group.category = category;
  }
  const rows = [...groups.values()].map((group) => {
    const daily = DAYS.map((day) => {
      const events = group.events.filter((event) => event.day === day);
      const planned = mergeRanges(events.filter((event) => event.layer !== 'actual'));
      const actual = mergeRanges(events.filter((event) => event.layer === 'actual'));
      const plannedMinutes = duration(planned), actualMinutes = duration(actual);
      return { day, planned_minutes: plannedMinutes, actual_minutes: actualMinutes, planned_units: capacity(plannedMinutes), actual_units: units(actualMinutes), boxes: Math.max(capacity(plannedMinutes), capacity(actualMinutes)), allocated_minutes: duration(mergeRanges([...planned, ...actual])) };
    });
    const plannedMinutes = daily.reduce((sum, day) => sum + day.planned_minutes, 0);
    const actualMinutes = daily.reduce((sum, day) => sum + day.actual_minutes, 0);
    const minimum = capacity(plannedMinutes);
    const target = Number.isInteger(targets[group.key]) ? targets[group.key] : Math.max(capacity(group.estimate), minimum);
    const planUnits = Math.max(minimum, target);
    const allocated = daily.reduce((sum, day) => sum + day.allocated_minutes, 0);
    const { events, estimate, ...identity } = group;
    return { ...identity, daily, plan_units: planUnits, minimum_units: minimum, actual_units: units(actualMinutes), actual_minutes: actualMinutes, pending_units: capacity(planUnits * 30 - allocated), percent: planUnits ? Math.round(actualMinutes / (planUnits * 30) * 100) : 0, complete: planUnits > 0 && actualMinutes >= planUnits * 30, event_ids: events.map((event) => event.id) };
  });
  const plan = rows.reduce((sum, row) => sum + row.plan_units, 0);
  const actual = rows.reduce((sum, row) => sum + row.actual_minutes, 0);
  const daily = DAYS.map((day, index) => {
    const planned = rows.reduce((sum, row) => sum + row.daily[index].planned_minutes, 0);
    const done = rows.reduce((sum, row) => sum + row.daily[index].actual_minutes, 0);
    return { day, plan_units: capacity(planned), actual_units: units(done), percent: planned ? Math.round(done / planned * 100) : 0 };
  });
  return { rows, daily, total: { plan_units: plan, actual_units: units(actual), actual_minutes: actual, pending_units: rows.reduce((sum, row) => sum + row.pending_units, 0), percent: plan ? Math.round(actual / (plan * 30) * 100) : 0 } };
}

export function registerPomodoro(app, db, auth) {
  const getTasks = (userId) => db.prepare('SELECT t.*,p.title AS project_title FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.user_id=? ORDER BY p.id,t.id').all(userId);
  const getEvents = (userId, week) => db.prepare("SELECT * FROM calendar_events WHERE user_id=? AND (week_key=? OR week_key IS NULL OR (repeat_rule='weekly' AND layer<>'actual')) ORDER BY day,start_minute,id").all(userId, week);
  const setScratch = (userId, kind, week, key, payload) => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO workspace_scratch(user_id,kind,week_key,entity_key,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(user_id,kind,week_key,entity_key) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`).run(userId, kind, week, key, JSON.stringify(payload), now, now);
  };
  const summary = (userId, week) => {
    const targets = Object.fromEntries(db.prepare("SELECT entity_key,payload_json FROM workspace_scratch WHERE user_id=? AND kind='pomodoro-plan' AND week_key=?").all(userId, week).map((row) => [row.entity_key, json(row.payload_json).units]));
    const setting = db.prepare("SELECT payload_json FROM workspace_scratch WHERE user_id=? AND kind='preferences' AND week_key='settings' AND entity_key='pomodoro'").get(userId);
    return { ...summarizePomodoros(getTasks(userId), getEvents(userId, week), targets), enabled: setting ? json(setting.payload_json).enabled !== false : true, week_key: week };
  };
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

  // Checkmarks edit the actual calendar itself. There is no second completion counter.
  const setActual = (userId, week, row, day, target) => {
    const events = getEvents(userId, week).filter((event) => row.event_ids.includes(event.id) && event.day === day);
    const actual = events.filter((event) => event.layer === 'actual');
    const ranges = mergeRanges(actual);
    const current = duration(ranges);
    if (current === target) return;
    if (actual.some((event) => event.week_key === null || event.repeat_rule)) fail(409, '请先在日程编辑中把该实际记录设为仅本周，再调整番茄钟');
    if (target < current) {
      let left = target, cutoff = 0;
      for (const [start, end] of ranges) {
        cutoff = start + Math.min(left, end - start);
        left -= Math.min(left, end - start);
        if (!left) break;
      }
      for (const event of actual) {
        if (event.start_minute >= cutoff) db.prepare('DELETE FROM calendar_events WHERE id=? AND user_id=?').run(event.id, userId);
        else if (event.end_minute > cutoff) db.prepare('UPDATE calendar_events SET end_minute=? WHERE id=? AND user_id=?').run(cutoff, event.id, userId);
      }
      return;
    }
    const planned = mergeRanges(events.filter((event) => event.layer !== 'actual'));
    const occupied = mergeRanges(getEvents(userId, week).filter((event) => event.layer === 'actual' && event.day === day));
    let needed = target - current;
    const additions = [];
    const take = (available) => {
      for (const [start, end] of available) {
        if (!needed) break;
        const count = Math.min(needed, end - start);
        additions.push([start, start + count]);
        needed -= count;
      }
    };
    take(subtractRanges(planned, occupied));
    take(subtractRanges([[540, 1380], [0, 540], [1380, 1440]], mergeRanges([...occupied, ...additions])));
    if (needed) fail(409, '当天没有足够的空闲时间，请先调整实际日程');
    const insert = db.prepare("INSERT INTO calendar_events(user_id,title,day,start_minute,end_minute,category,description,layer,week_key,source,task_id) VALUES(?,?,?,?,?,?,?,'actual',?,'pomodoro',?)");
    for (const [start, end] of additions) insert.run(userId, row.title, day, start, end, row.category, '', week, row.task_id);
  };

  app.get('/api/pomodoro', auth, (req, res) => {
    if (!validWeek(req.query.week_key)) return res.status(400).json({ error: 'invalid week_key' });
    res.json(summary(req.user.id, req.query.week_key));
  });
  app.put('/api/pomodoro/settings', auth, (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
    setScratch(req.user.id, 'preferences', 'settings', 'pomodoro', { enabled: req.body.enabled });
    res.json({ enabled: req.body.enabled });
  });
  app.put('/api/pomodoro/:action', auth, (req, res, next) => {
    try {
      const result = db.transaction(() => {
        const { week_key: week, group_key: key } = req.body || {};
        if (!validWeek(week)) fail(400, 'invalid week_key');
        const before = summary(req.user.id, week);
        const row = before.rows.find((row) => row.key === key);
        if (!row) fail(404, 'task not found');
        if (req.params.action === 'plan') {
          const amount = req.body.units;
          if (!Number.isInteger(amount) || amount < 0 || amount > 336) fail(400, '计划必须是 0 到 336 之间的整数');
          if (amount < row.minimum_units) fail(400, `计划不能少于日程表已安排的 ${row.minimum_units} 个番茄钟`);
          setScratch(req.user.id, 'pomodoro-plan', week, key, { units: amount });
        } else if (req.params.action === 'check') {
          const { day, target_minutes: target, expected_minutes: expected } = req.body;
          if (!DAYS.includes(day) || !Number.isInteger(target) || target < 0 || target > 1440 || !Number.isInteger(expected)) fail(400, 'invalid completion');
          const actual = row.daily[DAYS.indexOf(day)].actual_minutes;
          if (actual !== expected && actual !== target) fail(409, '实际记录已变化，请刷新后再操作');
          setActual(req.user.id, week, row, day, target);
        } else if (req.params.action === 'complete') {
          if (typeof req.body.completed !== 'boolean' || !DAYS.includes(req.body.day)) fail(400, 'invalid completion');
          if (!req.body.completed) {
            for (const day of row.daily) setActual(req.user.id, week, row, day.day, 0);
          } else {
            let left = Math.max(0, row.plan_units * 30 - row.actual_minutes);
            for (const day of row.daily) {
              const extra = Math.min(left, Math.max(0, day.planned_minutes - day.actual_minutes));
              if (extra) setActual(req.user.id, week, row, day.day, day.actual_minutes + extra);
              left -= extra;
            }
            if (left) {
              const updated = summary(req.user.id, week).rows.find((item) => item.key === key);
              const current = updated.daily[DAYS.indexOf(req.body.day)].actual_minutes;
              if (current + left > 1440) fail(400, '当天无法容纳剩余时间，请分天记录');
              setActual(req.user.id, week, updated, req.body.day, current + left);
            }
          }
        } else fail(404, 'unknown action');
        return summary(req.user.id, week);
      })();
      res.json(result);
    } catch (error) {
      if (error.status) res.status(error.status).json({ error: error.message });
      else next(error);
    }
  });
}
