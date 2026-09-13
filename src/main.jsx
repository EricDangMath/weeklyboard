import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = 'http://127.0.0.1:8787/api';
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAY_START = 360;
const DAY_END = 1380;
const CELL_MIN = 10;
const CELL_H = 12;
const ROWS = 34;
const LAYERS = [
  { id: 'fixed', label: '每周固定', color: '#3D7695' },
  { id: 'flex', label: '预估', color: '#DBB355' },
  { id: 'once', label: '一次性', color: '#C85E3D' },
  { id: 'actual', label: '实际', color: '#5A8A8E' },
];
const CATS = [
  { id: 'class', label: '校内课程', color: '#3D7695', fill: '#E3ECF2' },
  { id: 'inhw', label: '课内作业', color: '#9BAF80', fill: '#EDF2E6' },
  { id: 'study', label: '课外作业', color: '#DBB355', fill: '#F5ECD0' },
  { id: 'work', label: '工作', color: '#6A4BD7', fill: '#ECE8FA' },
  { id: 'meeting', label: '校内会议', color: '#C85E3D', fill: '#F2DDD5' },
  { id: 'sport', label: '运动', color: '#5A8A8E', fill: '#E4EEEE' },
  { id: 'leisure', label: '休闲', color: '#A585A8', fill: '#F2EAF2' },
  { id: 'meal', label: '餐饮', color: '#DFC7B4', fill: '#F6EDE5' },
  { id: 'other', label: '其他', color: '#9A948A', fill: '#ECE9E2' },
];
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const parseTime = (value) => { const [h, m] = String(value || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const startOfWeek = (value) => { const date = new Date(value); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return date; };
const addDays = (date, count) => { const next = new Date(date); next.setDate(next.getDate() + count); return next; };
const fmtDate = (date) => `${date.getMonth() + 1}/${date.getDate()}`;
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const weekNumber = (date) => { const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); const day = target.getUTCDay() || 7; target.setUTCDate(target.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1)); return Math.ceil((((target - yearStart) / 86400000) + 1) / 7); };
const weekKey = (date) => `${date.getFullYear()}-W${pad(weekNumber(date))}`;
const uid = (prefix = 'wb') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const catById = (id) => CATS.find((cat) => cat.id === id) || CATS[CATS.length - 1];
const download = (content, filename, type) => { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 300); };

