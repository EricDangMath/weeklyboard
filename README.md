# 周看板 2.0

## 开发启动

```bash
npm install
npm run dev
```

另开终端启动 API：

```bash
npm install --prefix server
npm run dev --prefix server
```

服务端默认运行在 `http://127.0.0.1:8787`，前端由 Vite 提供。

当前工作区已启用本地 `DEBUG_MODE=true`：打开前端会自动申请 `debug@weeklyboard.local` 调试会话并加载 SQL 中的演示项目，无需先注册。该配置位于被 `.gitignore` 忽略的 `server/.env`，部署时请显式设为 `DEBUG_MODE=false`。

## 配置

复制 `server/.env.example` 为 `server/.env`，设置：

- `DEEPSEEK_API_KEY`：启用 DeepSeek 规划；留空时使用本地确定性排程
- `JWT_SECRET`：账号令牌签名密钥
- `DB_FILE`：SQLite 文件路径
- `PORT`：API 端口
- `DEBUG_MODE`：本地调试开关。设为 `true` 后前端会自动申请调试会话，不需要注册；生产环境应设为 `false`

API Key 只在服务端读取，前端不会接触供应商密钥。
账号、项目、任务和排程数据都写入 SQL 数据库；密码只保存为 bcrypt 哈希，前端只保留短期 JWT 会话令牌，不保存明文密码。

## 验证

```bash
npm test
npm run build
```

## 核心 API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET/POST /api/projects`
- `GET/POST /api/projects/:id/tasks`
- `PATCH/DELETE /api/tasks/:id`
- `POST /api/plan/preview`
- `POST /api/plan/deterministic`
- `POST /api/plan/confirm`
- `GET /api/calendar`
- `GET /api/calendar.ics`
- `POST /api/calendar/import`
- `GET/PUT /api/availability`
- `GET /api/review`
- `GET/PUT/DELETE /api/workspace/scratch*` — 收件箱、贴纸与涂色的 SQL 草稿存储（按 `kind + week_key + entity_key` 幂等）
- `GET /api/backup` / `POST /api/backup/restore` — 带 schema 版本和 SHA-256 的 SQL 备份与事务恢复
