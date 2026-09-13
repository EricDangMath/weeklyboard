import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { registerAvailability } from './availability.js';
import { deterministicSchedule } from './scheduler.js';
import { registerCalendar } from './calendar.js';
import { registerDebugAuth } from './debug.js';
import { registerConfirmation } from './confirmation.js';

const serverDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(serverDir, '.env') });

const app = express();
const dbFile = process.env.DB_FILE
  ? resolve(serverDir, process.env.DB_FILE)
  : resolve(serverDir, 'weeklyboard.db');
const db = new Database(dbFile);
const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

app.use(cors());
app.use(express.json({ limit: '1mb' }));
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    deadline TEXT,
    priority INTEGER DEFAULT 3,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    estimate_minutes INTEGER DEFAULT 30,
    due_date TEXT,
    priority INTEGER DEFAULT 3,
    status TEXT DEFAULT 'todo'
  );
  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    day TEXT NOT NULL,
    start_minute INTEGER NOT NULL,
    end_minute INTEGER NOT NULL,
    locked INTEGER DEFAULT 0,
    category TEXT DEFAULT 'other',
    description TEXT DEFAULT '',
    layer TEXT DEFAULT 'actual',
    week_key TEXT,
    repeat_rule TEXT,
    source TEXT DEFAULT 'calendar'
  );
  CREATE TABLE IF NOT EXISTS workspace_scratch (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    week_key TEXT NOT NULL,
    entity_key TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS plan_runs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    project_id INTEGER,
    summary TEXT,
    created_at TEXT NOT NULL
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Idempotent migrations for databases created by earlier weeklyboard builds.
for (const [column, definition] of [
  ['category', "TEXT DEFAULT 'other'"],
  ['description', "TEXT DEFAULT ''"],
  ['layer', "TEXT DEFAULT 'actual'"],
  ['week_key', 'TEXT'],
  ['repeat_rule', 'TEXT'],
  ['source', "TEXT DEFAULT 'calendar'"],
]) ensureColumn('calendar_events', column, definition);
ensureColumn('workspace_scratch', 'entity_key', "TEXT DEFAULT ''");

function parsePayload(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

// The old scratch endpoint appended a row on every edit. Give every row a stable
// key and remove only exact duplicate identities before adding the unique index.
const legacyScratch = db.prepare('SELECT id,user_id,kind,week_key,entity_key,payload_json FROM workspace_scratch ORDER BY id').all();
const updateScratch = db.prepare('UPDATE workspace_scratch SET entity_key=?, payload_json=? WHERE id=?');
const deleteScratch = db.prepare('DELETE FROM workspace_scratch WHERE id=?');
const seenScratch = new Set();
for (const row of legacyScratch) {
  const payload = parsePayload(row.payload_json);
  const key = String(row.entity_key || payload.entity_key || payload.id || payload.key || `legacy-${row.id}`).slice(0, 160);
  if (row.entity_key !== key || !payload.entity_key) {
    updateScratch.run(key, JSON.stringify({ ...payload, entity_key: key }), row.id);
  }
  const identity = `${row.user_id}:${row.kind}:${row.week_key}:${key}`;
  if (seenScratch.has(identity)) deleteScratch.run(row.id);
  else seenScratch.add(identity);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS workspace_scratch_identity ON workspace_scratch(user_id,kind,week_key,entity_key)');

const nowIso = () => new Date().toISOString();
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const issueToken = (user) => jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: '7d' });
const auth = (req, res, next) => {
  try {
    const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    req.user = jwt.verify(raw, secret);
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
};

app.get('/api/health', (req, res) => res.json({
  ok: true,
  service: 'weeklyboard-api',
  version: '0.3.0',
  debugMode: process.env.DEBUG_MODE === 'true',
}));

app.post('/api/auth/register', (req, res) => {
  const email = text(req.body?.email, 120).toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || password.length < 8) return res.status(400).json({ error: 'valid email and 8+ char password required' });
  try {
    const result = db.prepare('INSERT INTO users(email,password_hash,created_at) VALUES(?,?,?)')
      .run(email, bcrypt.hashSync(password, 12), nowIso());
    res.status(201).json({ token: issueToken({ id: result.lastInsertRowid, email }), user: { id: result.lastInsertRowid, email } });
  } catch {
    res.status(409).json({ error: 'email already exists' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const email = text(req.body?.email, 120).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(String(req.body?.password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  res.json({ token: issueToken(user), user: { id: user.id, email: user.email } });
});

app.get('/api/projects', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC').all(req.user.id));
});

app.post('/api/projects', auth, (req, res) => {
  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO projects(user_id,title,description,deadline,priority,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(req.user.id, text(req.body?.title, 120) || '未命名项目', text(req.body?.description, 2000), req.body?.deadline || null, Number(req.body?.priority) || 3, timestamp, timestamp);
  res.status(201).json(db.prepare('SELECT * FROM projects WHERE id=?').get(result.lastInsertRowid));
});

app.patch('/api/projects/:id', auth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const fields = [];
  const values = [];
  for (const key of ['title', 'description', 'deadline', 'priority']) {
    if (req.body?.[key] === undefined) continue;
    if (key === 'title' && !text(req.body[key], 120)) return res.status(400).json({ error: 'title required' });
    fields.push(`${key}=?`);
    values.push(key === 'title' ? text(req.body[key], 120) : req.body[key]);
  }
  if (!fields.length) return res.status(400).json({ error: 'no changes' });
  fields.push('updated_at=?');
  values.push(nowIso(), project.id);
  db.prepare(`UPDATE projects SET ${fields.join(',')} WHERE id=?`).run(...values);
  res.json(db.prepare('SELECT * FROM projects WHERE id=?').get(project.id));
});

app.delete('/api/projects/:id', auth, (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  db.transaction(() => {
    db.prepare('DELETE FROM tasks WHERE project_id=?').run(project.id);
    db.prepare('DELETE FROM projects WHERE id=?').run(project.id);
  })();
  res.status(204).end();
});

app.get('/api/projects/:id/tasks', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id
    WHERE t.project_id=? AND p.user_id=? ORDER BY t.priority DESC,t.id
  `).all(req.params.id, req.user.id));
});

app.post('/api/projects/:id/tasks', auth, (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const result = db.prepare('INSERT INTO tasks(project_id,title,estimate_minutes,due_date,priority) VALUES(?,?,?,?,?)')
    .run(project.id, text(req.body?.title, 160) || '未命名任务', Math.max(5, Number(req.body?.estimate_minutes) || 30), req.body?.due_date || null, Number(req.body?.priority) || 3);
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id=?').get(result.lastInsertRowid));
});

app.patch('/api/tasks/:id', auth, (req, res) => {
  const task = db.prepare('SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.user_id=?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  const fields = [];
  const values = [];
  for (const key of ['title', 'estimate_minutes', 'due_date', 'priority', 'status']) {
    if (req.body?.[key] === undefined) continue;
    if (key === 'title' && !text(req.body[key], 160)) return res.status(400).json({ error: 'title required' });
    if (key === 'status' && !['todo', 'doing', 'done'].includes(req.body[key])) return res.status(400).json({ error: 'invalid status' });
    fields.push(`${key}=?`);
    values.push(key === 'title' ? text(req.body[key], 160) : req.body[key]);
  }
  if (!fields.length) return res.status(400).json({ error: 'no changes' });
  values.push(task.id);
  db.prepare(`UPDATE tasks SET ${fields.join(',')} WHERE id=?`).run(...values);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id));
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  const task = db.prepare('SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.user_id=?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  db.prepare('DELETE FROM tasks WHERE id=?').run(task.id);
  res.status(204).end();
});

app.get('/api/workspace/scratch', auth, (req, res) => {
  const week = text(req.query.week_key, 20);
  const rows = db.prepare('SELECT * FROM workspace_scratch WHERE user_id=? AND week_key=? ORDER BY updated_at DESC,id DESC').all(req.user.id, week);
  res.json(rows.map((row) => ({ ...row, payload: parsePayload(row.payload_json) })));
});

app.put('/api/workspace/scratch', auth, (req, res) => {
  const kind = text(req.body?.kind, 40);
  const week = text(req.body?.week_key, 20);
  const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
  const entityKey = text(req.body?.entity_key || payload.entity_key || payload.id || payload.key || `${kind}-${Date.now()}`, 160);
  if (!kind || !week || !entityKey) return res.status(400).json({ error: 'kind, week_key and entity_key required' });
  const timestamp = nowIso();
  const json = JSON.stringify({ ...payload, entity_key: entityKey });
  db.prepare(`
    INSERT INTO workspace_scratch(user_id,kind,week_key,entity_key,payload_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id,kind,week_key,entity_key) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at
  `).run(req.user.id, kind, week, entityKey, json, timestamp, timestamp);
  const row = db.prepare('SELECT * FROM workspace_scratch WHERE user_id=? AND kind=? AND week_key=? AND entity_key=?').get(req.user.id, kind, week, entityKey);
  res.status(200).json({ ...row, payload: parsePayload(row.payload_json) });
});

app.delete('/api/workspace/scratch/:id', auth, (req, res) => {
  const result = db.prepare('DELETE FROM workspace_scratch WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'scratch not found' });
  res.status(204).end();
});

app.delete('/api/workspace/scratch', auth, (req, res) => {
  const kind = text(req.query.kind || req.body?.kind, 40);
  const week = text(req.query.week_key || req.body?.week_key, 20);
  const entityKey = text(req.query.entity_key || req.body?.entity_key, 160);
  if (!kind || !week || !entityKey) return res.status(400).json({ error: 'kind, week_key and entity_key required' });
  const result = db.prepare('DELETE FROM workspace_scratch WHERE user_id=? AND kind=? AND week_key=? AND entity_key=?').run(req.user.id, kind, week, entityKey);
  if (!result.changes) return res.status(404).json({ error: 'scratch not found' });
  res.status(204).end();
});

function localPlan(input) {
  const schedule = deterministicSchedule({ tasks: input.tasks || [], fixed: input.fixed || [], windows: input.windows || {} });
  return {
    summary: schedule.summary || `本地排程完成：${schedule.blocks.filter((block) => block.day).length} 个时间块`,
    tasks: input.tasks || [],
    blocks: schedule.blocks.filter((block) => block.day),
    warnings: ['使用本地排程器；配置 DEEPSEEK_API_KEY 后可切换 AI 规划', ...(schedule.warnings || [])],
  };
}

function extractJson(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.blocks)) throw new Error('planner returned invalid blocks');
  const blocks = plan.blocks.map((block) => {
    if (!block || typeof block.title !== 'string' || !DAYS.includes(block.day) ||
        !Number.isInteger(block.start_minute) || !Number.isInteger(block.end_minute) ||
        block.start_minute < 0 || block.end_minute > 1440 || block.start_minute >= block.end_minute) {
      throw new Error('planner returned invalid time block');
    }
    return {
      task_id: block.task_id ?? null,
      title: text(block.title, 200),
      day: block.day,
      start_minute: block.start_minute,
      end_minute: block.end_minute,
      category: text(block.category || block.cat || 'study', 32),
    };
  });
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      if (blocks[i].day === blocks[j].day && blocks[i].start_minute < blocks[j].end_minute && blocks[i].end_minute > blocks[j].start_minute) throw new Error('planner returned overlapping blocks');
    }
  }
  return { summary: text(plan.summary, 2000), tasks: Array.isArray(plan.tasks) ? plan.tasks : [], blocks, warnings: Array.isArray(plan.warnings) ? plan.warnings.map(String).slice(0, 20) : [] };
}

async function deepseekPlan(input) {
  if (!process.env.DEEPSEEK_API_KEY) return localPlan(input);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          temperature: 0.2,
          messages: [
            { role: 'system', content: '你是周计划排程器。只返回 JSON：{"summary":string,"blocks":[{"title":string,"day":string,"start_minute":number,"end_minute":number,"category":string}],"warnings":string[]}' },
            { role: 'user', content: JSON.stringify(input) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`DeepSeek ${response.status}`);
      const body = await response.json();
      return validatePlan(extractJson(body.choices?.[0]?.message?.content || '{}'));
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('DeepSeek unavailable');
}

app.post('/api/plan/deterministic', auth, (req, res) => {
  try {
    let input = req.body || {};
    if (!input.windows || !input.fixed) {
      const rows = db.prepare('SELECT * FROM availability WHERE user_id=?').all(req.user.id);
      input = {
        ...input,
        windows: input.windows || Object.fromEntries(rows.filter((row) => row.kind === 'window').map((row) => [row.day, [row.start_minute, row.end_minute]])),
        fixed: input.fixed || rows.filter((row) => row.kind === 'fixed'),
      };
    }
    res.json(deterministicSchedule(input));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/plan/preview', auth, async (req, res) => {
  try {
    res.json(await deepseekPlan(req.body || {}));
  } catch (error) {
    const fallback = localPlan(req.body || {});
    res.json({ ...fallback, fallback: true, warnings: [...fallback.warnings, `DeepSeek 暂不可用：${error.message}`] });
  }
});

registerConfirmation(app, db, auth);
registerCalendar(app, db, auth);
app.get('/api/calendar', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM calendar_events WHERE user_id=? ORDER BY day,start_minute').all(req.user.id));
});

app.get('/api/review', auth, (req, res) => {
  const tasks = db.prepare('SELECT t.status,t.estimate_minutes FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.user_id=?').all(req.user.id);
  const events = db.prepare('SELECT day,start_minute,end_minute,title FROM calendar_events WHERE user_id=?').all(req.user.id);
  const planned = events.reduce((total, event) => total + event.end_minute - event.start_minute, 0);
  const done = tasks.filter((task) => task.status === 'done').length;
  const dailyLoad = Object.fromEntries(DAYS.map((day) => [day, events.filter((event) => event.day === day).reduce((total, event) => total + event.end_minute - event.start_minute, 0)]));
  res.json({ tasks: { total: tasks.length, done, completion_rate: tasks.length ? done / tasks.length : 0 }, planned_minutes: planned, daily_load: dailyLoad, events: events.length });
});

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function verifyBackup(backup) {
  if (!backup || typeof backup !== 'object' || !backup.tables || typeof backup.sha256 !== 'string') return false;
  return /^[a-f0-9]{64}$/i.test(backup.sha256) && hashJson(backup.tables) === backup.sha256;
}

function makeBackup(userId) {
  const user = db.prepare('SELECT id,email,created_at FROM users WHERE id=?').get(userId);
  const projects = db.prepare('SELECT * FROM projects WHERE user_id=? ORDER BY id').all(userId);
  const projectIds = projects.map((project) => project.id);
  const tasks = projectIds.length
    ? db.prepare(`SELECT * FROM tasks WHERE project_id IN (${projectIds.map(() => '?').join(',')}) ORDER BY id`).all(...projectIds)
    : [];
  const tables = {
    users: user ? [user] : [],
    projects,
    tasks,
    calendar_events: db.prepare('SELECT * FROM calendar_events WHERE user_id=? ORDER BY id').all(userId),
    availability: db.prepare('SELECT * FROM availability WHERE user_id=? ORDER BY day,start_minute').all(userId),
    workspace_scratch: db.prepare('SELECT * FROM workspace_scratch WHERE user_id=? ORDER BY id').all(userId).map((row) => ({ ...row, payload: parsePayload(row.payload_json) })),
    plan_runs: db.prepare('SELECT * FROM plan_runs WHERE user_id=? ORDER BY id').all(userId),
  };
  return { schemaVersion: 3, backupVersion: 1, generatedAt: nowIso(), tables, sha256: hashJson(tables) };
}

app.get('/api/backup', auth, (req, res) => res.json(makeBackup(req.user.id)));

app.post('/api/backup/restore', auth, (req, res) => {
  const backup = req.body?.backup || req.body;
  const tables = backup?.tables;
  if (!tables || !Array.isArray(tables.projects) || !Array.isArray(tables.tasks) || !Array.isArray(tables.calendar_events)) return res.status(400).json({ error: 'invalid backup' });
  if (!verifyBackup(backup)) return res.status(400).json({ error: 'backup checksum mismatch' });
  const restore = db.transaction(() => {
    db.prepare('DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id=?)').run(req.user.id);
    db.prepare('DELETE FROM projects WHERE user_id=?').run(req.user.id);
    db.prepare('DELETE FROM calendar_events WHERE user_id=?').run(req.user.id);
    db.prepare('DELETE FROM availability WHERE user_id=?').run(req.user.id);
    db.prepare('DELETE FROM workspace_scratch WHERE user_id=?').run(req.user.id);
    db.prepare('DELETE FROM plan_runs WHERE user_id=?').run(req.user.id);
    const insertProject = db.prepare('INSERT INTO projects(id,user_id,title,description,deadline,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    for (const project of tables.projects) insertProject.run(project.id, req.user.id, text(project.title, 120), text(project.description, 2000), project.deadline || null, Number(project.priority) || 3, project.created_at || nowIso(), project.updated_at || nowIso());
    const insertTask = db.prepare('INSERT INTO tasks(id,project_id,title,estimate_minutes,due_date,priority,status) VALUES(?,?,?,?,?,?,?)');
    for (const task of tables.tasks) insertTask.run(task.id, task.project_id, text(task.title, 160), Number(task.estimate_minutes) || 30, task.due_date || null, Number(task.priority) || 3, ['todo', 'doing', 'done'].includes(task.status) ? task.status : 'todo');
    const insertEvent = db.prepare('INSERT INTO calendar_events(id,user_id,title,day,start_minute,end_minute,locked,category,description,layer,week_key,repeat_rule,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const event of tables.calendar_events) insertEvent.run(event.id, req.user.id, text(event.title, 200), event.day, Number(event.start_minute), Number(event.end_minute), event.locked ? 1 : 0, text(event.category || 'other', 32), text(event.description, 2000), text(event.layer || 'actual', 32), event.week_key || null, event.repeat_rule || null, text(event.source || 'calendar', 32));
    const insertAvailability = db.prepare('INSERT INTO availability(user_id,day,start_minute,end_minute,kind,title) VALUES(?,?,?,?,?,?)');
    for (const row of tables.availability || []) insertAvailability.run(req.user.id, row.day, Number(row.start_minute), Number(row.end_minute), row.kind, text(row.title, 120));
    const insertScratch = db.prepare('INSERT INTO workspace_scratch(id,user_id,kind,week_key,entity_key,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    for (const row of tables.workspace_scratch || []) {
      const payload = row.payload || parsePayload(row.payload_json);
      const key = text(row.entity_key || payload.entity_key || payload.id || payload.key || `row-${row.id}`, 160);
      insertScratch.run(row.id, req.user.id, text(row.kind, 40), text(row.week_key, 20), key, JSON.stringify({ ...payload, entity_key: key }), row.created_at || nowIso(), row.updated_at || nowIso());
    }
    const insertPlan = db.prepare('INSERT INTO plan_runs(id,user_id,project_id,summary,created_at) VALUES(?,?,?,?,?)');
    for (const run of tables.plan_runs || []) insertPlan.run(run.id, req.user.id, run.project_id || null, text(run.summary, 2000), run.created_at || nowIso());
  });
  try {
    restore();
    res.json({ restored: true, backupVersion: backup.backupVersion || null });
  } catch (error) {
    res.status(400).json({ error: 'backup_restore_failed', detail: error.message });
  }
});

registerAvailability(app, db, auth);
registerDebugAuth(app, db, issueToken);

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(error);
  res.status(500).json({ error: 'internal_error' });
});

const requestedPort = Number(process.env.PORT || 8787);
const listener = app.listen(requestedPort, '127.0.0.1', () => {
  const actualPort = listener.address()?.port ?? requestedPort;
  console.log(`weeklyboard api listening ${actualPort}`);
});