function StarIcon() { return <svg className="doodle-star" viewBox="0 0 28 28" aria-hidden="true"><path d="M14 2l3.5 8.5 8.5.5-6.5 5.5 2.5 8.5-8-5.5-8 5.5L8.5 16 2 11l8.5-.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>; }

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('wb-token') || '');
  const [booting, setBooting] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [email, setEmail] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [password, setPassword] = useState('');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [review, setReview] = useState(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [activeLayer, setActiveLayer] = useState('actual');
  const [statsLayer, setStatsLayer] = useState('actual');
  const [activeCat, setActiveCat] = useState('class');
  const [fills, setFills] = useState([]);

  const [inbox, setInbox] = useState([]);
  const [nightNotes, setNightNotes] = useState([]);
  const [deadlines, setDeadlines] = useState([]);
  const [newTask, setNewTask] = useState('');
  const [newInbox, setNewInbox] = useState('');
  const [newProject, setNewProject] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [nightDraft, setNightDraft] = useState({ text: '', sleep: '23:30' });
  const [deadlineDraft, setDeadlineDraft] = useState({ text: '', kind: 'hw' });
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('18:00');
  const [fixedDraft, setFixedDraft] = useState({ title: '', day: '周一', start: '12:00', end: '13:00' });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [layerOpen, setLayerOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [eventModal, setEventModal] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [planVersion, setPlanVersion] = useState(0);
  const notify = useCallback((message) => { setToast(message); window.clearTimeout(window.__wbToast); window.__wbToast = window.setTimeout(() => setToast(''), 2600); }, []);
  const call = useCallback(async (path, options = {}) => { const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || '请求失败'); return body; }, [token]);
  const currentWeekKey = weekKey(weekStart);
  const refresh = useCallback(async () => { const [projectRows, calendarRows, availabilityRows, reviewRow] = await Promise.all([call('/projects'), call('/calendar'), call('/availability'), call('/review')]); setProjects(projectRows); setProject((current) => current && projectRows.some((row) => row.id === current.id) ? current : (projectRows[0] || null)); setEvents(calendarRows); setAvailability(availabilityRows); setReview(reviewRow); const workWindow = availabilityRows.find((row) => row.kind === 'window'); if (workWindow) { setWindowStart(fmtTime(workWindow.start_minute)); setWindowEnd(fmtTime(workWindow.end_minute)); } }, [call]);
  const loadScratch = useCallback(async () => {
    try {
      const rows = await call("/workspace/scratch?week_key=" + encodeURIComponent(currentWeekKey));
      const parsed = { inbox: [], night: [], deadline: [], fill: [] };
      for (const row of rows) if (parsed[row.kind]) parsed[row.kind].push({ ...(row.payload || row), __scratchId: row.id, entity_key: row.entity_key || row.payload?.entity_key });
      setInbox(parsed.inbox); setNightNotes(parsed.night); setDeadlines(parsed.deadline); setFills(parsed.fill);
    } catch { /* scratch API optional during migration */ }
  }, [call, currentWeekKey]);
  useEffect(() => { let active = true; if (token) { setBooting(false); refresh().catch(() => { localStorage.removeItem('wb-token'); if (active) setToken(''); }); return () => { active = false; }; } fetch(`${API}/auth/debug`).then(async (response) => { if (!response.ok) throw new Error('debug disabled'); return response.json(); }).then((session) => { if (!active || !session.token) return; localStorage.setItem('wb-token', session.token); setToken(session.token); setDebugMode(Boolean(session.debugMode)); setEmail(session.user?.email || ''); }).catch(() => active && setBooting(false)); return () => { active = false; }; }, [token, refresh]);
  useEffect(() => { if (!project || !token) return; call(`/projects/${project.id}/tasks`).then(setTasks).catch(() => setTasks([])); }, [call, project, token]);
  useEffect(() => { if (token) loadScratch(); }, [token, loadScratch]);
  const fixedRows = useMemo(() => availability.filter((row) => row.kind === 'fixed'), [availability]);
  const normalizedEvents = useMemo(() => events.filter((event) => !event.week_key || event.week_key === currentWeekKey).map((event) => ({ ...event, layer: event.layer || 'actual', cat: event.category || event.cat || 'other', source: event.source || 'calendar' })), [events, currentWeekKey]);
  const visibleEvents = useMemo(() => {
    const fixed = fixedRows.map((row, index) => ({ id: `fixed-${index}-${row.day}-${row.start_minute}`, title: row.title || '固定事项', day: row.day, start_minute: row.start_minute, end_minute: row.end_minute, layer: 'fixed', cat: 'class', source: 'fixed', locked: 1 }));
    const planned = Array.isArray(window.__wbPlan?.blocks) ? window.__wbPlan.blocks.map((block, index) => ({ ...block, id: `plan-${block.draft_id || block.id || index}`, layer: 'flex', cat: block.category || block.cat || 'study', source: 'plan', title: block.title || block.task_title || '规划任务' })) : [];
    if (activeLayer === 'fixed') return fixed;
    if (activeLayer === 'flex') return [...normalizedEvents.filter((event) => event.layer === 'flex'), ...planned];
    return normalizedEvents.filter((event) => event.layer === activeLayer);
  }, [activeLayer, fixedRows, normalizedEvents, busy, planVersion, currentWeekKey]);
  const currentWeekDeadlines = deadlines.filter((item) => item.weekKey === currentWeekKey);
  const currentWeekNights = nightNotes.filter((item) => item.weekKey === currentWeekKey);
  const stats = useMemo(() => { const totals = Object.fromEntries(CATS.map((cat) => [cat.id, 0])); visibleEvents.forEach((event) => { totals[event.cat || 'other'] += Math.max(0, event.end_minute - event.start_minute); }); fills.filter((fill) => fill.weekKey === currentWeekKey && fill.layer === statsLayer).forEach((fill) => { totals[fill.cat] += CELL_MIN; }); return { totals, total: Object.values(totals).reduce((sum, value) => sum + value, 0) }; }, [currentWeekKey, fills, statsLayer, visibleEvents]);
  const authenticate = async () => { try { const response = await fetch(`${API}/auth/${authMode === 'login' ? 'login' : 'register'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); const body = await response.json(); if (!response.ok || !body.token) throw new Error(body.error || '认证失败'); localStorage.setItem('wb-token', body.token); setToken(body.token); setEmail(body.user?.email || email); } catch (error) { notify(error.message); } };
  const selectProject = async (row) => { setProject(row); try { setTasks(await call(`/projects/${row.id}/tasks`)); } catch { setTasks([]); } };
  const createProject = async () => { if (!newProject.trim()) return notify('先写项目名称'); try { const row = await call('/projects', { method: 'POST', body: JSON.stringify({ title: newProject.trim(), description: projectDescription.trim(), priority: 3 }) }); setProjects((items) => [row, ...items]); setProject(row); setTasks([]); setNewProject(''); setProjectDescription(''); notify('项目已写入 SQL'); } catch (error) { notify(error.message); } };
  const createTask = async (title = newTask, options = {}) => { if (!project) return notify('先选择项目'); if (!String(title).trim()) return notify('任务不能为空'); try { const row = await call(`/projects/${project.id}/tasks`, { method: 'POST', body: JSON.stringify({ title: String(title).trim(), estimate_minutes: options.estimate_minutes || 30, priority: options.priority || 3 }) }); setTasks((items) => [...items, row]); setNewTask(''); notify('任务已加入任务池'); return row; } catch (error) { notify(error.message); return null; } };
  const toggleTask = async (task) => { try { const row = await call(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: task.status === 'done' ? 'todo' : 'done' }) }); setTasks((items) => items.map((item) => item.id === row.id ? row : item)); setReview(await call('/review')); } catch (error) { notify(error.message); } };
  const removeTask = async (task) => { try { await call(`/tasks/${task.id}`, { method: 'DELETE' }); setTasks((items) => items.filter((item) => item.id !== task.id)); notify('任务已删除'); } catch (error) { notify(error.message); } };
  const addInboxItem = async () => { if (!newInbox.trim()) return; const item = { id: uid('inbox'), text: newInbox.trim(), weekKey: currentWeekKey }; setInbox((items) => [item, ...items]); setNewInbox(''); const saved = await persistScratch('inbox', item); if (saved) setInbox((items) => items.map((row) => row.id === item.id ? { ...row, __scratchId: saved.id, entity_key: saved.entity_key } : row)); };
  const removeInbox = async (item) => { setInbox((items) => items.filter((row) => row.id !== item.id)); if (item.__scratchId) await persistScratch('scratch-delete', item); };
  const convertInbox = async (item) => { const task = await createTask(item.text); if (task) await removeInbox(item); };
  const persistScratch = useCallback(async (kind, payload) => {
    try {
      if (kind === 'scratch-delete' && (payload?.__scratchId || payload?.id || payload?.entity_key || payload?.key)) {
        const response = payload.__scratchId
          ? await call(`/workspace/scratch/${payload.__scratchId}`, { method: 'DELETE' })
          : await call(`/workspace/scratch?kind=${encodeURIComponent(payload.kind || 'fill')}&week_key=${encodeURIComponent(payload.weekKey || currentWeekKey)}&entity_key=${encodeURIComponent(payload.entity_key || payload.id || payload.key)}`, { method: 'DELETE' });
        return response;
      }
      return await call('/workspace/scratch', { method: 'PUT', body: JSON.stringify({ kind, week_key: currentWeekKey, entity_key: payload?.entity_key || payload?.id || payload?.key, payload }) });
    } catch (error) {
      notify(`草稿保存失败：${error.message}`);
      return null;
    }
  }, [call, currentWeekKey, notify]);
  const saveAvailability = async () => { const start = parseTime(windowStart); const end = parseTime(windowEnd); if (start >= end) return notify('时间窗口不合法'); const rows = DAYS.slice(0, 5).map((day) => ({ day, start_minute: start, end_minute: end, kind: 'window', title: '' })); try { await call('/availability', { method: 'PUT', body: JSON.stringify({ rows: [...rows, ...fixedRows] }) }); setAvailability([...rows, ...fixedRows]); notify('工作日窗口已保存'); } catch (error) { notify(error.message); } };
  const saveFixed = async () => { const start = parseTime(fixedDraft.start); const end = parseTime(fixedDraft.end); if (!fixedDraft.title.trim() || start >= end) return notify('固定事项和时间都要填完整'); const rows = [...availability.filter((row) => row.kind === 'window'), ...fixedRows, { day: fixedDraft.day, start_minute: start, end_minute: end, kind: 'fixed', title: fixedDraft.title.trim() }]; try { await call('/availability', { method: 'PUT', body: JSON.stringify({ rows }) }); setAvailability(rows); setFixedDraft((draft) => ({ ...draft, title: '' })); notify('固定事项已保存'); } catch (error) { notify(error.message); } };
  const makePlan = async (useAI) => { if (!project) return notify('先选择项目'); setBusy(true); try { const input = useAI ? { project, tasks, week_key: currentWeekKey, start_minute: 540, day: '周一' } : { tasks, week_key: currentWeekKey }; const result = await call(useAI ? '/plan/preview' : '/plan/deterministic', { method: 'POST', body: JSON.stringify(input) }); const blocks = (result.blocks || []).filter((block) => block && block.day && Number.isInteger(Number(block.start_minute)) && Number.isInteger(Number(block.end_minute)) && Number(block.start_minute) < Number(block.end_minute)).map((block) => ({ ...block, start_minute: Number(block.start_minute), end_minute: Number(block.end_minute), draft_id: block.draft_id || uid('draft') })); window.__wbPlan = { ...result, blocks, week_key: currentWeekKey, project_id: project.id, request_key: uid('plan') }; setPlanVersion((value) => value + 1); setActiveLayer('flex'); notify(result.fallback ? 'DeepSeek 暂不可用，已用本地排程生成草案' : (useAI ? 'DeepSeek 草案已生成，切到预估图层查看' : '自动排程草案已生成')); } catch (error) { notify(error.message); } finally { setBusy(false); } };
  const confirmPlan = async () => { const plan = window.__wbPlan; if (!plan) return notify('先生成排程草案'); try { const result = await call('/plan/confirm', { method: 'POST', body: JSON.stringify(plan) }); setEvents(await call('/calendar')); setReview(await call('/review')); setActiveLayer('actual'); window.__wbPlan = null; setPlanVersion((value) => value + 1); notify(`已确认 ${result.created} 个时间块`); } catch (error) { notify(error.message); } };
  const addEvent = (day, startMinute, extra = {}) => { const start = Math.max(DAY_START, Math.min(DAY_END - 15, Math.round(startMinute / CELL_MIN) * CELL_MIN)); setEventModal({ id: null, title: extra.title || '', day, start_minute: start, end_minute: Math.min(DAY_END, start + (extra.duration || 60)), layer: activeLayer, cat: extra.cat || activeCat, description: '', repeat: false, week_key: currentWeekKey }); };
  const updatePlanDraft = (planId, patch) => {
    const plan = window.__wbPlan;
    const draftId = String(planId).replace(/^plan-/, '');
    if (!plan || !Array.isArray(plan.blocks)) return false;
    const index = plan.blocks.findIndex((block, blockIndex) => String(block.draft_id || block.id || blockIndex) === draftId);
    if (index < 0) return false;
    const blocks = plan.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block);
    window.__wbPlan = { ...plan, blocks };
    setPlanVersion((value) => value + 1);
    return true;
  };
  const deletePlanDraft = (planId) => {
    const plan = window.__wbPlan;
    const draftId = String(planId).replace(/^plan-/, '');
    if (!plan || !Array.isArray(plan.blocks)) return false;
    const index = plan.blocks.findIndex((block, blockIndex) => String(block.draft_id || block.id || blockIndex) === draftId);
    if (index < 0) return false;
    window.__wbPlan = { ...plan, blocks: plan.blocks.filter((_, blockIndex) => blockIndex !== index) };
    setPlanVersion((value) => value + 1);
    return true;
  };
  const saveEvent = async () => {
    if (!eventModal?.title?.trim()) return notify('日程标题不能为空');
    const localEvent = { ...eventModal, title: eventModal.title.trim(), start_minute: Number(eventModal.start_minute), end_minute: Number(eventModal.end_minute), category: eventModal.cat || activeCat };
    if (localEvent.end_minute <= localEvent.start_minute) return notify('结束时间必须晚于开始时间');
    try {
      if (String(localEvent.id || '').startsWith('plan-')) {
        updatePlanDraft(localEvent.id, { title: localEvent.title, day: localEvent.day, start_minute: localEvent.start_minute, end_minute: localEvent.end_minute, category: localEvent.category, description: localEvent.description || '' });
        setEventModal(null);
        notify('规划草案已更新，确认后才会写入 SQL');
      } else if (localEvent.id && !String(localEvent.id).startsWith('local-')) {
        const response = await call(`/calendar/events/${localEvent.id}`, { method: 'PATCH', body: JSON.stringify(localEvent) });
        setEvents((items) => items.map((item) => item.id === localEvent.id ? response : item));
        notify('日程已更新并写入 SQL');
      } else {
        const response = await call('/calendar/events', { method: 'POST', body: JSON.stringify(localEvent) });
        setEvents((items) => [...items, response]);
        notify('日程已写入 SQL');
      }
      setEventModal(null);
    } catch (error) {
      notify(`保存失败：${error.message}`);
    }
  };
  const deleteEvent = async () => {
    if (!eventModal?.id) return setEventModal(null);
    if (String(eventModal.id).startsWith('plan-')) {
      deletePlanDraft(eventModal.id);
      setEventModal(null);
      notify('规划草案已移除，尚未写入 SQL');
      return;
    }
    try { await call(`/calendar/events/${eventModal.id}`, { method: 'DELETE' }); } catch {} setEvents((items) => items.filter((item) => item.id !== eventModal.id)); setEventModal(null); notify('日程已删除');
  };
  const persistEventMove = async (eventId, patch) => {
    if (!eventId || String(eventId).startsWith('plan-') || String(eventId).startsWith('fixed-')) return;
    try {
      const saved = await call(`/calendar/events/${eventId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setEvents((items) => items.map((item) => item.id === eventId ? saved : item));
      notify('日程位置已保存');
    } catch (error) {
      notify(`移动失败：${error.message}`);
      await refresh();
    }
  };
  const onDropToGrid = (event, day, minute) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('text/plain');
    if (!raw) return;
    const targetStart = Math.max(DAY_START, Math.min(DAY_END - 15, Math.round(minute / CELL_MIN) * CELL_MIN));
    if (raw.startsWith('event:')) {
      const eventId = raw.slice(6);
      if (eventId.startsWith('plan-')) {
        updatePlanDraft(eventId, { day, start_minute: targetStart });
        notify('草案位置已调整，确认后才会写入 SQL');
        return;
      }
      const current = events.find((item) => String(item.id) === eventId);
      if (!current || current.locked) return notify(current?.locked ? '锁定日程不可移动' : '找不到要移动的日程');
      const duration = Math.max(CELL_MIN, Number(current.end_minute) - Number(current.start_minute));
      const patch = { day, start_minute: targetStart, end_minute: Math.min(DAY_END, targetStart + duration) };
      setEvents((items) => items.map((item) => item.id === current.id ? { ...item, ...patch } : item));
      persistEventMove(current.id, patch);
      return;
    }
    if (raw.startsWith('task:')) { const task = tasks.find((item) => String(item.id) === raw.slice(5)); if (task) addEvent(day, minute, { title: task.title, duration: task.estimate_minutes || 30, cat: task.title.includes('作业') ? 'study' : 'class' }); }
    else if (raw.startsWith('inbox:')) { const item = inbox.find((row) => row.id === raw.slice(6)); if (item) addEvent(day, minute, { title: item.text, duration: 30, cat: 'other' }); }
    else if (raw === 'night') { const item = { id: uid('night'), weekKey: currentWeekKey, day, date: isoDate(addDays(weekStart, DAYS.indexOf(day))), text: nightDraft.text.trim() || '熬夜', sleep: nightDraft.sleep }; setNightNotes((items) => [...items, item]); persistScratch('night', item).then((saved) => saved && setNightNotes((items) => items.map((row) => row.id === item.id ? { ...row, __scratchId: saved.id, entity_key: saved.entity_key } : row))); notify('熬夜贴纸已贴到周看板'); }
    else if (raw === 'deadline') { if (!deadlineDraft.text.trim()) return notify('先写截止内容'); const item = { id: uid('deadline'), weekKey: currentWeekKey, day, date: isoDate(addDays(weekStart, DAYS.indexOf(day))), text: deadlineDraft.text.trim(), kind: deadlineDraft.kind }; setDeadlines((items) => [...items, item]); persistScratch('deadline', item).then((saved) => saved && setDeadlines((items) => items.map((row) => row.id === item.id ? { ...row, __scratchId: saved.id, entity_key: saved.entity_key } : row))); notify('截止警示已贴到周看板'); }
  };
  const previewResize = (eventId, endMinute) => {
    const plan = window.__wbPlan;
    if (String(eventId).startsWith('plan-')) {
      updatePlanDraft(eventId, { end_minute: Math.max(DAY_START + CELL_MIN, Math.min(DAY_END, Math.round(endMinute / CELL_MIN) * CELL_MIN)) });
      return;
    }
    const current = events.find((item) => String(item.id) === String(eventId));
    if (!current || current.locked) return;
    const next = Math.max(Number(current.start_minute) + CELL_MIN, Math.min(DAY_END, Math.round(endMinute / CELL_MIN) * CELL_MIN));
    setEvents((items) => items.map((item) => item.id === current.id ? { ...item, end_minute: next } : item));
  };
  const finishResize = async (eventId, endMinute) => {
    if (String(eventId).startsWith('plan-')) { notify('草案时长已调整，确认后才会写入 SQL'); return; }
    const current = events.find((item) => String(item.id) === String(eventId));
    if (!current || current.locked) return notify('锁定日程不可调整');
    await persistEventMove(current.id, { end_minute: Math.max(Number(current.start_minute) + CELL_MIN, Math.min(DAY_END, Math.round(endMinute / CELL_MIN) * CELL_MIN)) });
  };
  const resizeEvent = async (eventId, endMinute) => {
    const current = events.find((item) => String(item.id) === String(eventId));
    if (!current || current.locked) return notify('锁定日程不可调整');
    const patch = { end_minute: Math.max(Number(current.start_minute) + CELL_MIN, Math.min(DAY_END, Math.round(endMinute / CELL_MIN) * CELL_MIN)) };
    setEvents((items) => items.map((item) => item.id === current.id ? { ...item, ...patch } : item));
    await persistEventMove(current.id, patch);
  };
  const paint = async (dayIndex, minute) => {
    const key = `${currentWeekKey}-${activeLayer}-${dayIndex}-${minute}`;
    const existing = fills.find((item) => item.key === key);
    if (existing) {
      setFills((items) => items.filter((item) => item.key !== key));
      await persistScratch('scratch-delete', { ...existing, kind: 'fill' });
      return;
    }
    if (activeCat === 'erase') return;
    const fill = { key, weekKey: currentWeekKey, layer: activeLayer, day: dayIndex, minute, cat: activeCat };
    setFills((items) => [...items, fill]);
    const saved = await persistScratch('fill', fill);
    if (saved) setFills((items) => items.map((row) => row.key === key ? { ...row, __scratchId: saved.id, entity_key: saved.entity_key } : row));
  }; 
  const removeScratchItem = async (kind, item, setter) => {
    setter((items) => items.filter((row) => row.id !== item.id));
    await persistScratch('scratch-delete', { ...item, kind });
  };
  const removeNight = async (item) => removeScratchItem('night', item, setNightNotes);
  const removeDeadline = async (item) => removeScratchItem('deadline', item, setDeadlines);
  const exportBackup = async () => { try { const backup = await call('/backup'); download(JSON.stringify(backup, null, 2), `weeklyboard-${currentWeekKey}.json`, 'application/json'); notify('SQL 备份已导出'); } catch (error) { notify(`备份失败：${error.message}`); } };
  const restoreBackup = async (change) => { const file = change.target.files?.[0]; if (!file) return; try { const backup = JSON.parse(await file.text()); if (!backup?.tables) throw new Error('备份文件缺少 tables'); if (!window.confirm('恢复备份会替换当前账号的项目、任务、日程和贴纸，继续吗？')) return; await call('/backup/restore', { method: 'POST', body: JSON.stringify({ backup }) }); setProject(null); setTasks([]); await refresh(); await loadScratch(); notify('SQL 备份已恢复'); } catch (error) { notify(`恢复失败：${error.message}`); } finally { change.target.value = ''; } };
  const exportICS = async () => { try { const response = await fetch(`${API}/calendar.ics`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('导出失败'); download(await response.text(), 'weeklyboard.ics', 'text/calendar'); notify('ICS 已导出'); } catch (error) { notify(error.message); } };
  const importICS = async (change) => { const file = change.target.files?.[0]; if (!file) return; try { const response = await call('/calendar/import', { method: 'POST', body: JSON.stringify({ ics: await file.text(), week_key: currentWeekKey }) }); setEvents(await call('/calendar')); notify(`已导入 ${response.imported} 个事件`); } catch (error) { notify(error.message); } finally { change.target.value = ''; } };
  const logout = () => { localStorage.removeItem('wb-token'); setToken(''); setProjects([]); setProject(null); setTasks([]); };
  if (booting) return <Auth loading />;
  if (!token) return <Auth email={email} setEmail={setEmail} password={password} setPassword={setPassword} mode={authMode} setMode={setAuthMode} submit={authenticate} />;
  return <div className="app"><Topbar weekStart={weekStart} setWeekStart={setWeekStart} setCalendarOpen={setCalendarOpen} layerOpen={layerOpen} setLayerOpen={setLayerOpen} backupOpen={backupOpen} setBackupOpen={setBackupOpen} activeLayer={activeLayer} setActiveLayer={setActiveLayer} debugMode={debugMode} email={email} onImport={importICS} onExportICS={exportICS} onBackup={exportBackup} onRestore={restoreBackup} logout={logout} /><div className="board"><Sidebar {...{ projects, project, selectProject, newProject, setNewProject, projectDescription, setProjectDescription, createProject, tasks, newTask, setNewTask, createTask, toggleTask, removeTask, inbox, newInbox, setNewInbox, addInboxItem, removeInbox, convertInbox, nightDraft, setNightDraft, deadlineDraft, setDeadlineDraft, windowStart, setWindowStart, windowEnd, setWindowEnd, saveAvailability, fixedDraft, setFixedDraft, saveFixed, stats, statsLayer, setStatsLayer, review, makePlan, busy, confirmPlan, currentWeekNights, currentWeekDeadlines, removeNight, removeDeadline }} /><main className="timeline-pane"><Legend activeCat={activeCat} setActiveCat={setActiveCat} activeLayer={activeLayer} setActiveLayer={setActiveLayer} /><Timeline weekStart={weekStart} events={visibleEvents} fills={fills} currentWeekKey={currentWeekKey} activeLayer={activeLayer} activeCat={activeCat} onPaint={paint} onDrop={onDropToGrid} onOpenEvent={(event) => setEventModal(event)} onCreate={addEvent} onResizePreview={previewResize} onResizeEnd={finishResize} nights={currentWeekNights} deadlines={currentWeekDeadlines} onRemoveNight={removeNight} onRemoveDeadline={removeDeadline} /></main></div>{calendarOpen && <CalendarView month={calendarMonth} setMonth={setCalendarMonth} weekStart={weekStart} setWeekStart={setWeekStart} close={() => setCalendarOpen(false)} nights={currentWeekNights} deadlines={currentWeekDeadlines} review={review} />}{eventModal && <EventModal value={eventModal} setValue={setEventModal} save={saveEvent} remove={deleteEvent} close={() => setEventModal(null)} />}{toast && <div className="toast">{toast}</div>}</div>;
}

function Auth({ loading, email, setEmail, password, setPassword, mode, setMode, submit }) { return <div className="auth-screen"><div className="auth-paper sketchy"><div className="auth-brand"><StarIcon /><div><h1>周看板</h1><span>Weekly Planner</span></div></div>{loading ? <><p className="auth-lead">正在启动调试工作区…</p><span className="debug-badge">DEBUG MODE · SQL DATABASE</span></> : <><p className="auth-lead">把目标，变成这一周能执行的计划。</p><label className="field-label">邮箱<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label><label className="field-label">密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" /></label><button className="paper-btn primary wide" onClick={submit}>{mode === 'login' ? '进入工作台' : '创建账号'}</button><button className="text-btn" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? '还没有账号？创建一个' : '已有账号，直接登录'}</button></>}</div></div>; }
function Topbar({ weekStart, setWeekStart, setCalendarOpen, layerOpen, setLayerOpen, backupOpen, setBackupOpen, activeLayer, setActiveLayer, debugMode, email, onImport, onExportICS, onBackup, onRestore, logout }) { return <header className="topbar"><div className="brand"><button className="star-btn" onClick={() => setCalendarOpen(true)} title="打开日历视图" aria-label="打开日历视图"><StarIcon /></button><h1>周看板</h1><span className="brand-en">Weekly Planner</span></div><div className="weeknav"><button className="icon-btn" onClick={() => setWeekStart((date) => addDays(date, -7))} aria-label="上一周">‹</button><button className="today-btn" onClick={() => setWeekStart(startOfWeek(new Date()))}>本周</button><button className="icon-btn" onClick={() => setWeekStart((date) => addDays(date, 7))} aria-label="下一周">›</button><span className="week-label">{weekStart.getFullYear()}年第{weekNumber(weekStart)}周 · {fmtDate(weekStart)} – {fmtDate(addDays(weekStart, 6))}</span></div><div className="top-actions"><span className="save-dot on" title="已自动保存" /><label className="paper-btn primary">导入日历 (.ics)<input type="file" accept=".ics,.txt,text/calendar" hidden onChange={onImport} /></label><button className="paper-btn" onClick={onExportICS}>导出 ICS</button><button className="paper-btn" onClick={() => window.print()}>导出 PNG</button><div className="backup-wrap"><button className="paper-btn" onClick={() => setBackupOpen(!backupOpen)}>💾 备份</button>{backupOpen && <div className="layer-popover backup-popover"><h4>数据备份 <em>Backup</em></h4><p className="popover-note">备份包含项目、任务、日程、收件箱、涂色与贴纸。</p><div className="data-btns"><button className="paper-btn primary" onClick={onBackup}>⬇ 导出备份 (JSON)</button><label className="paper-btn">⬆ 恢复备份<input type="file" accept=".json,application/json" hidden onChange={onRestore} /></label></div></div>}</div><div className="layer-wrap"><button className="paper-btn" onClick={() => setLayerOpen(!layerOpen)}>图层</button>{layerOpen && <div className="layer-popover"><h4>图层 <em>Layers</em></h4><div className="layer-list">{LAYERS.map((layer) => <button className={`layer-row ${activeLayer === layer.id ? '' : 'dimmed'}`} key={layer.id} onClick={() => { setActiveLayer(layer.id); setLayerOpen(false); }}><i className="layer-dot" style={{ background: layer.color }} /><span className="layer-name">{layer.label}</span><span className="layer-count">{activeLayer === layer.id ? '当前' : ''}</span></button>)}</div><button className="layer-add" onClick={() => setLayerOpen(false)}>＋ 新建图层</button></div>}</div><span className={debugMode ? 'debug-badge compact' : 'user-chip'}>{debugMode ? 'DEBUG MODE' : email}</span><button className="text-btn" onClick={logout}>退出</button></div></header>; }
function Panel({ title, english, tape = 'tape-yellow', children, className = '' }) { return <section className={`panel sketchy ${className}`}><h2 className={`panel-title ${tape}`}>{title} <em>{english}</em></h2>{children}</section>; }
function Sidebar(props) { return <aside className="sidebar"><Panel title="待分配任务" english="Task Pool"><div className="add-row"><input value={props.newTask} onChange={(event) => props.setNewTask(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && props.createTask()} placeholder="添加一个任务…" /><button className="mini-btn" onClick={() => props.createTask()} aria-label="添加任务">＋</button></div><ul className="task-list">{props.tasks.map((task) => <li className="task" draggable key={task.id} onDragStart={(event) => event.dataTransfer.setData('text/plain', `task:${task.id}`)}><span className={`task-dot ${task.status === 'done' ? 'done' : ''}`} /><div className="task-body"><strong className={`task-title ${task.status === 'done' ? 'completed' : ''}`}>{task.title}</strong><small>{task.estimate_minutes || 30} 分钟 · 优先级 {task.priority || 3}</small><input className="task-note" placeholder="本周具体任务…" /></div><div className="task-actions"><button onClick={() => props.toggleTask(task)}>{task.status === 'done' ? '↺' : '✓'}</button><button onClick={() => props.removeTask(task)}>×</button></div></li>)}</ul><p className="panel-hint"><span className="mini-arrow">→</span>拖到时间轴安排（默认仅本周）；任务保留在池中，可多次安排不同内容</p></Panel><Panel title="收件箱" english="Inbox" tape="tape-cream"><div className="add-row"><input value={props.newInbox} onChange={(event) => props.setNewInbox(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && props.addInboxItem()} placeholder="记点什么…" /><button className="mini-btn" onClick={props.addInboxItem} aria-label="添加便签">＋</button></div><ul className="inbox-list">{props.inbox.map((item) => <li className="inbox-item" draggable key={item.id} onDragStart={(event) => event.dataTransfer.setData('text/plain', `inbox:${item.id}`)}><span className="inbox-text">{item.text}</span><div className="inbox-actions"><button onClick={() => props.convertInbox(item)}>转任务</button><button onClick={() => props.removeInbox(item)} aria-label={`删除 ${item.text}`}>×</button></div></li>)}</ul><p className="panel-hint"><span className="mini-arrow">→</span>便签可单独拖到时间轴安排 · 每周自动清空</p></Panel><Panel title="熬夜贴纸" english="Night Owl" tape="tape-teal"><div className="night-sticker" draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', 'night')}><span className="night-moon">🌙</span><div className="night-fields"><input value={props.nightDraft.text} onChange={(event) => props.setNightDraft({ ...props.nightDraft, text: event.target.value })} placeholder="熬夜干了什么…" /><input type="time" value={props.nightDraft.sleep} onChange={(event) => props.setNightDraft({ ...props.nightDraft, sleep: event.target.value })} /></div></div><p className="panel-hint"><span className="mini-arrow">→</span>填好后把贴纸拖到某一天的日程上</p>{props.currentWeekNights?.length > 0 && <ul className="scratch-list">{props.currentWeekNights.map((item) => <li key={item.id}><span>🌙 {item.text}</span><button aria-label={`删除熬夜记录 ${item.text}`} onClick={() => props.removeNight(item)}>×</button></li>)}</ul>}</Panel><Panel title="截止警示" english="Deadline" tape="tape-red"><div className="night-sticker dl-sticker" draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', 'deadline')}><span className="night-moon">⚠️</span><div className="night-fields"><input value={props.deadlineDraft.text} onChange={(event) => props.setDeadlineDraft({ ...props.deadlineDraft, text: event.target.value })} placeholder="什么要交 / 要考？" /><select value={props.deadlineDraft.kind} onChange={(event) => props.setDeadlineDraft({ ...props.deadlineDraft, kind: event.target.value })}><option value="hw">作业截止</option><option value="exam">考试</option></select></div></div><p className="panel-hint"><span className="mini-arrow">→</span>拖到课程或某一天；日历页截止雷达同步显示</p>{props.currentWeekDeadlines?.length > 0 && <ul className="scratch-list deadline-list">{props.currentWeekDeadlines.map((item) => <li key={item.id}><span>{item.kind === 'exam' ? '📝' : '⚠️'} {item.text}</span><button aria-label={`删除截止提醒 ${item.text}`} onClick={() => props.removeDeadline(item)}>×</button></li>)}</ul>}</Panel><Panel title="分类统计" english="Weekly Stats" tape="tape-teal"><div className="stats-layer-row"><span className="stats-mini-label">统计图层</span><select className="paper-select" value={props.statsLayer} onChange={(event) => props.setStatsLayer(event.target.value)}>{LAYERS.map((layer) => <option key={layer.id} value={layer.id}>{layer.label}</option>)}</select></div><ul className="stats-list">{CATS.map((cat) => <li className={`stat-row ${props.stats.totals[cat.id] ? '' : 'zero'}`} key={cat.id}><i className="stat-dot" style={{ background: cat.color }} /><span className="stat-label">{cat.label}</span><span className="stat-time">{Math.round(props.stats.totals[cat.id] / 60 * 10) / 10}h</span></li>)}</ul><p className="stats-total">本周合计 {Math.round(props.stats.total / 60 * 10) / 10} 小时</p><p className="stats-note">统计当前周内，当前图层中日程与涂色的总时长</p></Panel><Panel title="我的项目" english="Projects" tape="tape-cream"><div className="add-row"><input value={props.newProject} onChange={(event) => props.setNewProject(event.target.value)} placeholder="新项目名称…" /><button className="mini-btn" onClick={props.createProject}>＋</button></div><textarea value={props.projectDescription} onChange={(event) => props.setProjectDescription(event.target.value)} rows="2" placeholder="目标与背景（可选）" />{props.projects.map((item) => <button className={`project-chip ${props.project?.id === item.id ? 'chosen' : ''}`} key={item.id} onClick={() => props.selectProject(item)}><span className="project-dot" />{item.title}<small>{props.project?.id === item.id ? '正在查看' : '打开项目'}</small></button>)}</Panel><Panel title="智能规划" english="DeepSeek" className="planner-panel"><p className="panel-hint">{props.project ? `为「${props.project.title}」生成可确认草案。` : '选择项目后开启规划。'}</p><div className="planner-actions"><button className="paper-btn primary" disabled={!props.project || props.busy} onClick={() => props.makePlan(true)}>{props.busy ? '规划中…' : '✦ DeepSeek 规划'}</button><button className="paper-btn" disabled={!props.project || props.busy} onClick={() => props.makePlan(false)}>⚙ 自动排程</button></div><button className="paper-btn primary small" onClick={props.confirmPlan}>确认写入周看板</button></Panel><button className="reset-link" onClick={() => window.location.reload()}>重置为示例数据</button></aside>; }
function Legend({ activeCat, setActiveCat, activeLayer, setActiveLayer }) { return <div className="legend"><span className="legend-label">颜色分类</span><div className="swatches"><button className={`swatch swatch-erase ${activeCat === 'erase' ? 'active' : ''}`} onClick={() => setActiveCat('erase')}><span className="swatch-dot swatch-dot-erase" /><span className="swatch-text">擦除</span></button>{CATS.map((cat) => <button className={`swatch ${activeCat === cat.id ? 'active' : ''}`} key={cat.id} onClick={() => setActiveCat(cat.id)}><span className="swatch-dot" style={{ background: cat.color }} /><span className="swatch-text">{cat.label}</span></button>)}</div><span className="legend-hint">点选分类后在时间轴上涂色；再点同色小格擦除</span><div className="legend-layer"><span className="legend-label">当前图层</span><select className="paper-select" value={activeLayer} onChange={(event) => setActiveLayer(event.target.value)}>{LAYERS.map((layer) => <option key={layer.id} value={layer.id}>{layer.label}</option>)}</select></div></div>; }
function Timeline({ weekStart, events, fills, currentWeekKey, activeLayer, activeCat, onPaint, onDrop, onOpenEvent, onCreate, onResizePreview, onResizeEnd, nights, deadlines }) { const now = new Date(); const todayIndex = (now.getDay() + 6) % 7; return <div className="timeline-scroll"><div className="timeline"><div className="tl-gutter"><div className="gutter-head" />{Array.from({ length: ROWS }, (_, row) => <div className="gutter-cell" key={row}><span className="hour-label">{fmtTime(DAY_START + row * 30)}</span><i className="half-tick" /></div>)}</div>{DAYS.map((day, dayIndex) => { const date = addDays(weekStart, dayIndex); const dayEvents = events.filter((event) => event.day === day); const dayFills = fills.filter((fill) => fill.weekKey === currentWeekKey && fill.layer === activeLayer && fill.day === dayIndex); return <div className={`day-col ${dayIndex === todayIndex && startOfWeek(now).getTime() === weekStart.getTime() ? 'today' : ''}`} key={day}><div className="day-head"><span className="dow">{day}</span><span className="date-num">{fmtDate(date)}</span><span className="night-badges">{nights.filter((item) => item.day === day).map((item) => <button className="night-badge" key={item.id} title={item.text}>🌙 <em>{item.text}</em></button>)}{deadlines.filter((item) => item.day === day).map((item) => <button className="dl-badge" key={item.id} title={item.text}>{item.kind === 'exam' ? '📝' : '⚠️'} <em>{item.text}</em></button>)}</span></div><div className="day-grid" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const minute = DAY_START + Math.round((event.clientY - rect.top) / CELL_H) * CELL_MIN; onDrop(event, day, minute); }} onDoubleClick={(event) => { if (event.target.closest('.event')) return; const rect = event.currentTarget.getBoundingClientRect(); const minute = DAY_START + Math.round((event.clientY - rect.top) / CELL_H) * CELL_MIN; onCreate(day, minute); }}><div className="grid-background">{Array.from({ length: ROWS }, (_, row) => <div className="hrow" key={row}>{[0, 1, 2].map((slot) => { const minute = DAY_START + row * 30 + slot * 10; const fill = dayFills.find((item) => item.minute === minute); return <button className={`cell10 ${fill ? 'paint-active' : ''}`} key={minute} onClick={() => onPaint(dayIndex, minute)} style={fill && activeCat !== 'erase' ? { background: `${catById(fill.cat).color}27` } : undefined} aria-label={`${day} ${fmtTime(minute)}`} />; })}</div>)}</div><div className="events-layer">{dayEvents.map((event) => { const top = ((event.start_minute - DAY_START) / CELL_MIN) * CELL_H; const height = Math.max(18, ((event.end_minute - event.start_minute) / CELL_MIN) * CELL_H - 1); const cat = catById(event.cat); return <article className="event" key={event.id} style={{ top, height, borderLeftColor: cat.color, background: cat.fill }} onClick={(click) => { click.stopPropagation(); onOpenEvent({ ...event, cat: event.cat || 'other' }); }} draggable={!event.locked} onDragStart={(drag) => drag.dataTransfer.setData('text/plain', `event:${event.id}`)}><strong className="event-title">{event.title}</strong><span className="event-time">{fmtTime(event.start_minute)} – {fmtTime(event.end_minute)}</span>{event.description && <span className="event-desc">{event.description}</span>}<span className="event-resize" role="slider" aria-label={`调整 ${event.title} 结束时间`} onPointerDown={(down) => { down.preventDefault(); down.stopPropagation(); if (event.locked) return; const target = down.currentTarget; target.setPointerCapture?.(down.pointerId); const startY = down.clientY; const initialEnd = Number(event.end_minute); let currentEnd = initialEnd; const move = (moveEvent) => { const delta = Math.round((moveEvent.clientY - startY) / CELL_H) * CELL_MIN; currentEnd = Math.max(Number(event.start_minute) + CELL_MIN, Math.min(DAY_END, initialEnd + delta)); onResizePreview?.(event.id, currentEnd); }; const up = () => { target.releasePointerCapture?.(down.pointerId); target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); onResizeEnd?.(event.id, currentEnd); }; target.addEventListener('pointermove', move); target.addEventListener('pointerup', up, { once: true }); target.addEventListener('pointercancel', up, { once: true }); }} /></article>; })}</div>{todayIndex === dayIndex && startOfWeek(now).getTime() === weekStart.getTime() && now.getHours() * 60 + now.getMinutes() >= DAY_START && now.getHours() * 60 + now.getMinutes() <= DAY_END && <div className="now-line" style={{ top: ((now.getHours() * 60 + now.getMinutes() - DAY_START) / CELL_MIN) * CELL_H }} />}</div></div>; })}</div></div>; }
function EventModal({ value, setValue, save, remove, close }) { return <div className="modal-mask"><div className="modal-card"><div className="modal-tape" /><h3>{value.id ? '编辑日程' : '新建日程'}</h3><label>标题<input autoFocus value={value.title} onChange={(event) => setValue({ ...value, title: event.target.value })} placeholder="例如：Physics Class" /></label><div className="modal-row2"><label>开始<input type="time" value={fmtTime(value.start_minute)} onChange={(event) => setValue({ ...value, start_minute: parseTime(event.target.value) })} /></label><label>结束<input type="time" value={fmtTime(value.end_minute)} onChange={(event) => setValue({ ...value, end_minute: parseTime(event.target.value) })} /></label></div><label>日期<select value={value.day} onChange={(event) => setValue({ ...value, day: event.target.value })}>{DAYS.map((day) => <option key={day}>{day}</option>)}</select></label><label className="cat-label">颜色</label><div className="cat-picker">{CATS.map((cat) => <button type="button" className={`cat-option ${value.cat === cat.id ? 'selected' : ''}`} key={cat.id} title={cat.label} style={{ background: cat.color }} onClick={() => setValue({ ...value, cat: cat.id })} />)}</div><label>图层<select value={value.layer || 'actual'} onChange={(event) => setValue({ ...value, layer: event.target.value })}>{LAYERS.map((layer) => <option key={layer.id} value={layer.id}>{layer.label}</option>)}</select></label><label className="check-row"><input type="checkbox" checked={Boolean(value.repeat)} onChange={(event) => setValue({ ...value, repeat: event.target.checked })} /><span>每周重复</span><span className="check-hint">勾选后每周同一时间自动出现</span></label><label>备注<textarea rows="2" value={value.description || ''} onChange={(event) => setValue({ ...value, description: event.target.value })} placeholder="可选，例如教室地点、准备事项…" /></label><div className="modal-actions">{value.id && <button className="paper-btn danger" onClick={remove}>删除</button>}<span className="spacer" /><button className="paper-btn" onClick={close}>取消</button><button className="paper-btn primary" onClick={save}>保存</button></div></div></div>; }
function Widget({ title, english, children }) { return <section className="caw-card"><div className="caw-head"><span className="caw-name">{title}</span><em>{english}</em></div><div className="caw-body">{children}</div></section>; }
function CalendarView({ month, setMonth, weekStart, setWeekStart, close, nights, deadlines, review }) { const first = new Date(month.getFullYear(), month.getMonth(), 1); const offset = (first.getDay() + 6) % 7; const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, index) => { const day = index - offset + 1; return day < 1 || day > daysInMonth ? null : new Date(month.getFullYear(), month.getMonth(), day); }); const jump = (date) => { if (!date) return; setWeekStart(startOfWeek(date)); close(); }; return <div className="cal-view"><header className="cal-topbar"><button className="paper-btn" onClick={close}>← 周看板</button><h2 className="cal-title">日历<em>Calendar</em></h2><span className="cal-range">2026.8 — 2028.8 · 点任意一周进入该周</span><span className="cal-spacer" /><button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><button className="paper-btn" onClick={() => setMonth(new Date())}>回到本月</button><button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></header><div className="cal-body"><aside className="cal-widgets" id="calWidgetsL"><Widget title="今日专注" english="Today Focus"><p className="caw-sub">把最重要的一件事放在今天。</p><div className="focus-empty">{review ? `本周完成率 ${Math.round((review.tasks?.completion_rate || 0) * 100)}%` : '还没有复盘数据'}</div></Widget><Widget title="截止雷达" english="Deadline Radar"><ul className="wdead">{deadlines.length ? deadlines.map((item) => <li className="wdead-item" key={item.id}><span className="wdead-when">{item.day}</span><span className="wdead-body"><b>{item.text}</b><em>{item.kind === 'exam' ? '考试' : '作业截止'}</em></span></li>) : <li className="caw-empty">本周暂无截止提醒</li>}</ul></Widget><Widget title="天气" english="Weather"><div className="wwweather-today"><span className="wwetter-ico">☀️</span><div><b>24° <i>晴</i></b><span>今天适合专注工作</span></div></div></Widget></aside><div className="cal-scroll"><div className="cal-months"><section className="month-card"><div className="month-tape" /><div className="month-head"><span className="month-title">{month.getFullYear()}年{month.getMonth() + 1}月</span><span className="month-en">{month.toLocaleString('en-US', { month: 'long' })}</span></div><div className="cal-week-head">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span className="cal-dow" key={day}>{day}</span>)}</div><div className="month-grid">{Array.from({ length: cells.length / 7 }, (_, row) => <button className={`week-row ${cells.slice(row * 7, row * 7 + 7).some((date) => date && startOfWeek(date).getTime() === weekStart.getTime()) ? 'cur-week' : ''}`} key={row} onClick={() => jump(cells[row * 7])}>{cells.slice(row * 7, row * 7 + 7).map((date, index) => <span className={`cal-day ${!date ? 'blank' : ''} ${index > 4 ? 'weekend' : ''}`} key={date ? date.toISOString() : `blank-${index}`}><span className="cal-num">{date?.getDate()}</span><span className="cal-badges">{date && nights.some((item) => item.date === isoDate(date)) && <span className="cal-moon">🌙</span>}{date && deadlines.some((item) => item.date === isoDate(date)) && <span className="cal-moon">⚠️</span>}</span></span>)}</button>)}</div></section></div></div><aside className="cal-widgets" id="calWidgetsR"><Widget title="明天速览" english="Tomorrow"><ul className="wtmr"><li><span className="wtmr-time">09:00</span><span className="wtmr-title">整理本周计划</span></li><li><span className="wtmr-time">14:00</span><span className="wtmr-title">留出一段深度工作</span></li></ul></Widget><Widget title="快速记录" english="Quick Capture"><textarea rows="3" placeholder="想到什么就写下来…" /></Widget><Widget title="熬夜档案" english="Night Owl Archive"><p className="caw-sub">本周 {nights.length} 次熬夜记录</p><div className="night-archive">{nights.map((item) => <span key={item.id}>🌙 {item.text}</span>)}</div></Widget></aside></div></div>; }

const rootContainer = document.getElementById('root');
const rootKey = '__weeklyboardReactRoot';
const reactRoot = window[rootKey] || (window[rootKey] = createRoot(rootContainer));
reactRoot.render(<App />);
