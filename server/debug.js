import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

const DEBUG_EMAIL = 'debug@weeklyboard.local';
const DEMO_PROJECT = '本周执行清单';
const DEMO_TASKS = [
  ['梳理本周目标', 45, 5],
  ['完成第一项交付', 90, 4],
  ['整理复盘记录', 30, 3],
];

export function registerDebugAuth(app, db, issueToken) {
  const enabled = process.env.DEBUG_MODE === 'true';

  app.get('/api/auth/debug', (req, res) => {
    if (!enabled) return res.status(404).json({ error: 'debug_mode_disabled' });

    const now = new Date().toISOString();
    const ensureWorkspace = db.transaction(() => {
      let user = db.prepare('SELECT id, email FROM users WHERE email=?').get(DEBUG_EMAIL);
      if (!user) {
        const result = db.prepare(
          'INSERT INTO users(email,password_hash,created_at) VALUES(?,?,?)'
        ).run(DEBUG_EMAIL, bcrypt.hashSync(randomBytes(32).toString('hex'), 10), now);
        user = { id: Number(result.lastInsertRowid), email: DEBUG_EMAIL };
      }

      let project = db.prepare(
        'SELECT * FROM projects WHERE user_id=? AND title=?'
      ).get(user.id, DEMO_PROJECT);
      if (!project) {
        const result = db.prepare(
          'INSERT INTO projects(user_id,title,description,deadline,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
        ).run(user.id, DEMO_PROJECT, '用于快速体验周看板的调试项目', null, 5, now, now);
        project = db.prepare('SELECT * FROM projects WHERE id=?').get(result.lastInsertRowid);
      }

      const taskCount = db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE project_id=?').get(project.id).count;
      if (!taskCount) {
        const insert = db.prepare(
          'INSERT INTO tasks(project_id,title,estimate_minutes,priority,status) VALUES(?,?,?,?,?)'
        );
        for (const [title, estimate, priority] of DEMO_TASKS) {
          insert.run(project.id, title, estimate, priority, 'todo');
        }
      }
      return { user, project };
    })();

    res.json({
      debugMode: true,
      token: issueToken(ensureWorkspace.user),
      user: ensureWorkspace.user,
      demo: { projectId: ensureWorkspace.project.id, projectTitle: ensureWorkspace.project.title },
    });
  });
}
