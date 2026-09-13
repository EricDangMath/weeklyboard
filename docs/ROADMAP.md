# 周看板 2.0 产品与技术执行计划

## 定位
周看板 2.0 是一个以周时间轴为核心的个人项目规划系统：用户输入项目目标、任务和日历约束，系统生成可解释的周计划，用户执行后用实际记录反哺下一轮排程。

## 用户主流程
1. 注册/登录 → 创建个人工作区。
2. 新建项目：目标、截止日期、优先级、预计工作量、标签。
3. 导入项目：JSON/CSV/ICS；后续接 Notion、Todoist、Google Calendar。
4. 点击“AI 规划”：服务端把项目、可用时间、固定日程、偏好发送给 DeepSeek。
5. 返回结构化计划草案：任务拆分、时间块、风险、假设、待确认项。
6. 用户确认或调整 → 写入周看板。
7. 执行中记录完成/延迟/实际耗时。
8. 周复盘 → 生成下周排程建议。

## 分阶段交付
### P0：基础工程（当前）
- Vite + React 前端
- Node/Express API 服务
- SQLite 数据层
- 用户、项目、任务、日程、计划版本模型
- DeepSeek OpenAI-compatible 客户端封装（密钥只在服务端）
- `/api/health`、认证、项目 CRUD、AI 规划接口契约

### P1：账号与同步
- 邮箱 + 密码登录、刷新令牌、登出
- 工作区与用户隔离
- 项目/任务/事件增量同步
- 冲突版本号与最后写入时间
- JSON/ICS 导入导出

### P2：AI 规划
- DeepSeek `chat/completions` 适配器
- JSON Schema 约束输出
- 计划草案、解释、风险、假设
- 用户确认后才落库
- 超时、重试、限流和调用日志

### P3：自动排程
- 固定日程锁定
- 可用时间窗口
- 任务优先级、截止日期、依赖关系
- 每日最大负荷、缓冲时间、睡眠约束
- 本地 deterministic 排程器作为 AI 失败时的 fallback

### P4：集成与复盘
- Google/Outlook Calendar OAuth
- Notion/Todoist 项目同步
- 实际耗时和番茄钟
- 周复盘与趋势图
- PWA、移动端单日视图、通知

## 核心数据模型
User、Workspace、Project、Task、CalendarEvent、PlanRun、PlanBlock、Integration、ActivityLog。

## 安全边界
- DeepSeek API Key 仅存在服务端环境变量。
- 前端不接触供应商密钥。
- 所有资源按 workspace_id 做鉴权过滤。
- AI 输出必须经过 schema 校验、时间范围校验和冲突校验。
- 外部日历写入必须经用户确认。

## AI 输入输出
输入：项目目标、任务列表、截止日期、固定事件、可用窗口、用户偏好、上一周复盘。
输出：`tasks[]`、`blocks[]`、`warnings[]`、`assumptions[]`、`summary`。

## 验收标准
- 新用户可注册、登录、创建项目。
- 项目能在多个浏览器刷新后保留。
- AI 规划失败时仍能用本地排程生成计划。
- 所有 AI 计划必须在用户确认后进入看板。
- 日历导入不覆盖现有事件，冲突可见。
