import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { usePomodoro, PomodoroPanel, PomodoroSwitch, PomodoroBreakdown } from './Pomodoro.jsx';
import CalendarSubscriptions, { SubscriptionEvent } from './CalendarSubscriptions.jsx';
import { DeadlineList, DeadlineBadge, DeadlineModal, DeadlineTimeMarkers } from './Deadlines.jsx';
import { deadlineTimeRange } from './deadline-layout.mjs';
import LayerControls from './LayerControls.jsx';
import { readLayerView, LAYER_VIEW_KEY, toggleVisibleLayer, selectEditingLayer, layoutDayEvents, fillBackground } from './layer-layout.mjs';

const API = 'http://127.0.0.1:8787/api';
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAY_START = 360;
const DAY_END = 1380;
const CELL_MIN = 10;
const CELL_H = 12;

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
const weekKey = (date) => { const thursday = addDays(startOfWeek(date), 3); return `${thursday.getFullYear()}-W${pad(weekNumber(date))}`; };
const uid = (prefix = 'wb') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const catById = (id) => CATS.find((cat) => cat.id === id) || CATS[CATS.length - 1];
const download = (content, filename, type) => { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 300); };
const tokenClaims = (value) => {
  try {
    const encoded = String(value || '').split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
  } catch { return null; }
};

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
  const [layerView, setLayerView] = useState(() => readLayerView(localStorage));
  const { visible: visibleLayers, active: activeLayer } = layerView;
  const setActiveLayer = useCallback((id) => setLayerView((current) => selectEditingLayer(current, id)), []);
  const toggleLayer = useCallback((id) => setLayerView((current) => toggleVisibleLayer(current, id)), []);
  useEffect(() => { try { localStorage.setItem(LAYER_VIEW_KEY, JSON.stringify(layerView)); } catch { /* Display preferences are optional when storage is unavailable. */ } }, [layerView]);
  const [statsLayer, setStatsLayer] = useState('actual');
  const [activeCat, setActiveCat] = useState('class');
  const [fills, setFills] = useState([]);

  const [inbox, setInbox] = useState([]);
  const [nightNotes, setNightNotes] = useState([]);
  const [deadlines, setDeadlines] = useState([]);
  const [deadlineId, setDeadlineId] = useState(null);
  const selectedDeadline = deadlines.find((item) => item.id === deadlineId);
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
  const [dataRevision, setDataRevision] = useState(0);
  const notify = useCallback((message) => { setToast(message); window.clearTimeout(window.__wbToast); window.__wbToast = window.setTimeout(() => setToast(''), 2600); }, []);
  const call = useCallback(async (path, options = {}) => { const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || '请求失败'); if (options.method && options.method !== 'GET') setDataRevision((value) => value + 1); return body; }, [token]);
  const currentWeekKey = weekKey(weekStart);
  const refresh = useCallback(async () => { const [projectRows, calendarRows, availabilityRows, reviewRow, deadlineRows] = await Promise.all([call('/projects'), call('/calendar'), call('/availability'), call('/review'), call('/calendar/deadlines')]); setProjects(projectRows); setProject((current) => current && projectRows.some((row) => row.id === current.id) ? current : (projectRows[0] || null)); setEvents(calendarRows); setAvailability(availabilityRows); setReview(reviewRow); setDeadlines(deadlineRows); const workWindow = availabilityRows.find((row) => row.kind === 'window'); if (workWindow) { setWindowStart(fmtTime(workWindow.start_minute)); setWindowEnd(fmtTime(workWindow.end_minute)); } }, [call]);
  const pomodoro = usePomodoro({ call, weekKey: currentWeekKey, revision: dataRevision, refresh, notify, active: Boolean(token) });
  const subscriptionChanged = useCallback(async (layer) => { await refresh(); setDataRevision((value) => value + 1); if (layer) { setActiveLayer(layer); setStatsLayer(layer); } }, [refresh]);
  const loadScratch = useCallback(async () => {
    try {
      const rows = await call("/workspace/scratch?week_key=" + encodeURIComponent(currentWeekKey));
      const parsed = { inbox: [], night: [], deadline: [], fill: [] };
      for (const row of rows) if (parsed[row.kind]) parsed[row.kind].push({ ...(row.payload || row), __scratchId: row.id, entity_key: row.entity_key || row.payload?.entity_key });
      setInbox(parsed.inbox); setNightNotes(parsed.night); setFills(parsed.fill);
    } catch { /* scratch API optional during migration */ }
  }, [call, currentWeekKey]);
  useEffect(() => { let active = true; if (token) { const claims = tokenClaims(token); const isDebug = claims?.email === 'debug@weeklyboard.local'; setDebugMode(isDebug); if (claims?.email) setEmail(claims.email); setBooting(false); refresh().catch(() => { localStorage.removeItem('wb-token'); if (active) { setToken(''); setDebugMode(false); setEmail(''); } }); return () => { active = false; }; } fetch(`${API}/auth/debug`).then(async (response) => { if (!response.ok) throw new Error('debug disabled'); return response.json(); }).then((session) => { if (!active || !session.token) return; localStorage.setItem('wb-token', session.token); setToken(session.token); setDebugMode(Boolean(session.debugMode)); setEmail(session.user?.email || ''); }).catch(() => active && setBooting(false)); return () => { active = false; }; }, [token, refresh]);
  useEffect(() => { if (!project || !token) return; call(`/projects/${project.id}/tasks`).then(setTasks).catch(() => setTasks([])); }, [call, project, token]);
  useEffect(() => { if (token) loadScratch(); }, [token, loadScratch]);
  useEffect(() => {
    const closeOverlays = (event) => {
      if (event.key !== 'Escape') return;
      if (deadlineId) return setDeadlineId(null);
      if (eventModal) return setEventModal(null);
      if (calendarOpen) return setCalendarOpen(false);
      if (layerOpen) return setLayerOpen(false);
      if (backupOpen) return setBackupOpen(false);
    };
    window.addEventListener('keydown', closeOverlays);
    return () => window.removeEventListener('keydown', closeOverlays);
  }, [backupOpen, calendarOpen, eventModal, layerOpen, deadlineId]);
  const fixedRows = useMemo(() => availability.filter((row) => row.kind === 'fixed'), [availability]);
  const normalizedEvents = useMemo(() => events.filter((event) => !event.week_key || event.week_key === currentWeekKey || (event.repeat_rule === 'weekly' && event.layer !== 'actual')).map((event) => ({ ...event, layer: event.layer || 'actual', cat: event.category || event.cat || 'other', source: event.source || 'calendar' })), [events, currentWeekKey]);
  const visibleEvents = useMemo(() => {
    const fixed = fixedRows.map((row, index) => ({ id: `fixed-${index}-${row.day}-${row.start_minute}`, title: row.title || '固定事项', day: row.day, start_minute: row.start_minute, end_minute: row.end_minute, layer: 'fixed', cat: 'class', source: 'fixed', locked: 1 }));
    const planned = Array.isArray(window.__wbPlan?.blocks) ? window.__wbPlan.blocks.map((block, index) => ({ ...block, id: `plan-${block.draft_id || block.id || index}`, layer: 'flex', cat: block.category || block.cat || 'study', source: 'plan', title: block.title || block.task_title || '规划任务' })) : [];
    return [...fixed, ...normalizedEvents, ...planned].filter((event) => visibleLayers.includes(event.layer) && !event.deadline_kind);


  }, [visibleLayers, fixedRows, normalizedEvents, busy, planVersion, currentWeekKey]);
  const currentWeekDeadlines = deadlines.filter((item) => item.weekKey === currentWeekKey);
  const timelineDeadlines = currentWeekDeadlines.filter((item) => visibleLayers.length > 0 && (!item.layer || visibleLayers.includes(item.layer)));
  const timelineRange = deadlineTimeRange([...timelineDeadlines, ...visibleEvents.filter((event) => !event.all_day).flatMap((event) => [{ due_minute: Number(event.start_minute) }, { due_minute: Number(event.end_minute) - 1 }])], DAY_START, DAY_END);
  const currentWeekNights = nightNotes.filter((item) => item.weekKey === currentWeekKey);
  const stats = useMemo(() => { const totals = Object.fromEntries(CATS.map((cat) => [cat.id, 0])); (statsLayer === 'fixed' ? [...fixedRows, ...normalizedEvents.filter((event) => event.layer === 'fixed' && !event.all_day)] : normalizedEvents.filter((event) => event.layer === statsLayer && !event.all_day)).forEach((event) => { const cat = event.cat || event.category || 'other'; totals[cat in totals ? cat : 'other'] += Math.max(0, event.end_minute - event.start_minute); }); fills.filter((fill) => fill.weekKey === currentWeekKey && fill.layer === statsLayer).forEach((fill) => { totals[fill.cat] += CELL_MIN; }); return { totals, total: Object.values(totals).reduce((sum, value) => sum + value, 0) }; }, [currentWeekKey, fills, statsLayer, fixedRows, normalizedEvents]);
  const authenticate = async () => { try { const response = await fetch(`${API}/auth/${authMode === 'login' ? 'login' : 'register'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); const body = await response.json(); if (!response.ok || !body.token) throw new Error(body.error || '认证失败'); localStorage.setItem('wb-token', body.token); setToken(body.token); setEmail(body.user?.email || email); } catch (error) { notify(error.message); } };
  const selectProject = async (row) => { setProject(row); try { setTasks(await call(`/projects/${row.id}/tasks`)); } catch { setTasks([]); } };
  const createProject = async () => { if (!newProject.trim()) return notify('先写项目名称'); try { const row = await call('/projects', { method: 'POST', body: JSON.stringify({ title: newProject.trim(), description: projectDescription.trim(), priority: 3 }) }); setProjects((items) => [row, ...items]); setProject(row); setTasks([]); setNewProject(''); setProjectDescription(''); notify('项目已写入 SQL'); } catch (error) { notify(error.message); } };
  const createTask = async (title = newTask, options = {}) => { if (!project) return notify('先选择项目'); if (!String(title).trim()) return notify('任务不能为空'); try { const row = await call(`/projects/${project.id}/tasks`, { method: 'POST', body: JSON.stringify({ title: String(title).trim(), estimate_minutes: options.estimate_minutes || 30, priority: options.priority || 3 }) }); setTasks((items) => [...items, row]); setNewTask(''); notify('任务已加入任务池'); return row; } catch (error) { notify(error.message); return null; } };
  const toggleTask = async (task) => { if (pomodoro.data?.rows.some((row) => row.task_id === task.id)) return pomodoro.complete(task, DAYS[(new Date().getDay() + 6) % 7]); try { const row = await call(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: task.status === 'done' ? 'todo' : 'done' }) }); setTasks((items) => items.map((item) => item.id === row.id ? row : item)); setReview(await call('/review')); } catch (error) { notify(error.message); } };
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
  const addEvent = (day, startMinute, extra = {}) => { if (!visibleLayers.length) return notify('请先勾选一个图层'); const start = Math.max(timelineRange.start, Math.min(timelineRange.end - 15, Math.round(startMinute / CELL_MIN) * CELL_MIN)); setEventModal({ id: null, title: extra.title || '', day, start_minute: start, end_minute: Math.min(timelineRange.end, start + (extra.duration || 60)), layer: activeLayer, cat: extra.cat || activeCat, description: '', repeat: false, week_key: currentWeekKey, task_id: extra.task_id ?? null }); };
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
    const localEvent = { ...eventModal, title: eventModal.title.trim(), start_minute: Number(eventModal.start_minute), end_minute: Number(eventModal.end_minute), category: eventModal.cat || activeCat, week_key: currentWeekKey };
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
    try { await call(`/calendar/events/${eventModal.id}`, { method: 'DELETE' }); setEvents((items) => items.filter((item) => item.id !== eventModal.id)); setEventModal(null); notify('日程已删除'); } catch (error) { notify(`删除失败：${error.message}`); }
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
    if (!visibleLayers.length) return notify('请先勾选一个图层');
    const raw = event.dataTransfer.getData('text/plain');
    if (!raw) return;
    const targetStart = Math.max(timelineRange.start, Math.min(timelineRange.end - 15, Math.round(minute / CELL_MIN) * CELL_MIN));
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
      const patch = { day, start_minute: targetStart, end_minute: Math.min(timelineRange.end, targetStart + duration) };
      setEvents((items) => items.map((item) => item.id === current.id ? { ...item, ...patch } : item));
      persistEventMove(current.id, patch);
      return;
    }
    if (raw.startsWith('task:')) { const task = tasks.find((item) => String(item.id) === raw.slice(5)); if (task) addEvent(day, minute, { title: task.title, duration: task.estimate_minutes || 30, task_id: task.id, cat: task.title.includes('作业') ? 'study' : 'class' }); }
    else if (raw.startsWith('inbox:')) { const item = inbox.find((row) => row.id === raw.slice(6)); if (item) addEvent(day, minute, { title: item.text, duration: 30, cat: 'other' }); }
    else if (raw === 'night') { const item = { id: uid('night'), weekKey: currentWeekKey, day, date: isoDate(addDays(weekStart, DAYS.indexOf(day))), text: nightDraft.text.trim() || '熬夜', sleep: nightDraft.sleep }; setNightNotes((items) => [...items, item]); persistScratch('night', item).then((saved) => saved && setNightNotes((items) => items.map((row) => row.id === item.id ? { ...row, __scratchId: saved.id, entity_key: saved.entity_key } : row))); notify('熬夜贴纸已贴到周看板'); }
    else if (raw === 'deadline') { if (!deadlineDraft.text.trim()) return notify('先写截止内容'); const item = { id: uid('deadline'), weekKey: currentWeekKey, day, date: isoDate(addDays(weekStart, DAYS.indexOf(day))), text: deadlineDraft.text.trim(), kind: deadlineDraft.kind, due_minute: targetStart }; setDeadlines((items) => [...items, item]); persistScratch('deadline', item).then((saved) => saved && setDeadlines((items) => items.map((row) => row.id === item.id ? { ...row, __scratchId: saved.id, entity_key: saved.entity_key } : row))); notify('截止警示已贴到周看板'); }
  };
  const previewResize = (eventId, endMinute) => {
    const plan = window.__wbPlan;
    if (String(eventId).startsWith('plan-')) {
      updatePlanDraft(eventId, { end_minute: Math.max(timelineRange.start + CELL_MIN, Math.min(timelineRange.end, Math.round(endMinute / CELL_MIN) * CELL_MIN)) });
      return;
    }
    const current = events.find((item) => String(item.id) === String(eventId));
    if (!current || current.locked) return;
    const next = Math.max(Number(current.start_minute) + CELL_MIN, Math.min(timelineRange.end, Math.round(endMinute / CELL_MIN) * CELL_MIN));
    setEvents((items) => items.map((item) => item.id === current.id ? { ...item, end_minute: next } : item));
  };
  const finishResize = async (eventId, endMinute) => {
    if (String(eventId).startsWith('plan-')) { notify('草案时长已调整，确认后才会写入 SQL'); return; }
    const current = events.find((item) => String(item.id) === String(eventId));
    if (!current || current.locked) return notify('锁定日程不可调整');
    await persistEventMove(current.id, { end_minute: Math.max(Number(current.start_minute) + CELL_MIN, Math.min(timelineRange.end, Math.round(endMinute / CELL_MIN) * CELL_MIN)) });
  };
  const resizeEvent = async (eventId, endMinute) => {
    const current = events.find((item) => String(item.id) === String(eventId));
    if (!current || current.locked) return notify('锁定日程不可调整');
    const patch = { end_minute: Math.max(Number(current.start_minute) + CELL_MIN, Math.min(timelineRange.end, Math.round(endMinute / CELL_MIN) * CELL_MIN)) };
    setEvents((items) => items.map((item) => item.id === current.id ? { ...item, ...patch } : item));
    await persistEventMove(current.id, patch);
  };
  const paint = async (dayIndex, minute) => {
    if (!visibleLayers.length) return notify('请先勾选一个图层');
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
  const removeDeadline = async (item) => {
    if (!item.event_id) return removeScratchItem('deadline', item, setDeadlines);
    try { await call(`/calendar/events/${item.event_id}`, { method: 'DELETE' }); await refresh(); }
    catch (error) { notify(error.message); }
  };
  const updateDeadline = async (item, patch) => {
    try {
      if (item.event_id) {
        const saved = await call(`/calendar/deadlines/${item.event_id}`, { method: 'PATCH', body: JSON.stringify(patch) });
        setDeadlines((items) => items.map((row) => row.id === item.id ? saved : row));
      } else {
        const next = { ...item, ...patch };
        const saved = await persistScratch('deadline', next);
        if (saved) setDeadlines((items) => items.map((row) => row.id === item.id ? { ...next, __scratchId: saved.id } : row));
      }
    } catch (error) { notify(error.message); }
  };
  const toggleDeadline = (item) => updateDeadline(item, { completed: !item.completed });
  const changeDeadlineKind = (item, kind) => updateDeadline(item, { kind });
  const exportBackup = async () => { try { const backup = await call('/backup'); download(JSON.stringify(backup, null, 2), `weeklyboard-${currentWeekKey}.json`, 'application/json'); notify('SQL 备份已导出'); } catch (error) { notify(`备份失败：${error.message}`); } };
  const restoreBackup = async (change) => { const file = change.target.files?.[0]; if (!file) return; try { const backup = JSON.parse(await file.text()); if (!backup?.tables) throw new Error('备份文件缺少 tables'); if (!window.confirm('恢复备份会替换当前账号的项目、任务、日程和贴纸，继续吗？')) return; await call('/backup/restore', { method: 'POST', body: JSON.stringify({ backup }) }); setProject(null); setTasks([]); await refresh(); await loadScratch(); notify('SQL 备份已恢复'); } catch (error) { notify(`恢复失败：${error.message}`); } finally { change.target.value = ''; } };
  const exportICS = async () => { try { const response = await fetch(`${API}/calendar.ics`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('导出失败'); download(await response.text(), 'weeklyboard.ics', 'text/calendar'); notify('ICS 已导出'); } catch (error) { notify(error.message); } };
  const importICS = async (change) => { const file = change.target.files?.[0]; if (!file) return; try { const response = await call('/calendar/import', { method: 'POST', body: JSON.stringify({ ics: await file.text(), week_key: currentWeekKey, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }); setEvents(await call('/calendar')); setActiveLayer('once'); setStatsLayer('once'); notify(`已导入 ${response.imported} 个事件`); } catch (error) { notify(error.message); } finally { change.target.value = ''; } };
  const logout = () => { localStorage.removeItem('wb-token'); setToken(''); setProjects([]); setProject(null); setTasks([]); };
  if (booting) return <Auth loading />;
  if (!token) return <Auth email={email} setEmail={setEmail} password={password} setPassword={setPassword} mode={authMode} setMode={setAuthMode} submit={authenticate} />;
  const displayTasks = tasks.map((task) => { const row = pomodoro.data?.rows.find((row) => row.task_id === task.id); return row ? { ...task, status: row.complete ? 'done' : 'todo', pomodoro: pomodoro.enabled ? row : undefined } : task; });
  const timeReview = pomodoro.enabled && pomodoro.data ? { ...review, tasks: { ...review?.tasks, completion_rate: pomodoro.data.total.percent / 100 } } : review;
  return <div className="app"><Topbar visibleLayers={visibleLayers} toggleLayer={toggleLayer} subscriptions={<CalendarSubscriptions layers={LAYERS} call={call} onChanged={subscriptionChanged} notify={notify} />} pomodoro={pomodoro} weekStart={weekStart} setWeekStart={setWeekStart} setCalendarOpen={setCalendarOpen} layerOpen={layerOpen} setLayerOpen={setLayerOpen} backupOpen={backupOpen} setBackupOpen={setBackupOpen} activeLayer={activeLayer} setActiveLayer={setActiveLayer} debugMode={debugMode} email={email} onImport={importICS} onExportICS={exportICS} onBackup={exportBackup} onRestore={restoreBackup} logout={logout} /><div className="board"><a className="mobile-board-jump" href="#weekTimeline">↓ 查看本周时间轴</a><Sidebar {...{ pomodoro, projects, project, selectProject, newProject, setNewProject, projectDescription, setProjectDescription, createProject, tasks: displayTasks, newTask, setNewTask, createTask, toggleTask, removeTask, inbox, newInbox, setNewInbox, addInboxItem, removeInbox, convertInbox, nightDraft, setNightDraft, deadlineDraft, setDeadlineDraft, windowStart, setWindowStart, windowEnd, setWindowEnd, saveAvailability, fixedDraft, setFixedDraft, saveFixed, stats, statsLayer, setStatsLayer, review, makePlan, busy, confirmPlan, currentWeekNights, currentWeekDeadlines, removeNight, removeDeadline, toggleDeadline, openDeadline: setDeadlineId }} /><main className="timeline-pane"><PomodoroPanel controller={pomodoro} categories={CATS} /><Legend activeCat={activeCat} setActiveCat={setActiveCat} activeLayer={activeLayer} setActiveLayer={setActiveLayer} /><LayerControls layers={LAYERS} visibleLayers={visibleLayers} activeLayer={activeLayer} onToggle={toggleLayer} onSelect={setActiveLayer} /><Timeline visibleLayers={visibleLayers} timeRange={timelineRange} weekStart={weekStart} events={visibleEvents} fills={fills} currentWeekKey={currentWeekKey} activeLayer={activeLayer} activeCat={activeCat} onPaint={paint} onDrop={onDropToGrid} onOpenEvent={(event) => setEventModal(event)} onCreate={addEvent} onResizePreview={previewResize} onResizeEnd={finishResize} nights={currentWeekNights} deadlines={timelineDeadlines} onOpenDeadline={(item) => setDeadlineId(item.id)} onRemoveNight={removeNight} onRemoveDeadline={removeDeadline} /></main></div>{calendarOpen && <CalendarView month={calendarMonth} setMonth={setCalendarMonth} weekStart={weekStart} setWeekStart={setWeekStart} close={() => setCalendarOpen(false)} nights={currentWeekNights} deadlines={deadlines} onOpenDeadline={(item) => setDeadlineId(item.id)} onToggleDeadline={toggleDeadline} review={timeReview} />}{selectedDeadline && <DeadlineModal item={selectedDeadline} onClose={() => setDeadlineId(null)} onToggle={toggleDeadline} onKind={changeDeadlineKind} />}{eventModal?.subscription_id ? <SubscriptionEvent event={eventModal} close={() => setEventModal(null)} /> : eventModal && <EventModal taskOptions={pomodoro.enabled ? pomodoro.data?.rows.filter((row) => row.task_id) || [] : []} value={eventModal} setValue={setEventModal} save={saveEvent} remove={deleteEvent} close={() => setEventModal(null)} />}{toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}</div>;
}

function Auth({ loading, email, setEmail, password, setPassword, mode, setMode, submit }) { return <div className="auth-screen"><div className="auth-paper sketchy"><div className="auth-brand"><StarIcon /><div><h1>周看板</h1><span>Weekly Planner</span></div></div>{loading ? <><p className="auth-lead">正在启动调试工作区…</p><span className="debug-badge">DEBUG MODE · SQL DATABASE</span></> : <><p className="auth-lead">把目标，变成这一周能执行的计划。</p><label className="field-label">邮箱<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label><label className="field-label">密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" /></label><button className="paper-btn primary wide" onClick={submit}>{mode === 'login' ? '进入工作台' : '创建账号'}</button><button className="text-btn" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? '还没有账号？创建一个' : '已有账号，直接登录'}</button></>}</div></div>; }
function Topbar({ visibleLayers, toggleLayer, subscriptions, pomodoro, weekStart, setWeekStart, setCalendarOpen, layerOpen, setLayerOpen, backupOpen, setBackupOpen, activeLayer, setActiveLayer, debugMode, email, onImport, onExportICS, onBackup, onRestore, logout }) { return <header className="topbar"><div className="brand"><button className="star-btn" onClick={() => setCalendarOpen(true)} title="打开日历视图" aria-label="打开日历视图"><StarIcon /></button><h1>周看板</h1><span className="brand-en">Weekly Planner</span></div><div className="weeknav"><button className="icon-btn" onClick={() => setWeekStart((date) => addDays(date, -7))} aria-label="上一周">‹</button><button className="today-btn" onClick={() => setWeekStart(startOfWeek(new Date()))}>本周</button><button className="icon-btn" onClick={() => setWeekStart((date) => addDays(date, 7))} aria-label="下一周">›</button><span className="week-label">{weekStart.getFullYear()}年第{weekNumber(weekStart)}周 · {fmtDate(weekStart)} – {fmtDate(addDays(weekStart, 6))}</span></div><div className="top-actions"><PomodoroSwitch controller={pomodoro} /><span className="save-dot on" title="已自动保存" />{subscriptions}<label className="paper-btn">导入 ICS<input type="file" accept=".ics,.txt,text/calendar" hidden onChange={onImport} /></label><button className="paper-btn" onClick={onExportICS}>导出 ICS</button><button className="paper-btn" onClick={() => window.print()}>导出 PNG</button><div className="backup-wrap"><button className="paper-btn" aria-expanded={backupOpen} aria-controls="backup-popover" onClick={() => setBackupOpen(!backupOpen)}>💾 备份</button>{backupOpen && <div id="backup-popover" className="layer-popover backup-popover" role="dialog" aria-label="数据备份"><h4>数据备份 <em>Backup</em></h4><p className="popover-note">备份包含项目、任务、日程、收件箱、涂色与贴纸。</p><div className="data-btns"><button className="paper-btn primary" onClick={onBackup}>⬇ 导出备份 (JSON)</button><label className="paper-btn">⬆ 恢复备份<input type="file" accept=".json,application/json" hidden onChange={onRestore} /></label></div></div>}</div><div className="layer-wrap"><button className="paper-btn" aria-expanded={layerOpen} aria-controls="layer-popover" onClick={() => setLayerOpen(!layerOpen)}>图层</button>{layerOpen && <div id="layer-popover" className="layer-popover" role="dialog" aria-label="图层"><h4>图层 <em>Layers</em></h4><LayerControls compact layers={LAYERS} visibleLayers={visibleLayers} activeLayer={activeLayer} onToggle={toggleLayer} onSelect={setActiveLayer} /></div>}</div><span className={debugMode ? 'debug-badge compact' : 'user-chip'}>{debugMode ? 'DEBUG MODE' : email}</span><button className="text-btn" onClick={logout}>退出</button></div></header>; }
function Panel({ title, english, tape = 'tape-yellow', children, className = '' }) { return <section className={`panel sketchy ${className}`}><h2 className={`panel-title ${tape}`}>{title} <em>{english}</em></h2>{children}</section>; }
function Sidebar(props) { return <aside className="sidebar"><Panel title="待分配任务" english="Task Pool"><div className="add-row"><input value={props.newTask} onChange={(event) => props.setNewTask(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && props.createTask()} placeholder="添加一个任务…" /><button className="mini-btn" onClick={() => props.createTask()} aria-label="添加任务">＋</button></div><ul className="task-list">{props.tasks.map((task) => <li className="task" draggable key={task.id} onDragStart={(event) => event.dataTransfer.setData('text/plain', `task:${task.id}`)}><span className={`task-dot ${task.status === 'done' ? 'done' : ''}`} /><div className="task-body"><strong className={`task-title ${task.status === 'done' ? 'completed' : ''}`}>{task.title}</strong><small>{task.pomodoro ? `${task.pomodoro.actual_units} / ${task.pomodoro.plan_units} 番茄钟` : `${task.estimate_minutes || 30} 分钟 · 优先级 ${task.priority || 3}`}</small>{task.pomodoro?.pending_units > 0 && <span className="pomo-task-meta">还需安排 {task.pomodoro.pending_units} 个番茄钟</span>}<input className="task-note" placeholder="本周具体任务…" /></div><div className="task-actions"><button aria-label={`${task.status === 'done' ? '标记未完成' : '完成'}任务：${task.title}`} disabled={props.pomodoro.pending || !props.pomodoro.data} onClick={() => props.toggleTask(task)}>{task.status === 'done' ? '↺' : '✓'}</button><button aria-label={`删除任务：${task.title}`} onClick={() => props.removeTask(task)}>×</button></div></li>)}</ul><p className="panel-hint"><span className="mini-arrow">→</span>拖到时间轴安排（默认仅本周）；任务保留在池中，可多次安排不同内容</p></Panel><Panel title="收件箱" english="Inbox" tape="tape-cream"><div className="add-row"><input value={props.newInbox} onChange={(event) => props.setNewInbox(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && props.addInboxItem()} placeholder="记点什么…" /><button className="mini-btn" onClick={props.addInboxItem} aria-label="添加便签">＋</button></div><ul className="inbox-list">{props.inbox.map((item) => <li className="inbox-item" draggable key={item.id} onDragStart={(event) => event.dataTransfer.setData('text/plain', `inbox:${item.id}`)}><span className="inbox-text">{item.text}</span><div className="inbox-actions"><button onClick={() => props.convertInbox(item)}>转任务</button><button onClick={() => props.removeInbox(item)} aria-label={`删除 ${item.text}`}>×</button></div></li>)}</ul><p className="panel-hint"><span className="mini-arrow">→</span>便签可单独拖到时间轴安排 · 每周自动清空</p></Panel><Panel title="熬夜贴纸" english="Night Owl" tape="tape-teal"><div className="night-sticker" draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', 'night')}><span className="night-moon">🌙</span><div className="night-fields"><input value={props.nightDraft.text} onChange={(event) => props.setNightDraft({ ...props.nightDraft, text: event.target.value })} placeholder="熬夜干了什么…" /><input type="time" value={props.nightDraft.sleep} onChange={(event) => props.setNightDraft({ ...props.nightDraft, sleep: event.target.value })} /></div></div><p className="panel-hint"><span className="mini-arrow">→</span>填好后把贴纸拖到某一天的日程上</p>{props.currentWeekNights?.length > 0 && <ul className="scratch-list">{props.currentWeekNights.map((item) => <li key={item.id}><span>🌙 {item.text}</span><button aria-label={`删除熬夜记录 ${item.text}`} onClick={() => props.removeNight(item)}>×</button></li>)}</ul>}</Panel><Panel title="截止警示" english="Deadline" tape="tape-red"><div className="night-sticker dl-sticker" draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', 'deadline')}><span className="night-moon">⚠️</span><div className="night-fields"><input value={props.deadlineDraft.text} onChange={(event) => props.setDeadlineDraft({ ...props.deadlineDraft, text: event.target.value })} placeholder="什么要交 / 要考？" /><select value={props.deadlineDraft.kind} onChange={(event) => props.setDeadlineDraft({ ...props.deadlineDraft, kind: event.target.value })}><option value="hw">作业截止</option><option value="exam">考试</option></select></div></div><p className="panel-hint"><span className="mini-arrow">→</span>拖到课程或某一天；日历页截止雷达同步显示</p><DeadlineList items={props.currentWeekDeadlines} onOpen={(item) => props.openDeadline(item.id)} onToggle={props.toggleDeadline} onRemove={props.removeDeadline} /></Panel><Panel title="分类统计" english="Weekly Stats" tape="tape-teal"><div className="stats-layer-row"><span className="stats-mini-label">统计图层</span><select className="paper-select" value={props.statsLayer} onChange={(event) => props.setStatsLayer(event.target.value)}>{LAYERS.map((layer) => <option key={layer.id} value={layer.id}>{layer.label}</option>)}</select></div><ul className="stats-list">{CATS.map((cat) => <li className={`stat-row ${props.stats.totals[cat.id] ? '' : 'zero'}`} key={cat.id}><i className="stat-dot" style={{ background: cat.color }} /><span className="stat-label">{cat.label}</span><span className="stat-time">{Math.round(props.stats.totals[cat.id] / 60 * 10) / 10}h</span></li>)}</ul><p className="stats-total">本周合计 {Math.round(props.stats.total / 60 * 10) / 10} 小时</p><p className="stats-note">统计当前周内，当前图层中日程与涂色的总时长</p>{props.pomodoro.enabled && <PomodoroBreakdown data={props.pomodoro.data} categories={CATS} />}</Panel><Panel title="我的项目" english="Projects" tape="tape-cream"><div className="add-row"><input value={props.newProject} onChange={(event) => props.setNewProject(event.target.value)} placeholder="新项目名称…" /><button className="mini-btn" onClick={props.createProject} aria-label="新建项目">＋</button></div><textarea value={props.projectDescription} onChange={(event) => props.setProjectDescription(event.target.value)} rows="2" placeholder="目标与背景（可选）" />{props.projects.map((item) => <button className={`project-chip ${props.project?.id === item.id ? 'chosen' : ''}`} key={item.id} onClick={() => props.selectProject(item)}><span className="project-dot" />{item.title}<small>{props.project?.id === item.id ? '正在查看' : '打开项目'}</small></button>)}</Panel><Panel title="智能规划" english="DeepSeek" className="planner-panel"><p className="panel-hint">{props.project ? `为「${props.project.title}」生成可确认草案。` : '选择项目后开启规划。'}</p><div className="planner-actions"><button className="paper-btn primary" disabled={!props.project || props.busy} onClick={() => props.makePlan(true)}>{props.busy ? '规划中…' : '✦ DeepSeek 规划'}</button><button className="paper-btn" disabled={!props.project || props.busy} onClick={() => props.makePlan(false)}>⚙ 自动排程</button></div><button className="paper-btn primary small" onClick={props.confirmPlan}>确认写入周看板</button></Panel><button className="reset-link" onClick={() => window.location.reload()}>重置为示例数据</button></aside>; }
function Legend({ activeCat, setActiveCat, activeLayer, setActiveLayer }) { return <div className="legend"><span className="legend-label">颜色分类</span><div className="swatches" role="toolbar" aria-label="日程颜色分类"><button type="button" aria-pressed={activeCat === 'erase'} className={`swatch swatch-erase ${activeCat === 'erase' ? 'active' : ''}`} onClick={() => setActiveCat('erase')}><span className="swatch-dot swatch-dot-erase" /><span className="swatch-text">擦除</span></button>{CATS.map((cat) => <button type="button" aria-pressed={activeCat === cat.id} className={`swatch ${activeCat === cat.id ? 'active' : ''}`} key={cat.id} onClick={() => setActiveCat(cat.id)}><span className="swatch-dot" style={{ background: cat.color }} /><span className="swatch-text">{cat.label}</span></button>)}</div><span className="legend-hint">选择分类后可在时间轴涂色</span></div>; }
function Timeline({ visibleLayers, timeRange, weekStart, events, fills, currentWeekKey, activeLayer, activeCat, onPaint, onDrop, onOpenEvent, onCreate, onResizePreview, onResizeEnd, nights, deadlines, onOpenDeadline }) { const dayStart = timeRange.start; const dayEnd = timeRange.end; const rows = (dayEnd - dayStart) / 30; const deadlineHeight = deadlines.length ? Math.min(3, Math.max(...DAYS.map((day) => deadlines.filter((item) => item.day === day).length))) * 28 + 8 : 0; const allDayHeight = events.some((event) => event.all_day) ? Math.min(3, Math.max(...DAYS.map((day) => events.filter((event) => event.day === day && event.all_day).length))) * 26 + 8 : 0; const now = new Date(); const todayIndex = (now.getDay() + 6) % 7; return <div className="timeline-scroll" id="weekTimeline"><div className="timeline" style={{ '--rows': rows, '--grid-h': `${rows * 30 / CELL_MIN * CELL_H}px` }}><div className="tl-gutter" style={allDayHeight || deadlineHeight ? { gridTemplateRows: `var(--head-h) ${deadlineHeight ? `${deadlineHeight}px` : ''} ${allDayHeight ? `${allDayHeight}px` : ''} repeat(var(--rows), var(--row-h))` } : undefined}><div className="gutter-head" />{deadlineHeight > 0 && <div className="all-day-label" style={{ height: deadlineHeight }}>截止</div>}{allDayHeight > 0 && <div className="all-day-label" style={{ height: allDayHeight }}>全天</div>}{Array.from({ length: rows }, (_, row) => <div className={`gutter-cell ${row % 2 === 0 ? 'hour' : 'half'}`} key={row}>{row % 2 === 0 ? <span className="hour-label">{fmtTime(dayStart + row * 30)}</span> : <span className="half-label">{fmtTime(dayStart + row * 30)}</span>}<i className="half-tick" /></div>)}</div>{DAYS.map((day, dayIndex) => { const date = addDays(weekStart, dayIndex); const dayEvents = events.filter((event) => event.day === day && !event.all_day); const dayFills = fills.filter((fill) => fill.weekKey === currentWeekKey && visibleLayers.includes(fill.layer) && fill.day === dayIndex); return <div className={`day-col ${dayIndex === todayIndex && startOfWeek(now).getTime() === weekStart.getTime() ? 'today' : ''}`} key={day}><div className="day-head"><span className="dow">{day}</span><span className="date-num">{fmtDate(date)}</span><span className="night-badges">{nights.filter((item) => item.day === day).map((item) => <button className="night-badge" key={item.id} title={item.text}>🌙 <em>{item.text}</em></button>)}</span></div>{deadlineHeight > 0 && <div className="day-deadlines" style={{ height: deadlineHeight }}>{deadlines.filter((item) => item.day === day).map((item) => <DeadlineBadge key={item.id} item={item} onOpen={onOpenDeadline} />)}</div>}{allDayHeight > 0 && <div className="all-day-events" style={{ height: allDayHeight }}>{events.filter((event) => event.day === day && event.all_day).map((event) => <button className="all-day-event" key={event.id} title={event.title} onClick={() => onOpenEvent(event)}>{event.title}</button>)}</div>}<div className="day-grid" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const minute = dayStart + Math.round((event.clientY - rect.top) / CELL_H) * CELL_MIN; onDrop(event, day, minute); }} onDoubleClick={(event) => { if (event.target.closest('.event, .deadline-time-layer')) return; const rect = event.currentTarget.getBoundingClientRect(); const minute = dayStart + Math.round((event.clientY - rect.top) / CELL_H) * CELL_MIN; onCreate(day, minute); }}><div className="grid-background" role="grid" aria-label={`${day} 时间轴`}>{Array.from({ length: rows }, (_, row) => <div className="hrow" role="row" key={row}>{[0, 1, 2].map((slot) => { const minute = dayStart + row * 30 + slot * 10; const minuteFills = dayFills.filter((item) => item.minute === minute); const fill = minuteFills.length > 0; return <button type="button" role="gridcell" tabIndex={-1} className={`cell10 ${fill ? 'paint-active' : ''}`} key={minute} onClick={() => onPaint(dayIndex, minute)} style={fill ? { background: fillBackground(minuteFills, (cat) => catById(cat).color) } : undefined} aria-label={`${day} ${fmtTime(minute)}`} />; })}</div>)}</div><div className="events-layer">{layoutDayEvents(dayEvents).map(({ event, column, columns, span }) => { const top = ((event.start_minute - dayStart) / CELL_MIN) * CELL_H; const height = Math.max(2, ((event.end_minute - event.start_minute) / CELL_MIN) * CELL_H - 1); const cat = catById(event.cat); const setEndByKeyboard = (keyboardEvent) => { if (event.locked || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(keyboardEvent.key)) return; keyboardEvent.preventDefault(); keyboardEvent.stopPropagation(); let nextEnd = Number(event.end_minute); if (keyboardEvent.key === 'ArrowUp') nextEnd -= CELL_MIN; if (keyboardEvent.key === 'ArrowDown') nextEnd += CELL_MIN; if (keyboardEvent.key === 'Home') nextEnd = Number(event.start_minute) + CELL_MIN; if (keyboardEvent.key === 'End') nextEnd = dayEnd; nextEnd = Math.max(Number(event.start_minute) + CELL_MIN, Math.min(dayEnd, nextEnd)); onResizePreview?.(event.id, nextEnd); onResizeEnd?.(event.id, nextEnd); }; return <article className={`event ${columns > 1 ? 'event-split' : ''} ${height < 44 ? 'event-compact' : ''} ${height < 18 ? 'event-short' : ''}`} key={event.id} data-event-id={event.id} data-layer={event.layer} title={`${event.title} · ${LAYERS.find((layer) => layer.id === event.layer)?.label || event.layer} · ${fmtTime(event.start_minute)}–${fmtTime(event.end_minute)}`} tabIndex={0} aria-label={`${event.title}，${fmtTime(event.start_minute)} 至 ${fmtTime(event.end_minute)}`} style={{ top, height, left: `calc(${column / columns * 100}% + 3px)`, right: 'auto', width: `calc(${span / columns * 100}% - 6px)`, boxSizing: 'border-box', borderLeftColor: cat.color, background: cat.fill }} onClick={(click) => { click.stopPropagation(); onOpenEvent({ ...event, cat: event.cat || 'other' }); }} onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') { keyboardEvent.preventDefault(); onOpenEvent({ ...event, cat: event.cat || 'other' }); } }} draggable={!event.locked} onDragStart={(drag) => drag.dataTransfer.setData('text/plain', `event:${event.id}`)}><strong className="event-title">{event.title}</strong><span className="event-layer-label">{LAYERS.find((layer) => layer.id === event.layer)?.label}</span><span className="event-time">{fmtTime(event.start_minute)} – {fmtTime(event.end_minute)}</span>{event.description && <span className="event-desc">{event.description}</span>}<span className="event-resize" role="slider" tabIndex={event.locked ? -1 : 0} aria-label={`调整 ${event.title} 结束时间`} aria-valuemin={Number(event.start_minute) + CELL_MIN} aria-valuemax={dayEnd} aria-valuenow={Number(event.end_minute)} aria-valuetext={fmtTime(event.end_minute)} onKeyDown={setEndByKeyboard} onPointerDown={(down) => { down.preventDefault(); down.stopPropagation(); if (event.locked) return; const target = down.currentTarget; target.setPointerCapture?.(down.pointerId); const startY = down.clientY; const initialEnd = Number(event.end_minute); let currentEnd = initialEnd; const move = (moveEvent) => { const delta = Math.round((moveEvent.clientY - startY) / CELL_H) * CELL_MIN; currentEnd = Math.max(Number(event.start_minute) + CELL_MIN, Math.min(dayEnd, initialEnd + delta)); onResizePreview?.(event.id, currentEnd); }; const up = () => { target.releasePointerCapture?.(down.pointerId); target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); onResizeEnd?.(event.id, currentEnd); }; target.addEventListener('pointermove', move); target.addEventListener('pointerup', up, { once: true }); target.addEventListener('pointercancel', up, { once: true }); }} /></article>; })}</div><DeadlineTimeMarkers key={`${currentWeekKey}-${activeLayer}-${day}`} items={deadlines.filter((item) => item.day === day)} start={dayStart} end={dayEnd} pixelsPerMinute={CELL_H / CELL_MIN} onOpen={onOpenDeadline} />{todayIndex === dayIndex && startOfWeek(now).getTime() === weekStart.getTime() && now.getHours() * 60 + now.getMinutes() >= dayStart && now.getHours() * 60 + now.getMinutes() <= dayEnd && <div className="now-line" style={{ top: ((now.getHours() * 60 + now.getMinutes() - dayStart) / CELL_MIN) * CELL_H }} />}</div></div>; })}</div></div>; }
function EventModal({ taskOptions, value, setValue, save, remove, close }) { return <div className="modal-mask" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="event-modal-title"><div className="modal-tape" /><h3 id="event-modal-title">{value.id ? '编辑日程' : '新建日程'}</h3><label>标题<input autoFocus value={value.title} onChange={(event) => setValue({ ...value, title: event.target.value })} placeholder="例如：Physics Class" /></label>{value.all_day ? <p>全天</p> : <div className="modal-row2"><label>开始<input type="time" value={fmtTime(value.start_minute)} onChange={(event) => setValue({ ...value, start_minute: parseTime(event.target.value) })} /></label><label>结束<input type="time" value={fmtTime(value.end_minute)} onChange={(event) => setValue({ ...value, end_minute: parseTime(event.target.value) })} /></label></div>}{taskOptions?.length > 0 && <label>对应任务<select aria-label="日程对应任务" value={value.task_id || ''} onChange={(event) => setValue({ ...value, task_id: event.target.value ? Number(event.target.value) : null })}><option value="">独立日程</option>{taskOptions.map((task) => <option value={task.task_id} key={task.task_id}>{task.title}{task.project ? ` · ${task.project}` : ''}</option>)}</select></label>}<label>日期<select value={value.day} onChange={(event) => setValue({ ...value, day: event.target.value })}>{DAYS.map((day) => <option key={day}>{day}</option>)}</select></label><span className="cat-label" id="event-color-label">颜色</span><div className="cat-picker" role="group" aria-labelledby="event-color-label">{CATS.map((cat) => <button type="button" aria-label={cat.label} aria-pressed={value.cat === cat.id} className={`cat-option ${value.cat === cat.id ? 'selected' : ''}`} key={cat.id} title={cat.label} style={{ background: cat.color }} onClick={() => setValue({ ...value, cat: cat.id })} />)}</div><label>图层<select value={value.layer || 'actual'} onChange={(event) => setValue({ ...value, layer: event.target.value })}>{LAYERS.map((layer) => <option key={layer.id} value={layer.id}>{layer.label}</option>)}</select></label><label className="check-row"><input type="checkbox" checked={Boolean(value.repeat ?? (value.repeat_rule === 'weekly'))} onChange={(event) => setValue({ ...value, repeat: event.target.checked })} /><span>每周重复</span><span className="check-hint">勾选后每周同一时间自动出现</span></label><label>备注<textarea rows="2" value={value.description || ''} onChange={(event) => setValue({ ...value, description: event.target.value })} placeholder="可选，例如教室地点、准备事项…" /></label><div className="modal-actions">{value.id && <button className="paper-btn danger" onClick={remove}>删除</button>}<span className="spacer" /><button className="paper-btn" onClick={close}>取消</button><button className="paper-btn primary" onClick={save}>保存</button></div></div></div>; }
function Widget({ title, english, children }) { return <section className="caw-card"><div className="caw-head"><span className="caw-name">{title}</span><em>{english}</em></div><div className="caw-body">{children}</div></section>; }
function CalendarView({ month, setMonth, weekStart, setWeekStart, close, nights, deadlines, review, onOpenDeadline, onToggleDeadline }) { const monthDeadlines = deadlines.filter((item) => item.date?.startsWith(`${month.getFullYear()}-${pad(month.getMonth() + 1)}`)); const first = new Date(month.getFullYear(), month.getMonth(), 1); const offset = (first.getDay() + 6) % 7; const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, index) => { const day = index - offset + 1; return day < 1 || day > daysInMonth ? null : new Date(month.getFullYear(), month.getMonth(), day); }); const jump = (date) => { if (!date) return; setWeekStart(startOfWeek(date)); close(); }; return <div className="cal-view"><header className="cal-topbar"><button className="paper-btn" onClick={close}>← 周看板</button><h2 className="cal-title">日历<em>Calendar</em></h2><span className="cal-range">2026.8 — 2028.8 · 点任意一周进入该周</span><span className="cal-spacer" /><button className="icon-btn" aria-label="上一个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><button className="paper-btn" onClick={() => setMonth(new Date())}>回到本月</button><button className="icon-btn" aria-label="下一个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></header><div className="cal-body"><aside className="cal-widgets" id="calWidgetsL"><Widget title="今日专注" english="Today Focus"><p className="caw-sub">把最重要的一件事放在今天。</p><div className="focus-empty">{review ? `本周完成率 ${Math.round((review.tasks?.completion_rate || 0) * 100)}%` : '还没有复盘数据'}</div></Widget><Widget title="截止雷达" english="Deadline Radar"><DeadlineList items={monthDeadlines} onOpen={onOpenDeadline} onToggle={onToggleDeadline} empty="本月暂无截止提醒" /></Widget><Widget title="天气" english="Weather"><div className="wwweather-today"><span className="wwetter-ico">☀️</span><div><b>24° <i>晴</i></b><span>今天适合专注工作</span></div></div></Widget></aside><div className="cal-scroll"><div className="cal-months"><section className="month-card"><div className="month-tape" /><div className="month-head"><span className="month-title">{month.getFullYear()}年{month.getMonth() + 1}月</span><span className="month-en">{month.toLocaleString('en-US', { month: 'long' })}</span></div><div className="cal-week-head">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span className="cal-dow" key={day}>{day}</span>)}</div><div className="month-grid">{Array.from({ length: cells.length / 7 }, (_, row) => <button className={`week-row ${cells.slice(row * 7, row * 7 + 7).some((date) => date && startOfWeek(date).getTime() === weekStart.getTime()) ? 'cur-week' : ''}`} key={row} onClick={() => jump(cells.slice(row * 7, row * 7 + 7).find(Boolean))}>{cells.slice(row * 7, row * 7 + 7).map((date, index) => <span className={`cal-day ${!date ? 'blank' : ''} ${index > 4 ? 'weekend' : ''}`} key={date ? date.toISOString() : `blank-${index}`}><span className="cal-num">{date?.getDate()}</span><span className="cal-badges">{date && nights.some((item) => item.date === isoDate(date)) && <span className="cal-moon">🌙</span>}{date && deadlines.some((item) => item.date === isoDate(date)) && <span className="cal-moon">⚠️</span>}</span></span>)}</button>)}</div></section></div></div><aside className="cal-widgets" id="calWidgetsR"><Widget title="明天速览" english="Tomorrow"><ul className="wtmr"><li><span className="wtmr-time">09:00</span><span className="wtmr-title">整理本周计划</span></li><li><span className="wtmr-time">14:00</span><span className="wtmr-title">留出一段深度工作</span></li></ul></Widget><Widget title="快速记录" english="Quick Capture"><textarea rows="3" placeholder="想到什么就写下来…" /></Widget><Widget title="熬夜档案" english="Night Owl Archive"><p className="caw-sub">本周 {nights.length} 次熬夜记录</p><div className="night-archive">{nights.map((item) => <span key={item.id}>🌙 {item.text}</span>)}</div></Widget></aside></div></div>; }

export { Timeline };

const rootContainer = typeof document === 'undefined' ? null : document.getElementById('root');
const rootKey = '__weeklyboardReactRoot';
if (rootContainer) {
  const reactRoot = window[rootKey] || (window[rootKey] = createRoot(rootContainer));
  reactRoot.render(<App />);
}
