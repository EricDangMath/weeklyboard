# 周看板 UI 视觉验收记录

- source visual truth: `C:\Users\admin\AppData\Local\Temp\weeklyboard-ref-7e2f268d2edb4d519edc6eaf4ee298b3\周看板-源码\index.html` served at `http://127.0.0.1:4174/index.html`
- implementation: `http://127.0.0.1:4173/`
- viewport: Codex in-app browser desktop viewport (same browser session for reference and implementation)
- state: Debug mode, SQL workspace, weekly board, current layer = 实际
- source/implementation pixel dimensions: same viewport capture; source uses 260px sidebar + 64px time gutter + 130px day columns; implementation uses 286px sidebar + 64px gutter + 130px minimum day columns
- density normalization: browser CSS pixels, no raster scaling

## Comparison history

### Pass 1 — initial React page
- Findings: P1 layout was the previous compact project-first layout and did not match the ZIP's paper planner composition; P1 timeline used a short 16-slot grid and lacked the ZIP's 06:00–23:00 7-day board; P2 controls were generic rounded cards.
- Fixes: replaced `src/main.jsx` with a fresh component tree (`Topbar`, `Sidebar`, `Panel`, `Legend`, `Timeline`, `Day`, `Review`); replaced `src/style.css` with ZIP-derived palette, paper surfaces, sketchy borders, 56px topbar, 286px sidebar, 64px time gutter, 7 day columns, 06:00–23:00 grid and layered event cards. Copied supplied `Caveat.ttf` and `icon.png` into `public/assets`.

### Pass 2 — rendered implementation
- Findings: topbar, paper background, sidebar panel rhythm, legend, day headers, timeline gutter, Sunday highlight and event-card visual language are aligned with the reference. The backend intentionally remains SQL/API-backed rather than using the ZIP's localStorage model.
- Fixes: selected project auto-opens from the first SQL project; debug workspace loads without registration; hidden logo image avoids the reference icon's large poster artwork while retaining the supplied asset in the public brand bundle.

### Pass 3 — interaction and persistence pass
- Findings: resize and backup controls were present in the UI but needed an explicit persistence check; ICS events also needed a stable week identity when the server and browser were in different calendar weeks.
- Fixes: event resize now remains SQL-backed after refresh; ICS import/export preserves `X-WB-WEEK` and computes real ISO-week dates; backup restore verifies SHA-256 before opening a transaction; Night Owl and Deadline records use compact ZIP-style paper lists with SQL deletion.

## Fidelity surfaces

- Fonts/typography: ZIP `Caveat.ttf` is bundled and used for English labels; Chinese display falls back to Ma Shan Zheng/KaiTi and body uses PingFang/Noto Sans/Microsoft YaHei.
- Spacing/layout rhythm: 56px sticky toolbar, paper sidebar, 64px gutter, 130px day minimum, 06:00–23:00 timeline, panel gaps and hand-drawn border radii follow the reference system.
- Colors/tokens: implemented reference blue `#3D7695`, cream `#DFC7B4`, terra `#C85E3D`, yellow `#DBB355`, paper/card/ink/line tokens and matching fills.
- Image/asset fidelity: supplied ZIP assets copied to `public/assets`; no CSS/emoji replacement is used for the supplied brand asset in the brand bundle. The visible wordmark remains live text so it stays legible at narrow widths.
- Copy/content: Chinese product labels retain the reference vocabulary (`待分配任务`, `收件箱`, `时间窗口`, `智能规划`, `分类统计`, `WEEKLY REVIEW`) while exposing SQL, DeepSeek and calendar functionality.

## Primary interactions checked

- Debug auto-login and first-project auto-selection.
- Project/task creation, task completion toggle and deletion are wired to SQL API.
- Availability window and fixed-event save actions call `/api/availability`.
- DeepSeek preview and deterministic scheduler create a visible `预估` layer draft; confirmation writes events to SQL and switches back to `实际`.
- ICS import and export controls are wired to `/api/calendar/import` and `/api/calendar.ics`.
- Event edit, drag, and resize persist through `PATCH /api/calendar/events/:id`; a Chrome resize action was exercised on `梳理本周目标` and the success toast confirmed the write.
- Pointer resize regression: a fresh Chrome tab dragged `梳理本周目标` from `09:00–09:50` to `09:00–10:30`; the board updated immediately, the SQL row changed, and a cold reload retained `09:00–10:30` during the verification run. The demo row was then restored to `09:00–09:50` before final delivery.
- Backup export opens the ZIP-style popover; restore is wired through a transactional JSON file flow with checksum validation.
- Week navigation and layer selectors update visible board state.

## Verification

- `npm run build` passed.
- `npm test` passed: 6/6 server tests (including cross-week plan confirmation, ICS week/date round-trip, and backup checksum rejection).
- Browser smoke: implementation loaded at `http://127.0.0.1:4173/` in Chrome, exposed the full board accessibility tree, showed the ZIP-style paper composition, and reported no console errors or warnings.
- Final Chrome cold start: a new tab at `http://127.0.0.1:4173/` loaded the SQL-backed Debug workspace, showed the task pool, backup entry and 7-day timeline, and reported an empty error/warn console. Screenshot: `chrome-final-qa.png`.

final result: passed

### Pass 4 — 网格层级与全 UI 收尾（2026-09-13）

- 原问题：时间轴 10 分钟网格的浏览器默认按钮底色、边框和等权线条让网格抢过了事件内容，整体像硬栅栏；移动端还需要先滚过整列侧栏才能进入时间轴。
- 修复：`.cell10` 清除默认 appearance/background/border；时间轴改为 10 分钟极淡线、30 分钟弱线、整点主参考线的暖纸色三层渐变；日期列、今天列、周日 tint 和事件卡重新分配对比度，使内容浮在背景上。
- 响应式：移动端 `↓ 查看本周时间轴` 已移动到侧栏之前，并以 `#weekTimeline` 锚点跳转；390×844 Chrome 验证首屏入口可把时间轴滚到视口内。
- 交互语义：714 个 10 分钟格设为 `tabIndex=-1`，Tab 顺序由 764 降至 58；任务完成/删除、新建项目、图层和备份、月历翻页补齐 aria 标签与展开状态；事件 resize 支持方向键并保留 SQL 写入。
- 资源：替换损坏的 Caveat 字体为有效 TTF，修复字体解码警告；补齐 `/assets/icon.png` favicon，消除 404。
- Chrome 检查视口：1366×768、1440×900、1920×1080、390×844；附加检查日历、事件弹窗、图层 popover、备份 popover。最终截图与指标保存在 `.ui-audit/after-final/`，SQL 交互回归截图为 `.ui-audit/chrome-ui-audit-final.png`。
- SQL 回归：在 Chrome 中将“梳理本周目标”从 09:00–09:50 改为 09:00–10:00，冷刷新仍保持；再改回 09:00–09:50 并刷新，演示数据恢复。Debug Mode 刷新后保持，业务数据仍通过 SQL/API。

### Final verification

- `npm test`：6/6 通过。
- `npm run build`：通过。
- `node --check server/index.js server/calendar.js server/confirmation.js`：通过。
- `git diff --check`：通过。
- Chrome console：无 error/warning；仅 Vite/React DevTools info。
