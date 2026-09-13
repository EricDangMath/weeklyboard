const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function registerConfirmation(app, db, auth) {
  db.exec(`CREATE TABLE IF NOT EXISTS plan_receipts (
    user_id INTEGER NOT NULL, request_key TEXT NOT NULL,
    payload TEXT NOT NULL, result TEXT NOT NULL,
    PRIMARY KEY (user_id, request_key)
  )`);

  const confirm = db.transaction((userId, body) => {
    const { project_id: projectId, request_key: key, blocks } = body;
    const weekKey = body.week_key ?? body.weekKey ?? null;
    if (!Number.isInteger(projectId) || !db.prepare(
      'SELECT id FROM projects WHERE id=? AND user_id=?'
    ).get(projectId, userId)) return { status: 404, error: 'project not found' };
    if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(key)) {
      return { status: 400, error: 'valid request_key required' };
    }
    if (weekKey !== null && (typeof weekKey !== 'string' || !/^\d{4}-W\d{2}$/.test(weekKey))) {
      return { status: 400, error: 'invalid week_key' };
    }
    if (!Array.isArray(blocks) || !blocks.length || blocks.length > 200) {
      return { status: 400, error: '1 to 200 blocks required' };
    }
    const normalized = [];
    for (const block of blocks) {
      if (!block || typeof block.title !== 'string' || !block.title.trim() ||
          block.title.length > 200 || !DAYS.includes(block.day) ||
          !Number.isInteger(block.start_minute) || !Number.isInteger(block.end_minute) ||
          block.start_minute < 0 || block.end_minute > 1440 ||
          block.start_minute >= block.end_minute) {
        return { status: 400, error: 'invalid calendar block' };
      }
      normalized.push({
        title: block.title.trim(),
        day: block.day,
        start_minute: block.start_minute,
        end_minute: block.end_minute,
        category: String(block.category || block.cat || 'study').slice(0, 32),
        description: typeof block.description === 'string' ? block.description.slice(0, 2000) : '',
      });
    }
    const summary = typeof body.summary === 'string' ? body.summary.slice(0, 2000) : '';
    const payload = JSON.stringify({ projectId, weekKey, summary, blocks: normalized });
    const receipt = db.prepare('SELECT * FROM plan_receipts WHERE user_id=? AND request_key=?').get(userId, key);
    if (receipt) return receipt.payload === payload
      ? { status: 200, ...JSON.parse(receipt.result), replayed: true }
      : { status: 409, error: 'request key already used for another plan' };

    const occupied = db.prepare('SELECT * FROM calendar_events WHERE user_id=?').all(userId);
    for (const block of normalized) {
      if (occupied.some(e => {
        const sameWeek = e.week_key === null || weekKey === null || e.week_key === weekKey;
        return sameWeek && e.day === block.day && e.start_minute < block.end_minute && e.end_minute > block.start_minute;
      })) {
        return { status: 409, error: 'calendar conflict; refresh and adjust the draft' };
      }
      occupied.push(block);
    }
    const run = db.prepare('INSERT INTO plan_runs(user_id,project_id,summary,created_at) VALUES(?,?,?,?)')
      .run(userId, projectId, summary, new Date().toISOString());
    const insert = db.prepare(`INSERT INTO calendar_events(
      user_id,title,day,start_minute,end_minute,locked,category,description,layer,week_key,repeat_rule,source
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const block of normalized) insert.run(
      userId,
      block.title,
      block.day,
      block.start_minute,
      block.end_minute,
      0,
      block.category,
      block.description,
      'actual',
      weekKey,
      null,
      'plan',
    );
    const result = { plan_run_id: Number(run.lastInsertRowid), created: normalized.length };
    db.prepare('INSERT INTO plan_receipts(user_id,request_key,payload,result) VALUES(?,?,?,?)')
      .run(userId, key, payload, JSON.stringify(result));
    return { status: 201, ...result };
  });

  app.post('/api/plan/confirm', auth, (req, res, next) => {
    try {
      const { status, ...body } = confirm(req.user.id, req.body || {});
      res.status(status).json(body);
    } catch (error) { next(error); }
  });
}
