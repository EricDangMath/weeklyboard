const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const hours = Array.from({ length: 19 }, (_, index) => index + 5);
const calendarStart = 5 * 60;
const calendarEnd = 24 * 60;
const pxPerMinute = 0.9;
const storageKey = "interactive-week-board-v1";
const summaryOrderKey = "interactive-week-board-summary-order-v1";
const sleepScheduleKey = "interactive-week-board-sleep-v1";
const planTargetsKey = "interactive-week-board-plan-targets-v1";
const necessaryScheduleKey = "interactive-week-board-necessary-v1";
const actualRecordsKey = "interactive-week-board-actual-records-v1";
const weeksKey = "interactive-week-board-weeks-v1";
const activeWeekKey = "interactive-week-board-active-week-v1";

let tasks = [];
let summaryOrder = [];
let sleepSchedule = [];
let planTargets = {};
let necessarySchedule = [];
let actualRecords = [];
let weeks = [];
let currentWeekId = "";
let editingId = null;
let createDraft = null;
let reviewCreateDraft = null;
let summaryDrag = null;
let undoStack = [];
let activeTaskDrag = null;
let activeSummaryGroupDrag = null;
let actualDraftGroupKey = "";

const demoText = `周一 6:30-7:00 BREAKFAST
周一 8-9 SPANISH
周一 9:30-10:30 HOMEWORK
周一 12-13 PHYSICS
周一 16-17 JAVA
周二 8-9 MUSIC
周二 10-11 ENGLISH
周二 14-15 BIOLOGY
周二 17-18 SPORTS
周三 8-9 SPANISH
周三 9:30-10:30 HOMEWORK
周三 12-13 PHYSICS
周三 16-17 BASE
周四 8-9 MUSIC
周四 10-11 ENGLISH
周四 14-15 BIOLOGY
周四 17-18 SPORTS
周五 8-9 SPANISH
周五 9:30-10:30 HOMEWORK
周五 12-13 PHYSICS
周五 19-20 FITNESS
周六 8-9 BREAKFAST
周六 20-21 CLUB
周日 8-9 MEETING
周日 19-20 NUMBER THEORY
每天 23-23:30 WASH
暑假安排
剪头发 周日 下午3点 60分钟`;

const $ = (selector) => document.querySelector(selector);

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toMinutes(time) {
  if (!time) return null;
  const [h, m = "0"] = String(time).split(":");
  return Number(h) * 60 + Number(m);
}

function snapCalendarMinutes(clientY, column) {
  const rect = column.getBoundingClientRect();
  const rawMinutes = calendarStart + (clientY - rect.top) / pxPerMinute;
  const snappedMinutes = Math.round(rawMinutes / 15) * 15;
  return Math.max(calendarStart, Math.min(calendarEnd, snappedMinutes));
}

function fromMinutes(minutes) {
  const normalized = Math.max(0, Math.min(24 * 60, minutes));
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

function getMonday(date) {
  const day = date.getDay() || 7;
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(date.getDate() - day + 1);
  return monday;
}

function formatDateId(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getWeekId(date = new Date()) {
  return formatDateId(getMonday(date));
}

function dateFromWeekId(id) {
  const [year, month, day] = id.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatWeekRangeFromMonday(monday) {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (date) => `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
  return `${fmt(monday)}-${fmt(sunday)}`;
}

function getWeekRange() {
  return formatWeekRangeFromMonday(currentWeekId ? dateFromWeekId(currentWeekId) : getMonday(new Date()));
}

function makeWeek(id) {
  const monday = dateFromWeekId(id);
  return {
    id,
    title: `${formatWeekRangeFromMonday(monday)} 周看板`,
    range: formatWeekRangeFromMonday(monday),
    createdAt: new Date().toISOString(),
  };
}

function scopedKey(key) {
  return `${key}-${currentWeekId}`;
}

function inferCategory(title) {
  const upper = title.toUpperCase();
  if (/JAVA|CODING|代码|编程|项目/.test(upper)) return "JAVA";
  if (/ENGLISH|英语|阅读|READ/.test(upper)) return "ENGLISH";
  if (/MATH|数学|AMC|数论|NUMBER/.test(upper)) return "MATH";
  if (/PHYSICS|BIOLOGY|SCIENCE|科学|物理|生物/.test(upper)) return "SCIENCE";
  if (/SPORT|FITNESS|运动|健身|飞盘/.test(upper)) return "SPORTS";
  if (/HOMEWORK|作业/.test(upper)) return "HOMEWORK";
  return upper.length <= 16 && /^[A-Z\s]+$/.test(upper) ? upper : "OTHER";
}

function categoryClass(category) {
  const text = category.toLowerCase();
  if (text.includes("java") || text.includes("coding")) return "cat-java";
  if (text.includes("english")) return "cat-english";
  if (text.includes("math") || text.includes("number")) return "cat-math";
  if (text.includes("physics") || text.includes("science") || text.includes("biology")) return "cat-science";
  if (text.includes("sport") || text.includes("fitness")) return "cat-sports";
  if (text.includes("homework")) return "cat-homework";
  return "cat-other";
}

function inferTaskKind(line, title) {
  const text = `${line} ${title}`.toLowerCase();
  if (/必要|提醒|早餐|午餐|晚餐|吃饭|洗澡|洗漱|刷牙|喝水|吃药|required|necessary|reminder/.test(text)) return "necessary";
  if (/灰色|日程|固定|上课|睡觉|通勤|校车|gray|fixed|schedule/.test(text)) return "fixed";
  if (/弹性|绿色|可调整|灵活|flex|flexible|green/.test(text)) return "flexible";
  return "important";
}

function taskKindClass(kind) {
  if (kind === "necessary") return "kind-necessary";
  if (kind === "fixed") return "kind-fixed";
  if (kind === "flexible") return "kind-flexible";
  return "kind-important";
}

function taskKindLabel(kind) {
  if (kind === "necessary") return "必要";
  if (kind === "fixed") return "日程";
  if (kind === "flexible") return "弹性";
  return "重要";
}

function parseDayIndexes(text) {
  if (/每天|每日|天天/.test(text)) return [0, 1, 2, 3, 4, 5, 6];
  const matches = [...text.matchAll(/周([一二三四五六日天])|星期([一二三四五六日天])/g)];
  const map = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 };
  if (matches.length) return [...new Set(matches.map((m) => map[m[1] || m[2]]))];
  return [];
}

function parseClock(raw, context) {
  if (!raw) return null;
  let [hour, minute = "0"] = String(raw).replace("点", ":").split(":");
  let h = Number(hour);
  const m = Number(minute || 0);
  if ((/下午|晚上|晚/.test(context) && h < 12) || (/中午/.test(context) && h < 11)) h += 12;
  if (/上午|早上|清晨/.test(context) && h === 12) h = 0;
  return h * 60 + m;
}

function parseTime(text) {
  const range = text.match(/(上午|下午|晚上|早上|中午|晚)?\s*(\d{1,2}(?::\d{1,2})?|\d{1,2}点(?:\d{1,2}分)?)\s*(?:-|到|至|~)\s*(上午|下午|晚上|早上|中午|晚)?\s*(\d{1,2}(?::\d{1,2})?|\d{1,2}点(?:\d{1,2}分)?)/);
  if (range) {
    const start = parseClock(range[2].replace("分", ""), `${range[1] || ""} ${text}`);
    let end = parseClock(range[4].replace("分", ""), `${range[3] || range[1] || ""} ${text}`);
    if (end <= start) end += 12 * 60;
    return { start, end: Math.min(end, 24 * 60) };
  }

  const single = text.match(/(上午|下午|晚上|早上|中午|晚)?\s*(\d{1,2}(?::\d{1,2})?|\d{1,2}点(?:\d{1,2}分)?)/);
  if (single) {
    const start = parseClock(single[2].replace("分", ""), `${single[1] || ""} ${text}`);
    const durationMatch = text.match(/(\d+(?:\.\d+)?)\s*(小时|分钟|min|m|h)/i);
    let duration = 60;
    if (durationMatch) {
      duration = Number(durationMatch[1]) * (/小时|h/i.test(durationMatch[2]) ? 60 : 1);
    }
    return { start, end: Math.min(start + duration, 24 * 60) };
  }

  return { start: null, end: null };
}

function cleanTitle(line) {
  return line
    .replace(/每天|每日|天天/g, "")
    .replace(/重要|黄色|弹性|绿色|灰色|日程|固定/g, "")
    .replace(/\b(important|yellow|flexible|flex|green|gray|grey|fixed|schedule|required|necessary|reminder)\b/gi, "")
    .replace(/周[一二三四五六日天]|星期[一二三四五六日天]/g, "")
    .replace(/上午|下午|晚上|早上|中午/g, "")
    .replace(/\d{1,2}(?::\d{1,2})?\s*(?:-|到|至|~)\s*\d{1,2}(?::\d{1,2})?/g, "")
    .replace(/\d{1,2}点(?:\d{1,2}分)?/g, "")
    .replace(/\d+(?:\.\d+)?\s*(小时|分钟|min|m|h)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTasks(text) {
  return text
    .split(/\n|；|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const dayIndexes = parseDayIndexes(line);
      const time = parseTime(line);
      const title = cleanTitle(line) || "未命名任务";
      const category = inferCategory(title);
      const kind = inferTaskKind(line, title);
      const base = {
        title,
        category,
        kind,
        done: false,
        completedUnits: [],
        start: time.start,
        end: time.end,
      };
      if (!dayIndexes.length || time.start === null || time.end === null) {
        return [{ ...base, id: uid(), day: -1 }];
      }
      return dayIndexes.map((day) => ({ ...base, id: uid(), day }));
    });
}

function save() {
  localStorage.setItem(scopedKey(storageKey), JSON.stringify(tasks));
}

function loadWeeks() {
  try {
    const savedWeeks = JSON.parse(localStorage.getItem(weeksKey) || "[]");
    weeks = Array.isArray(savedWeeks) ? savedWeeks : [];
  } catch {
    weeks = [];
  }

  const thisWeekId = getWeekId();
  if (!weeks.length) {
    weeks = [makeWeek(thisWeekId)];
    localStorage.setItem(weeksKey, JSON.stringify(weeks));
  }
  if (!weeks.some((week) => week.id === thisWeekId)) {
    weeks.push(makeWeek(thisWeekId));
    saveWeeks();
  }

  currentWeekId = localStorage.getItem(activeWeekKey) || thisWeekId;
  if (!weeks.some((week) => week.id === currentWeekId)) {
    currentWeekId = weeks[0].id;
  }
  localStorage.setItem(activeWeekKey, currentWeekId);
}

function saveWeeks() {
  weeks.sort((a, b) => b.id.localeCompare(a.id));
  localStorage.setItem(weeksKey, JSON.stringify(weeks));
}

function readScopedArray(key, fallback = []) {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedKey(key)) || "[]");
    return Array.isArray(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function readLegacyArray(key, fallback = []) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function readScopedObject(key, fallback = {}) {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedKey(key)) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function readLegacyObject(key, fallback = {}) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function normalizeActualRecordList(records) {
  return records
    .filter((record) => record && typeof record === "object")
    .map((record) => ({
      ...record,
      id: record.id || uid(),
      day: Number(record.day),
      start: Number(record.start),
      end: Number(record.end),
      kind: ["important", "flexible", "fixed", "necessary"].includes(record.kind) ? record.kind : "fixed",
    }))
    .filter(
      (record) =>
        Number.isInteger(record.day) &&
        record.day >= 0 &&
        record.day < days.length &&
        Number.isFinite(record.start) &&
        Number.isFinite(record.end) &&
        record.end > record.start,
    );
}

function load() {
  try {
    const scopedTasks = readScopedArray(storageKey);
    const legacyTasks = currentWeekId === getWeekId() ? readLegacyArray(storageKey) : [];
    tasks = scopedTasks.length ? scopedTasks : legacyTasks;
  } catch {
    tasks = [];
  }

  const scopedOrder = readScopedArray(summaryOrderKey);
  const legacyOrder = currentWeekId === getWeekId() ? readLegacyArray(summaryOrderKey) : [];
  summaryOrder = scopedOrder.length ? scopedOrder : legacyOrder;

  const scopedSleep = readScopedArray(sleepScheduleKey);
  const legacySleep = currentWeekId === getWeekId() ? readLegacyArray(sleepScheduleKey) : [];
  sleepSchedule = scopedSleep.length === 7 ? scopedSleep : legacySleep.length === 7 ? legacySleep : createDefaultSleepSchedule();

  const scopedPlans = readScopedObject(planTargetsKey);
  const legacyPlans = currentWeekId === getWeekId() ? readLegacyObject(planTargetsKey) : {};
  planTargets = Object.keys(scopedPlans).length ? scopedPlans : legacyPlans;

  const scopedNecessary = readScopedArray(necessaryScheduleKey);
  const legacyNecessary = currentWeekId === getWeekId() ? readLegacyArray(necessaryScheduleKey) : [];
  necessarySchedule = scopedNecessary.length ? scopedNecessary : legacyNecessary.length ? legacyNecessary : createDefaultNecessarySchedule();
  necessarySchedule = normalizeNecessarySchedule(necessarySchedule);

  actualRecords = normalizeActualRecordList(readScopedArray(actualRecordsKey));
  tasks.forEach(normalizeTaskProgress);
  tasks.forEach(normalizeTaskKind);
  save();
  saveSummaryOrder();
  saveSleepSchedule();
  savePlanTargets();
  saveNecessarySchedule();
  saveActualRecords();
}

function saveSummaryOrder() {
  localStorage.setItem(scopedKey(summaryOrderKey), JSON.stringify(summaryOrder));
}

function saveSleepSchedule() {
  localStorage.setItem(scopedKey(sleepScheduleKey), JSON.stringify(sleepSchedule));
}

function savePlanTargets() {
  localStorage.setItem(scopedKey(planTargetsKey), JSON.stringify(planTargets));
}

function saveNecessarySchedule() {
  localStorage.setItem(scopedKey(necessaryScheduleKey), JSON.stringify(necessarySchedule));
}

function saveActualRecords() {
  localStorage.setItem(scopedKey(actualRecordsKey), JSON.stringify(actualRecords));
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureUndo() {
  undoStack.push({
    weekId: currentWeekId,
    tasks: cloneValue(tasks),
    summaryOrder: cloneValue(summaryOrder),
    sleepSchedule: cloneValue(sleepSchedule),
    planTargets: cloneValue(planTargets),
    necessarySchedule: cloneValue(necessarySchedule),
    actualRecords: cloneValue(actualRecords),
  });
  if (undoStack.length > 80) undoStack.shift();
}

function undoLastChange() {
  const snapshot = undoStack.pop();
  if (!snapshot) return;
  if (snapshot.weekId !== currentWeekId) {
    currentWeekId = snapshot.weekId;
    localStorage.setItem(activeWeekKey, currentWeekId);
  }
  tasks = snapshot.tasks;
  summaryOrder = snapshot.summaryOrder;
  sleepSchedule = snapshot.sleepSchedule;
  planTargets = snapshot.planTargets;
  necessarySchedule = snapshot.necessarySchedule;
  actualRecords = snapshot.actualRecords || [];
  save();
  saveSummaryOrder();
  saveSleepSchedule();
  savePlanTargets();
  saveNecessarySchedule();
  saveActualRecords();
  render();
}

function createDefaultSleepSchedule() {
  return days.map(() => ({ start: "23:00", end: "07:00" }));
}

function createDefaultNecessarySchedule() {
  return [
    { id: "morningWash", title: "早洗漱", enabled: true, weekday: { start: "06:30", end: "07:00" }, weekend: { start: "08:00", end: "08:30" } },
    { id: "breakfast", title: "早饭", enabled: true, weekday: { start: "07:00", end: "07:30" }, weekend: { start: "08:30", end: "09:00" } },
    { id: "lunch", title: "午饭", enabled: true, weekday: { start: "12:00", end: "12:30" }, weekend: { start: "12:30", end: "13:00" } },
    { id: "dinner", title: "晚饭", enabled: true, weekday: { start: "18:00", end: "18:30" }, weekend: { start: "18:30", end: "19:00" } },
    { id: "wash", title: "洗漱", enabled: true, weekday: { start: "21:30", end: "22:00" }, weekend: { start: "22:00", end: "22:30" } },
  ];
}

function normalizeNecessarySchedule(schedule) {
  const defaults = createDefaultNecessarySchedule();
  return defaults.map((defaultItem) => {
    const saved = schedule.find((item) => item.id === defaultItem.id) || {};
    const weekday = saved.weekday || { start: saved.start || defaultItem.weekday.start, end: saved.end || defaultItem.weekday.end };
    const weekend = saved.weekend || { start: saved.start || defaultItem.weekend.start, end: saved.end || defaultItem.weekend.end };
    return {
      id: defaultItem.id,
      title: defaultItem.title,
      enabled: saved.enabled ?? defaultItem.enabled,
      weekday,
      weekend,
    };
  });
}

function normalizeTaskKind(task) {
  if (!["important", "flexible", "necessary", "fixed"].includes(task.kind)) {
    task.kind = inferTaskKind(task.title || "", task.title || "");
  }
}

function taskUnitCount(task) {
  if ((task.start === null || task.end === null) && Number.isFinite(task.plannedUnits)) {
    return Math.max(0, task.plannedUnits);
  }
  if (task.start === null || task.end === null || task.end <= task.start) return 0;
  return Math.max(1, Math.ceil((task.end - task.start) / 30));
}

function durationMinutes(entry) {
  if (!Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.end <= entry.start) return 0;
  return entry.end - entry.start;
}

function inboxUnitCount(task) {
  return Math.max(1, taskUnitCount(task));
}

function normalizeTaskProgress(task) {
  const units = taskUnitCount(task);
  const completed = Array.isArray(task.completedUnits) ? task.completedUnits : [];
  if (task.done && !completed.length && units) {
    task.completedUnits = Array.from({ length: units }, (_, index) => index);
  } else {
    const completedCount = Math.max(0, ...completed.filter((unit) => Number.isInteger(unit) && unit >= 0).map((unit) => unit + 1), 0);
    task.completedUnits = Array.from({ length: completedCount }, (_, index) => index);
  }
  task.done = units > 0 && task.completedUnits.length >= units;
}

function completedUnitCount(task) {
  normalizeTaskProgress(task);
  return task.completedUnits.length;
}

function isTaskDone(task) {
  normalizeTaskProgress(task);
  return task.done;
}

function setTaskDone(task, done) {
  const units = taskUnitCount(task);
  task.completedUnits = done ? Array.from({ length: units }, (_, index) => index) : [];
  task.done = done && units > 0;
}

function toggleTaskUnit(taskId, unit) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;
  normalizeTaskProgress(task);
  if (task.completedUnits.includes(unit)) {
    task.completedUnits = task.completedUnits.filter((item) => item < unit);
  } else {
    const nextUnit = task.completedUnits.length;
    task.completedUnits.push(nextUnit);
  }
  task.done = task.completedUnits.length >= taskUnitCount(task);
}

function visibleCheckUnits(task) {
  normalizeTaskProgress(task);
  const plannedUnits = taskUnitCount(task);
  if (!plannedUnits) return 0;
  const progressMinutes = effectiveTaskProgressMinutes(task);
  const coveredUnits = Math.ceil(progressMinutes / 30);
  const extraUnit = progressMinutes >= durationMinutes(task) ? 1 : 0;
  return Math.max(plannedUnits, coveredUnits + extraUnit, task.completedUnits.length + 1);
}

function setSummaryGroupKind(groupKey, kind) {
  const { label: category } = parseSummaryGroupKey(groupKey);
  const nextGroupKey = `${kind}:${category}`;
  tasks.forEach((task) => {
    if (summaryGroupKey(task) === groupKey) task.kind = kind;
  });
  migrateSummaryGroupKey(groupKey, nextGroupKey);
}

function migrateSummaryGroupKey(groupKey, nextGroupKey) {
  if (!groupKey || !nextGroupKey || groupKey === nextGroupKey) return;
  const oldTarget = planTargets[groupKey];
  if (oldTarget !== undefined) {
    delete planTargets[groupKey];
    planTargets[nextGroupKey] = oldTarget;
  }
  const { kind: nextKind } = parseSummaryGroupKey(nextGroupKey);
  actualRecords.forEach((record) => {
    if (actualRecordGroupKey(record) === groupKey) {
      record.groupKey = nextGroupKey;
      record.kind = nextKind;
    }
  });
  summaryOrder = [...new Set(summaryOrder.map((key) => (key === groupKey ? nextGroupKey : key)))];
  savePlanTargets();
  saveActualRecords();
  saveSummaryOrder();
}

function scheduledUnitCount(groupTasks) {
  return groupTasks
    .filter((task) => task.day >= 0 && task.start !== null && task.end !== null)
    .reduce((sum, task) => sum + taskUnitCount(task), 0);
}

function setGroupPlanUnits(groupKey, requestedUnits) {
  const groupTasks = tasks.filter((task) => summaryGroupKey(task) === groupKey);
  const scheduledUnits = scheduledUnitCount(groupTasks);
  if (requestedUnits < scheduledUnits) {
    alert(`计划不能少于已经排进日程表的时间：${scheduledUnits}*30`);
    return false;
  }

  planTargets[groupKey] = requestedUnits;
  syncPlanBuffer(groupKey);
  savePlanTargets();
  return true;
}

function getGroupPlanUnits(groupKey, groupTasks) {
  if (Number.isFinite(planTargets[groupKey])) return planTargets[groupKey];
  const units = groupTasks.reduce((sum, task) => sum + taskUnitCount(task), 0);
  planTargets[groupKey] = units;
  savePlanTargets();
  return units;
}

function syncPlanBuffer(groupKey) {
  const groupTasks = tasks.filter((task) => summaryGroupKey(task) === groupKey);
  const scheduledUnits = scheduledUnitCount(groupTasks);
  const targetUnits = Number(planTargets[groupKey] || 0);
  const extraUnits = Math.max(0, targetUnits - scheduledUnits);
  const buffers = groupTasks.filter((task) => task.day < 0 && task.start === null && task.end === null && task.isPlanBuffer);
  const { kind, label: category } = parseSummaryGroupKey(groupKey);

  if (extraUnits > 0) {
    const buffer = buffers[0];
    if (buffer) {
      buffer.plannedUnits = extraUnits;
      buffer.title = category;
      buffer.category = category;
      buffer.kind = kind;
    } else {
      tasks.push({
        id: uid(),
        title: category,
        day: -1,
        start: null,
        end: null,
        category,
        kind,
        plannedUnits: extraUnits,
        isPlanBuffer: true,
        done: false,
        completedUnits: [],
      });
    }
  }

  buffers.slice(extraUnits > 0 ? 1 : 0).forEach((buffer) => {
    tasks = tasks.filter((task) => task.id !== buffer.id);
  });
}

function summaryGroupKey(task) {
  normalizeTaskKind(task);
  return `${task.kind}:${summaryGroupLabel(task)}`;
}

function summaryGroupLabel(task) {
  const category = task.category || inferCategory(task.title);
  if (category && category !== "OTHER") return category;
  return (task.title || "OTHER").replace(/:/g, " ").trim() || "OTHER";
}

function actualRecordGroupKey(record) {
  if (record.groupKey) return record.groupKey;
  return summaryGroupKey({
    title: record.title || "OTHER",
    category: inferCategory(record.title || ""),
    kind: record.kind || "fixed",
  });
}

function actualMinutesForGroup(groupKey) {
  return actualRecordsForGroup(groupKey).reduce((sum, record) => sum + durationMinutes(record), 0);
}

function actualRecordsForGroup(groupKey) {
  return actualRecords.filter((record) => actualRecordGroupKey(record) === groupKey);
}

function effectiveActualMinutesForGroup(groupKey, groupTasks) {
  const records = actualRecordsForGroup(groupKey);
  let totalMinutes = groupTasks
    .filter((task) => task.day < 0)
    .reduce((sum, task) => sum + completedUnitCount(task) * 30, 0);
  days.forEach((_, day) => {
    const recordedMinutes = records
      .filter((record) => record.day === day)
      .reduce((sum, record) => sum + durationMinutes(record), 0);
    const checkedMinutes = groupTasks
      .filter((task) => task.day === day)
      .reduce((sum, task) => sum + completedUnitCount(task) * 30, 0);
    totalMinutes += Math.max(recordedMinutes, checkedMinutes);
  });
  return totalMinutes;
}

function actualRecordsForTaskDay(task) {
  if (task.day < 0) return [];
  const groupKey = summaryGroupKey(task);
  return actualRecords.filter((record) => record.day === task.day && actualRecordGroupKey(record) === groupKey);
}

function recordedMinutesForTask(task) {
  const records = actualRecordsForTaskDay(task);
  if (!records.length) return null;

  const groupKey = summaryGroupKey(task);
  const dayTasks = tasks
    .filter(
      (item) =>
        item.day === task.day &&
        item.start !== null &&
        item.end !== null &&
        item.end > item.start &&
        summaryGroupKey(item) === groupKey,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let remaining = records.reduce((sum, record) => sum + durationMinutes(record), 0);

  for (let index = 0; index < dayTasks.length; index += 1) {
    const item = dayTasks[index];
    const plannedMinutes = durationMinutes(item);
    const allocation = index === dayTasks.length - 1 ? Math.max(0, remaining) : Math.min(Math.max(0, remaining), plannedMinutes);
    if (item.id === task.id) return allocation;
    remaining = Math.max(0, remaining - plannedMinutes);
  }
  return 0;
}

function effectiveTaskProgressMinutes(task) {
  const recordedMinutes = recordedMinutesForTask(task);
  const checkedMinutes = completedUnitCount(task) * 30;
  return recordedMinutes === null ? checkedMinutes : Math.max(recordedMinutes, checkedMinutes);
}

function taskUnitProgress(task, unit) {
  const recordedMinutes = recordedMinutesForTask(task);
  if (recordedMinutes === null) return task.completedUnits.includes(unit) ? 1 : 0;
  const recordedProgress = Math.max(0, Math.min(1, (recordedMinutes - unit * 30) / 30));
  return Math.max(recordedProgress, task.completedUnits.includes(unit) ? 1 : 0);
}

function isTaskEffectivelyDone(task) {
  const plannedMinutes = durationMinutes(task);
  if (!plannedMinutes) return isTaskDone(task);
  return effectiveTaskProgressMinutes(task) >= plannedMinutes;
}

function formatHalfHourBlocks(minutes) {
  const blocks = minutes / 30;
  return Number.isInteger(blocks) ? String(blocks) : blocks.toFixed(1);
}

function parseSummaryGroupKey(groupKey) {
  const [kind, ...labelParts] = groupKey.split(":");
  return { kind, label: labelParts.join(":") };
}

function groupedByCategory() {
  const map = new Map();
  tasks
    .filter((task) => {
      normalizeTaskKind(task);
      return !["fixed", "necessary"].includes(task.kind) && (task.day >= 0 || taskUnitCount(task) > 0);
    })
    .forEach((task) => {
      const key = summaryGroupKey(task);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(task);
    });
  const groups = [...map.entries()].map(([key, categoryTasks]) => {
    const { kind, label: category } = parseSummaryGroupKey(key);
    return { key, kind, category, categoryTasks };
  });
  const visibleKeys = groups.map((group) => group.key);
  summaryOrder = [...summaryOrder.filter((key) => visibleKeys.includes(key)), ...visibleKeys.filter((key) => !summaryOrder.includes(key))];
  return groups.sort((a, b) => summaryOrder.indexOf(a.key) - summaryOrder.indexOf(b.key));
}

function renderSummary() {
  reconcilePlanBuffers();
  const body = $("#summaryBody");
  body.innerHTML = "";
  renderSummaryDayTotals();
  groupedByCategory().forEach(({ key, kind, category, categoryTasks }, index) => {
    const row = document.createElement("tr");
    const groupKey = `${kind}:${category}`;
    row.className = "summary-row";
    row.dataset.group = key;
    row.draggable = true;
    const totalUnits = getGroupPlanUnits(groupKey, categoryTasks);
    const actualMinutes = effectiveActualMinutesForGroup(groupKey, categoryTasks);
    const groupComplete = totalUnits > 0 && actualMinutes >= totalUnits * 30;
    row.innerHTML = `
      <td class="summary-rank" title="拖拽排序">${index + 1}</td>
      <td class="summary-task ${taskKindClass(kind)}">
        <div class="summary-controls">
          <span class="summary-title">${category}</span>
          <select class="summary-kind-select" data-group="${escapeHtml(groupKey)}" aria-label="调整重要等级">
            <option value="important" ${kind === "important" ? "selected" : ""}>重要</option>
            <option value="flexible" ${kind === "flexible" ? "selected" : ""}>弹性</option>
            <option value="necessary">必要事项</option>
            <option value="fixed">灰色日程</option>
          </select>
        </div>
      </td>
      <td>
        <div class="plan-cell-metric">
          <input class="plan-input" data-group="${escapeHtml(groupKey)}" type="number" min="${scheduledUnitCount(
            categoryTasks,
          )}" step="1" value="${totalUnits}" aria-label="调整计划" />
          <span class="plan-unit">格 = ${formatDuration(totalUnits * 30)}</span>
        </div>
      </td>
      <td class="${groupComplete ? "actual-complete" : ""}">
        <div class="actual-cell-metric">
          <strong>${formatHalfHourBlocks(actualMinutes)}格</strong>
          <small>${formatDuration(actualMinutes)}</small>
        </div>
      </td>
      ${days
        .map((_, day) => {
          const dayTasks = categoryTasks.filter((task) => task.day === day);
          const dayUnits = dayTasks.reduce((sum, task) => sum + taskUnitCount(task), 0);
          return `
            <td>
              <div class="day-allocation ${dayUnits ? "" : "is-empty"}">
                <span class="day-grid-count">${dayUnits}格</span>
                <div class="check-strip">${dayTasks
                  .map((task) =>
                    Array.from({ length: visibleCheckUnits(task) }, (_, unit) => {
                      const progress = taskUnitProgress(task, unit);
                      const done = progress >= 1;
                      const partial = progress > 0 && progress < 1;
                      return `<button class="mini-check ${done ? "done" : ""} ${partial ? "partial" : ""}" ${
                        partial ? `style="--unit-progress: ${Math.round(progress * 100)}%"` : ""
                      } data-id="${task.id}" data-unit="${unit}" title="${escapeHtml(
                        task.title,
                      )} ${fromMinutes(task.start + unit * 30)}"></button>`;
                    }).join(""),
                  )
                  .join("")}</div>
              </div>
            </td>
          `;
        })
        .join("")}
    `;
    body.appendChild(row);
  });

  body.querySelectorAll(".summary-row").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      if (event.target.closest("select, button, input")) {
        event.preventDefault();
        return;
      }
      activeSummaryGroupDrag = { groupKey: row.dataset.group };
      event.dataTransfer.setData("application/x-summary-group", row.dataset.group);
      event.dataTransfer.effectAllowed = "move";
      row.classList.add("summary-dragging-delete");
    });
    row.addEventListener("dragend", () => {
      activeSummaryGroupDrag = null;
      row.classList.remove("summary-dragging-delete");
      document.querySelector(".control-panel")?.classList.remove("delete-drag-over");
    });
  });

  body.querySelectorAll(".mini-check").forEach((check) => {
    check.addEventListener("click", () => {
      captureUndo();
      toggleTaskUnit(check.dataset.id, Number(check.dataset.unit));
      save();
      render();
    });
  });
  body.querySelectorAll(".summary-kind-select").forEach((select) => {
    select.addEventListener("change", () => {
      captureUndo();
      setSummaryGroupKind(select.dataset.group, select.value);
      save();
      render();
    });
  });
  body.querySelectorAll(".plan-input").forEach((input) => {
    input.addEventListener("input", () => applyPlanInput(input, false));
    input.addEventListener("change", () => applyPlanInput(input, true));
    input.addEventListener("blur", () => applyPlanInput(input, true));
  });
  bindSummaryRowSorting(body);
}

function renderSummaryDayTotals() {
  const trackedTasks = tasks.filter((task) => {
    normalizeTaskKind(task);
    return ["important", "flexible"].includes(task.kind) && task.day >= 0 && task.start !== null && task.end !== null;
  });

  days.forEach((_, day) => {
    const units = trackedTasks
      .filter((task) => task.day === day)
      .reduce((sum, task) => sum + taskUnitCount(task), 0);
    const header = document.querySelector(`th[data-summary-day="${day}"]`);
    const count = header?.querySelector(".day-total-count");
    if (count) count.textContent = `${units}格 · ${formatDuration(units * 30)}`;
  });
}

function reconcilePlanBuffers() {
  Object.entries(planTargets).forEach(([groupKey, units]) => {
    if (Number(units) > 0) syncPlanBuffer(groupKey);
  });
}

function applyPlanInput(input, shouldPrompt) {
  if (input.value === "") return;
  const units = Math.max(0, Math.round(Number(input.value) || 0));
  if (units < Number(input.min || 0)) {
    if (shouldPrompt) {
      setGroupPlanUnits(input.dataset.group, units);
      render();
    }
    return;
  }
  captureUndo();
  if (setGroupPlanUnits(input.dataset.group, units)) {
    save();
  } else {
    undoStack.pop();
  }
  render();
}

function bindSummaryRowSorting(body) {
  body.querySelectorAll(".summary-row").forEach((row) => {
    row.addEventListener("mousedown", (event) => {
      if (event.target.closest("select, button, input")) {
        return;
      }
      if (!event.target.closest(".summary-rank")) return;
      event.preventDefault();
      startSummaryDrag(event, body, row);
    });
  });
}

function startSummaryDrag(event, body, row) {
  const rect = row.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "summary-drag-ghost";
  ghost.style.width = `${Math.min(220, rect.width * 0.62)}px`;
  ghost.innerHTML = `
    <b>${row.querySelector(".summary-rank")?.textContent || ""}</b>
    <strong>${row.querySelector(".summary-title")?.textContent || ""}</strong>
    <span>${row.querySelector(".summary-kind-select")?.selectedOptions[0]?.textContent || ""}</span>
  `;
  document.body.appendChild(ghost);
  row.classList.add("drag-placeholder");
  summaryDrag = {
    body,
    ghost,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    source: row.dataset.group,
    row,
  };
  moveSummaryGhost(event.clientX, event.clientY);
  document.addEventListener("mousemove", handleSummaryDragMove);
  document.addEventListener("mouseup", handleSummaryDragEnd);
}

function handleSummaryDragMove(event) {
  if (!summaryDrag) return;
  moveSummaryGhost(event.clientX, event.clientY);
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest(".summary-row");
  if (!row || row.dataset.group === summaryDrag.source) return;
  const rect = row.getBoundingClientRect();
  const insertAfter = event.clientY > rect.top + rect.height / 2;
  if (insertAfter) {
    row.after(summaryDrag.row);
  } else {
    row.before(summaryDrag.row);
  }
  updateSummaryRanks(summaryDrag.body);
}

function handleSummaryDragEnd() {
  document.removeEventListener("mousemove", handleSummaryDragMove);
  document.removeEventListener("mouseup", handleSummaryDragEnd);
  if (!summaryDrag) return;
  const { body, ghost } = summaryDrag;
  ghost.remove();
  body.querySelectorAll(".summary-row").forEach((row) => row.classList.remove("drag-placeholder"));
  captureUndo();
  summaryOrder = [...body.querySelectorAll(".summary-row")].map((row) => row.dataset.group);
  summaryDrag = null;
  saveSummaryOrder();
  render();
}

function moveSummaryGhost(clientX, clientY) {
  summaryDrag.ghost.style.transform = `translate(${clientX - summaryDrag.offsetX}px, ${clientY - summaryDrag.offsetY}px) rotate(-1deg)`;
}

function updateSummaryRanks(body) {
  body.querySelectorAll(".summary-row").forEach((row, index) => {
    const rank = row.querySelector(".summary-rank");
    if (rank) rank.textContent = index + 1;
  });
  if (summaryDrag?.ghost) {
    const currentIndex = [...body.querySelectorAll(".summary-row")].indexOf(summaryDrag.row);
    const ghostRank = summaryDrag.ghost.querySelector("b");
    if (ghostRank && currentIndex >= 0) ghostRank.textContent = currentIndex + 1;
  }
}

function createTaskCard(task, mode = "stack") {
  const card = document.createElement("div");
  normalizeTaskKind(task);
  const canCheck = task.kind !== "necessary";
  const progressMinutes = canCheck ? effectiveTaskProgressMinutes(task) : 0;
  const plannedMinutes = durationMinutes(task);
  const progressPercent = plannedMinutes ? Math.min(100, Math.round((progressMinutes / plannedMinutes) * 100)) : 0;
  const effectivelyDone = canCheck && isTaskEffectivelyDone(task);
  card.className = `task-card ${mode === "calendar" ? "calendar-task" : ""} ${categoryClass(task.category)} ${taskKindClass(task.kind)} ${
    effectivelyDone ? "done" : ""
  } ${progressPercent > 0 && !effectivelyDone ? "has-progress" : ""}`;
  if (progressPercent > 0 && !effectivelyDone) card.style.setProperty("--progress", `${progressPercent}%`);
  card.draggable = true;
  card.dataset.id = task.id;
  const needLabel = mode === "calendar" ? "" : `<span class="task-needed">还需 ${inboxUnitCount(task)}*30</span>`;
  card.innerHTML = `
    ${canCheck ? `<button type="button" aria-label="完成"></button>` : ""}
    <div>
      <strong>${escapeHtml(task.title)}</strong>
      ${needLabel}
      <span class="task-time">${task.day >= 0 ? `${days[task.day]} ` : ""}${task.start !== null ? `${fromMinutes(task.start)}-${fromMinutes(task.end)}` : "待安排"}</span>
    </div>
  `;
  card.addEventListener("dragstart", (event) => {
    activeTaskDrag = {
      id: task.id,
      origin: task.day < 0 || task.start === null || task.end === null ? "inbox" : "schedule",
    };
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.setData("application/x-task-origin", activeTaskDrag.origin);
  });
  card.addEventListener("dragend", () => {
    activeTaskDrag = null;
    document.querySelector(".control-panel")?.classList.remove("delete-drag-over");
  });
  card.querySelector("button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    captureUndo();
    setTaskDone(task, !isTaskEffectivelyDone(task));
    save();
    render();
  });
  card.addEventListener("click", () => openEditor(task.id));
  return card;
}

function renderSchedule() {
  const grid = $("#scheduleGrid");
  grid.innerHTML = "";
  grid.style.setProperty("--calendar-height", `${(calendarEnd - calendarStart) * pxPerMinute}px`);

  const corner = document.createElement("div");
  corner.className = "calendar-header inbox-header-cell";
  corner.style.gridColumn = "span 4";
  corner.textContent = "收件箱";
  grid.appendChild(corner);

  days.forEach((day) => {
    const header = document.createElement("div");
    header.className = "calendar-header";
    header.textContent = day;
    grid.appendChild(header);
  });

  const leftPanel = document.createElement("div");
  leftPanel.className = "schedule-inbox";
  leftPanel.style.gridColumn = "span 4";
  addInboxDropHandlers(leftPanel);

  const inboxContent = document.createElement("div");
  inboxContent.className = "schedule-inbox-content";
  const inboxTasks = tasks.filter((task) => task.day < 0 || task.start === null || task.end === null);
  if (inboxTasks.length) {
    inboxTasks.forEach((task) => inboxContent.appendChild(createTaskCard(task)));
  } else {
    inboxContent.innerHTML = `<p class="inbox-empty">没有待安排任务。</p>`;
  }
  leftPanel.appendChild(inboxContent);

  const sleepControls = document.createElement("div");
  sleepControls.className = "sleep-controls";
  sleepControls.innerHTML = `
    <div class="sleep-title">睡眠时间</div>
    ${days
      .map(
        (day, index) => `
          <label class="sleep-row">
            <span>${day}</span>
            <input type="time" value="${sleepSchedule[index].start}" data-day="${index}" data-field="start" />
            <input type="time" value="${sleepSchedule[index].end}" data-day="${index}" data-field="end" />
          </label>
        `,
      )
      .join("")}
  `;
  sleepControls.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      captureUndo();
      sleepSchedule[Number(input.dataset.day)][input.dataset.field] = input.value;
      saveSleepSchedule();
      render();
    });
  });
  inboxContent.appendChild(sleepControls);

  const ruler = document.createElement("div");
  ruler.className = "time-ruler";
  hours.forEach((hour) => {
    const marker = document.createElement("div");
    marker.className = "time-marker";
    marker.style.top = `${(hour * 60 - calendarStart) * pxPerMinute}px`;
    marker.textContent = `${hour}:00`;
    ruler.appendChild(marker);
  });
  leftPanel.appendChild(ruler);
  grid.appendChild(leftPanel);

  days.forEach((_, day) => {
    const column = document.createElement("div");
    column.className = "day-column";
    column.dataset.day = day;
    addColumnDropHandlers(column);
    addColumnCreateHandlers(column);

    hours.forEach((hour) => {
      const line = document.createElement("div");
      line.className = "hour-line";
      line.style.top = `${(hour * 60 - calendarStart) * pxPerMinute}px`;
      column.appendChild(line);

      const halfLine = document.createElement("div");
      halfLine.className = "half-hour-line";
      halfLine.style.top = `${(hour * 60 + 30 - calendarStart) * pxPerMinute}px`;
      column.appendChild(halfLine);
    });

    renderSleepBlocks(column, day);
    renderNecessaryBlocks(column, day);

    layoutDayTasks(day).forEach(({ task, lane, lanes }) => {
      const card = createTaskCard(task, "calendar");
      const top = (Math.max(task.start, calendarStart) - calendarStart) * pxPerMinute;
      const bottom = (Math.min(task.end, calendarEnd) - calendarStart) * pxPerMinute;
      const gap = lanes > 1 ? 2 : 0;
      const width = `calc(${100 / lanes}% - ${gap}px)`;
      card.style.top = `${top}px`;
      card.style.height = `${Math.max(30, bottom - top)}px`;
      card.style.left = `calc(${(100 / lanes) * lane}% + ${gap / 2}px)`;
      card.style.width = width;
      column.appendChild(card);
    });

    renderUnplannedActualBlocks(column, day);
    grid.appendChild(column);
  });
}

function addColumnCreateHandlers(column) {
  column.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.target.closest(".task-card")) return;
    event.preventDefault();
    const start = Math.min(calendarEnd - 15, snapCalendarMinutes(event.clientY, column));
    const draft = document.createElement("div");
    draft.className = "draft-task";
    column.appendChild(draft);
    createDraft = {
      column,
      day: Number(column.dataset.day),
      anchor: start,
      start,
      end: Math.min(start + 30, calendarEnd),
      draft,
      moved: false,
    };
    updateCreateDraft(event.clientY);
    document.addEventListener("mousemove", handleCreateMove);
    document.addEventListener("mouseup", handleCreateEnd);
  });
}

function handleCreateMove(event) {
  if (!createDraft) return;
  createDraft.moved = true;
  updateCreateDraft(event.clientY);
}

function handleCreateEnd(event) {
  document.removeEventListener("mousemove", handleCreateMove);
  document.removeEventListener("mouseup", handleCreateEnd);
  if (!createDraft) return;
  updateCreateDraft(event.clientY);
  const { day, start, end, draft, moved } = createDraft;
  draft.remove();
  createDraft = null;
  if (!moved) return;

  const newTask = {
    id: uid(),
    title: "新任务",
    day,
    start,
    end: Math.max(start + 15, end),
    category: "OTHER",
    kind: "important",
    done: false,
    completedUnits: [],
  };
  captureUndo();
  tasks.push(newTask);
  save();
  render();
  openEditor(newTask.id);
}

function updateCreateDraft(clientY) {
  const endPoint = snapCalendarMinutes(clientY, createDraft.column);
  const start = Math.min(createDraft.anchor, endPoint);
  const end = Math.max(createDraft.anchor, endPoint);
  createDraft.start = start;
  createDraft.end = end > start ? end : Math.min(start + 30, calendarEnd);
  const top = (createDraft.start - calendarStart) * pxPerMinute;
  const height = Math.max(30, (createDraft.end - createDraft.start) * pxPerMinute);
  createDraft.draft.style.top = `${top + 2}px`;
  createDraft.draft.style.height = `${height - 4}px`;
  createDraft.draft.textContent = `${fromMinutes(createDraft.start)}-${fromMinutes(createDraft.end)}`;
}

function layoutDayTasks(day) {
  const dayTasks = tasks
    .filter((task) => task.day === day && task.start !== null && task.end !== null && task.end > calendarStart && task.start < calendarEnd)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const active = [];
  const placed = [];

  dayTasks.forEach((task) => {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].end <= task.start) active.splice(index, 1);
    }

    let lane = 0;
    while (active.some((item) => item.lane === lane)) lane += 1;
    active.push({ end: task.end, lane });
    placed.push({ task, lane, lanes: 1 });
  });

  placed.forEach((entry) => {
    const overlapping = placed.filter((item) => item.task.start < entry.task.end && item.task.end > entry.task.start);
    entry.lanes = Math.max(1, ...overlapping.map((item) => item.lane + 1));
  });

  return placed;
}

function renderSleepBlocks(column, day) {
  getSleepSegments(day).forEach((segment) => {
    const top = (segment.start - calendarStart) * pxPerMinute;
    const height = Math.max(20, (segment.end - segment.start) * pxPerMinute);
    const block = document.createElement("div");
    block.className = "sleep-block";
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    block.textContent = "SLEEP";
    column.appendChild(block);
  });
}

function renderNecessaryBlocks(column, day) {
  necessarySchedule
    .filter((item) => item.enabled)
    .forEach((item) => {
      const group = day < 5 ? item.weekday : item.weekend;
      const start = toMinutes(group.start);
      const end = toMinutes(group.end);
      if (start === null || end === null || end <= start || end <= calendarStart || start >= calendarEnd) return;
      const top = (Math.max(start, calendarStart) - calendarStart) * pxPerMinute;
      const bottom = (Math.min(end, calendarEnd) - calendarStart) * pxPerMinute;
      const block = document.createElement("div");
      block.className = "task-card calendar-task kind-necessary necessary-auto-block";
      block.style.top = `${top}px`;
      block.style.height = `${Math.max(30, bottom - top)}px`;
      block.style.left = "0";
      block.style.width = "100%";
      block.innerHTML = `
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="task-time">${fromMinutes(start)}-${fromMinutes(end)}</span>
        </div>
      `;
      column.appendChild(block);
    });
}

function actualRecordHasPlannedTask(record) {
  if (record.kind === "necessary") return false;
  const groupKey = actualRecordGroupKey(record);
  return tasks.some(
    (task) =>
      task.day === record.day &&
      task.start !== null &&
      task.end !== null &&
      task.end > task.start &&
      summaryGroupKey(task) === groupKey,
  );
}

function renderUnplannedActualBlocks(column, day) {
  actualRecords
    .filter(
      (record) =>
        record.day === day &&
        !actualRecordHasPlannedTask(record) &&
        record.end > calendarStart &&
        record.start < calendarEnd,
    )
    .forEach((record) => {
      const top = (Math.max(record.start, calendarStart) - calendarStart) * pxPerMinute;
      const bottom = (Math.min(record.end, calendarEnd) - calendarStart) * pxPerMinute;
      const block = document.createElement("div");
      block.className = `task-card calendar-task actual-only-record ${taskKindClass(record.kind)}`;
      block.style.top = `${top}px`;
      block.style.height = `${Math.max(30, bottom - top)}px`;
      block.innerHTML = `
        <div>
          <strong>${escapeHtml(record.title)}</strong>
          <span class="task-time">${fromMinutes(record.start)}-${fromMinutes(record.end)}</span>
        </div>
      `;
      block.title = `复盘实际记录：${record.title}`;
      column.appendChild(block);
    });
}

function getSleepSegments(day) {
  const current = sleepSchedule[day] || { start: "23:00", end: "07:00" };
  const previous = sleepSchedule[(day + 6) % 7] || current;
  const segments = [];
  const todayStart = toMinutes(current.start);
  const todayEnd = toMinutes(current.end);
  const previousStart = toMinutes(previous.start);
  const previousEnd = toMinutes(previous.end);

  if (previousEnd !== null && previousStart !== null && previousEnd <= previousStart && previousEnd > calendarStart) {
    segments.push({ start: calendarStart, end: Math.min(previousEnd, calendarEnd) });
  }

  if (todayStart !== null && todayEnd !== null) {
    if (todayEnd > todayStart) {
      const start = Math.max(todayStart, calendarStart);
      const end = Math.min(todayEnd, calendarEnd);
      if (end > start) segments.push({ start, end });
    } else if (todayStart < calendarEnd) {
      segments.push({ start: Math.max(todayStart, calendarStart), end: calendarEnd });
    }
  }

  return segments;
}

function addColumnDropHandlers(column) {
  column.addEventListener("dragover", (event) => {
    event.preventDefault();
    column.classList.add("drag-over");
  });
  column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
  column.addEventListener("drop", (event) => {
    event.preventDefault();
    column.classList.remove("drag-over");
    const id = event.dataTransfer.getData("text/plain");
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    captureUndo();
    const oldDuration = task.start !== null && task.end !== null ? task.end - task.start : inboxUnitCount(task) * 30;
    const snappedMinutes = snapCalendarMinutes(event.clientY, column);
    task.day = Number(column.dataset.day);
    task.start = Math.max(calendarStart, Math.min(calendarEnd - 15, snappedMinutes));
    task.end = Math.min(task.start + oldDuration, 24 * 60);
    save();
    render();
  });
}

function addInboxDropHandlers(panel) {
  panel.addEventListener("dragover", (event) => {
    event.preventDefault();
    panel.classList.add("drag-over");
  });
  panel.addEventListener("dragleave", () => panel.classList.remove("drag-over"));
  panel.addEventListener("drop", (event) => {
    event.preventDefault();
    panel.classList.remove("drag-over");
    const id = event.dataTransfer.getData("text/plain");
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    captureUndo();
    task.day = -1;
    task.start = null;
    task.end = null;
    save();
    render();
  });
}

function bindDeleteDropZone() {
  const panel = document.querySelector(".control-panel");
  if (!panel) return;

  const getDeletePayload = (event) => {
    const groupKey = activeSummaryGroupDrag?.groupKey || event.dataTransfer.getData("application/x-summary-group");
    if (groupKey) {
      const groupTasks = tasks.filter((item) => summaryGroupKey(item) === groupKey);
      if (groupTasks.length) return { type: "summary-group", groupKey, tasks: groupTasks };
    }

    const id = activeTaskDrag?.id || event.dataTransfer.getData("text/plain");
    const origin = activeTaskDrag?.origin || event.dataTransfer.getData("application/x-task-origin");
    const task = tasks.find((item) => item.id === id);
    if (!task || origin !== "inbox") return null;
    return task.day < 0 || task.start === null || task.end === null ? { type: "inbox-task", task } : null;
  };

  panel.addEventListener("dragover", (event) => {
    if (!getDeletePayload(event)) return;
    event.preventDefault();
    panel.classList.add("delete-drag-over");
  });

  panel.addEventListener("dragleave", (event) => {
    if (panel.contains(event.relatedTarget)) return;
    panel.classList.remove("delete-drag-over");
  });

  panel.addEventListener("drop", (event) => {
    const payload = getDeletePayload(event);
    if (!payload) return;
    event.preventDefault();
    panel.classList.remove("delete-drag-over");
    captureUndo();

    if (payload.type === "summary-group") {
      tasks = tasks.filter((item) => summaryGroupKey(item) !== payload.groupKey);
      delete planTargets[payload.groupKey];
      summaryOrder = summaryOrder.filter((key) => key !== payload.groupKey);
      savePlanTargets();
      saveSummaryOrder();
    } else {
      const { task } = payload;
      const groupKey = summaryGroupKey(task);
      const removedUnits = taskUnitCount(task);
      tasks = tasks.filter((item) => item.id !== task.id);
      if (planTargets[groupKey] !== undefined) {
        const groupTasks = tasks.filter((item) => summaryGroupKey(item) === groupKey);
        const scheduledUnits = scheduledUnitCount(groupTasks);
        planTargets[groupKey] = Math.max(scheduledUnits, Number(planTargets[groupKey] || 0) - removedUnits);
        syncPlanBuffer(groupKey);
        if (!tasks.some((item) => summaryGroupKey(item) === groupKey)) delete planTargets[groupKey];
        savePlanTargets();
      }
    }

    activeTaskDrag = null;
    activeSummaryGroupDrag = null;
    save();
    render();
  });
}

function renderStats() {
  const planTotals = getReviewPlanTotals(getReviewPlannedEntries());
  const actualTotals = getReviewActualTotals();
  const important = buildStat(planTotals.byKind.important, actualTotals.byKind.important);
  const flexible = buildStat(planTotals.byKind.flexible, actualTotals.byKind.flexible);
  const total = buildStat(
    planTotals.byKind.important + planTotals.byKind.flexible,
    actualTotals.byKind.important + actualTotals.byKind.flexible,
  );
  $("#statImportantHours").textContent = important.hours;
  $("#statImportantDone").textContent = important.done;
  $("#statFlexibleHours").textContent = flexible.hours;
  $("#statFlexibleDone").textContent = flexible.done;
  $("#statTotalHours").textContent = total.hours;
  $("#statTotalDone").textContent = total.done;
}

function formatUnits(units) {
  const hours = (units * 30) / 60;
  return `${hours.toFixed(units % 2 ? 1 : 0)}h`;
}

function formatDuration(minutes) {
  const rounded = Math.round(minutes);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const hoursPart = Math.floor(absolute / 60);
  const minutesPart = absolute % 60;
  if (!hoursPart && !minutesPart) return "0h";
  if (!hoursPart) return `${sign}${minutesPart}m`;
  if (!minutesPart) return `${sign}${hoursPart}h`;
  return `${sign}${hoursPart}h ${minutesPart}m`;
}

function ratioPercent(value, max) {
  return max ? Math.round((value / max) * 100) : 0;
}

function reviewBarHtml(percent) {
  const base = Math.min(100, Math.max(0, percent));
  const extra = Math.min(100, Math.max(0, percent - 100));
  return `
    <div class="review-bar ${percent > 100 ? "over-complete" : ""}" aria-hidden="true">
      <span class="review-bar-fill" style="width: ${base}%"></span>
      ${extra ? `<span class="review-bar-extra" style="width: ${extra}%"></span>` : ""}
    </div>
  `;
}

function renderReview() {
  const metrics = $("#reviewMetrics");
  const dayList = $("#reviewDayList");
  const kindList = $("#reviewKindList");
  if (!metrics || !dayList || !kindList) return;

  const plannedEntries = getReviewPlannedEntries();
  const planTotals = getReviewPlanTotals(plannedEntries);
  const actualTotals = getReviewActualTotals();
  const plannedMinutes = planTotals.totalMinutes;
  const actualMinutes = actualTotals.totalMinutes;
  const completion = ratioPercent(actualMinutes, plannedMinutes);
  const difference = actualMinutes - plannedMinutes;
  const differenceLabel = `${difference > 0 ? "+" : ""}${formatDuration(difference)}`;
  const metricRows = [
    ["计", "计划", `${formatHalfHourBlocks(plannedMinutes)}格 · ${formatDuration(plannedMinutes)}`],
    ["实", "实际", `${formatHalfHourBlocks(actualMinutes)}格 · ${formatDuration(actualMinutes)}`],
    ["差", "实际 - 计划", differenceLabel],
    ["录", "实际记录", actualRecords.length],
    ["待", "待分配时间", formatDuration(planTotals.pendingMinutes)],
  ];

  $("#reviewRange").textContent = getWeekRange();
  $("#reviewBoardCompareSummary").textContent = `已排 ${formatDuration(planTotals.scheduledMinutes)} · 待分配 ${formatDuration(
    planTotals.pendingMinutes,
  )} · 1格 = 30分钟`;
  metrics.innerHTML = `
    <div class="review-progress-card">
      <div class="review-ring ${completion > 100 ? "over-complete" : ""}" style="--percent: ${Math.min(completion, 100)}">
        <span>${completion}%</span>
      </div>
      <div>
        <small>实际 / 计划</small>
        <strong>${formatDuration(actualMinutes)} / ${formatDuration(plannedMinutes)}</strong>
      </div>
    </div>
    ${metricRows
    .map(
      ([icon, label, value]) => `
        <div class="review-metric">
          <span class="metric-icon">${icon}</span>
          <small>${label}</small>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("")}
  `;

  dayList.innerHTML = days
    .map((day, index) => {
      const dayPlans = plannedEntries.filter((entry) => entry.day === index);
      const planned = dayPlans.reduce((sum, entry) => sum + durationMinutes(entry), 0);
      const actual = actualTotals.byDay[index] || 0;
      const width = ratioPercent(actual, planned);
      return `
        <div class="review-line">
          <span class="review-line-label">${day}</span>
          <strong>${formatHalfHourBlocks(actual)}格</strong>
          ${reviewBarHtml(width)}
          <em>${width}% · ${formatDuration(actual)}/${formatDuration(planned)}</em>
        </div>
      `;
    })
    .join("");

  const kindRows = [
    ["重要", "important"],
    ["弹性", "flexible"],
    ["日程", "fixed"],
    ["必要事项", "necessary"],
  ];
  kindList.innerHTML = kindRows
    .map(([label, kind], index) => {
      const planned = planTotals.byKind[kind] || 0;
      const actual = actualTotals.byKind[kind] || 0;
      const width = ratioPercent(actual, planned);
      return `
        <div class="review-line review-kind-${index}">
          <span class="review-line-label">${label}</span>
          <strong>${formatHalfHourBlocks(actual)}格</strong>
          ${reviewBarHtml(width)}
          <em>${width}% · ${formatDuration(actual)}/${formatDuration(planned)}</em>
        </div>
      `;
    })
    .join("");

  renderReviewTimeBoard(plannedEntries);
  renderActualRecordList();
}

function getReviewPlannedEntries() {
  const entries = tasks
    .filter((task) => task.day >= 0 && task.start !== null && task.end !== null && task.end > task.start)
    .map((task) => {
      normalizeTaskKind(task);
      return { ...task, source: "task" };
    });

  necessarySchedule
    .filter((item) => item.enabled)
    .forEach((item) => {
      days.forEach((_, day) => {
        const group = day < 5 ? item.weekday : item.weekend;
        const start = toMinutes(group.start);
        const end = toMinutes(group.end);
        if (start === null || end === null || end <= start) return;
        entries.push({
          id: `necessary-${item.id}-${day}`,
          title: item.title,
          day,
          start,
          end,
          kind: "necessary",
          category: "OTHER",
          source: "necessary",
        });
      });
    });

  return entries;
}

function getReviewPlanTotals(plannedEntries) {
  const byKind = {
    important: 0,
    flexible: 0,
    fixed: 0,
    necessary: 0,
  };
  let pendingMinutes = 0;

  groupedByCategory().forEach(({ key, kind, categoryTasks }) => {
    const targetUnits = getGroupPlanUnits(key, categoryTasks);
    byKind[kind] += targetUnits * 30;
    pendingMinutes += Math.max(0, targetUnits - scheduledUnitCount(categoryTasks)) * 30;
  });

  plannedEntries
    .filter((entry) => ["fixed", "necessary"].includes(entry.kind))
    .forEach((entry) => {
      byKind[entry.kind] += durationMinutes(entry);
    });

  return {
    byKind,
    pendingMinutes,
    scheduledMinutes: plannedEntries.reduce((sum, entry) => sum + durationMinutes(entry), 0),
    totalMinutes: Object.values(byKind).reduce((sum, minutes) => sum + minutes, 0),
  };
}

function getReviewActualTotals() {
  const byKind = {
    important: 0,
    flexible: 0,
    fixed: 0,
    necessary: 0,
  };
  const byDay = Array(days.length).fill(0);
  const trackedKeys = new Set();

  groupedByCategory().forEach(({ key, kind, categoryTasks }) => {
    trackedKeys.add(key);
    const records = actualRecordsForGroup(key);
    const recordedByDay = Array(days.length).fill(0);
    records.forEach((record) => {
      if (record.day >= 0 && record.day < days.length) recordedByDay[record.day] += durationMinutes(record);
    });
    const checkedByDay = Array(days.length).fill(0);
    categoryTasks.forEach((task) => {
      if (task.day >= 0 && task.day < days.length) checkedByDay[task.day] += completedUnitCount(task) * 30;
    });
    let groupMinutes = categoryTasks
      .filter((task) => task.day < 0)
      .reduce((sum, task) => sum + completedUnitCount(task) * 30, 0);
    days.forEach((_, day) => {
      const effectiveMinutes = Math.max(recordedByDay[day], checkedByDay[day]);
      byDay[day] += effectiveMinutes;
      groupMinutes += effectiveMinutes;
    });
    byKind[kind] += groupMinutes;
  });

  actualRecords
    .filter((record) => !trackedKeys.has(actualRecordGroupKey(record)))
    .forEach((record) => {
      const minutes = durationMinutes(record);
      byKind[record.kind] += minutes;
      if (record.day >= 0 && record.day < days.length) byDay[record.day] += minutes;
    });

  return {
    byKind,
    byDay,
    totalMinutes: Object.values(byKind).reduce((sum, minutes) => sum + minutes, 0),
  };
}

function renderReviewTimeBoard(plannedEntries) {
  const board = $("#reviewPlanBoard");
  if (!board) return;
  const scale = pxPerMinute;
  const height = (calendarEnd - calendarStart) * scale;
  board.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "review-time-grid";
  grid.style.setProperty("--review-calendar-height", `${height}px`);

  const timeHeader = document.createElement("div");
  timeHeader.className = "review-time-header review-time-corner";
  timeHeader.textContent = "时间";
  grid.appendChild(timeHeader);
  days.forEach((day) => {
    const header = document.createElement("div");
    header.className = "review-time-header";
    header.innerHTML = `
      <span>${day}</span>
      <button class="review-day-add" type="button" title="记录${day}实际时间" aria-label="记录${day}实际时间">+</button>
    `;
    header.querySelector(".review-day-add").addEventListener("click", () => {
      $("#actualDay").value = String(days.indexOf(day));
      $("#actualEntryStatus").textContent = `记录${day}`;
      $("#actualTitle").focus();
    });
    grid.appendChild(header);
  });

  const ruler = document.createElement("div");
  ruler.className = "review-time-ruler";
  hours.forEach((hour) => {
    const marker = document.createElement("span");
    marker.style.top = `${(hour * 60 - calendarStart) * scale}px`;
    marker.textContent = `${hour}:00`;
    ruler.appendChild(marker);
  });
  grid.appendChild(ruler);

  days.forEach((_, day) => {
    const column = document.createElement("div");
    column.className = "review-time-column";
    column.dataset.day = day;
    addReviewColumnCreateHandlers(column);

    hours.forEach((hour) => {
      const line = document.createElement("i");
      line.className = "review-hour-line";
      line.style.top = `${(hour * 60 - calendarStart) * scale}px`;
      column.appendChild(line);
    });

    plannedEntries
      .filter((entry) => entry.day === day && entry.end > calendarStart && entry.start < calendarEnd)
      .forEach((entry) => {
        const block = document.createElement("button");
        const top = (Math.max(entry.start, calendarStart) - calendarStart) * scale;
        const bottom = (Math.min(entry.end, calendarEnd) - calendarStart) * scale;
        block.type = "button";
        block.className = `review-plan-block ${taskKindClass(entry.kind)}`;
        block.style.top = `${top}px`;
        block.style.height = `${Math.max(30, bottom - top)}px`;
        block.title = `按计划记录：${entry.title} ${fromMinutes(entry.start)}-${fromMinutes(entry.end)}`;
        block.innerHTML = `<strong>${escapeHtml(entry.title)}</strong>`;
        block.addEventListener("click", () => fillActualFormFromPlan(entry));
        column.appendChild(block);
      });

    actualRecords
      .filter((record) => record.day === day && record.end > calendarStart && record.start < calendarEnd)
      .forEach((record) => {
        const block = document.createElement("div");
        const top = (Math.max(record.start, calendarStart) - calendarStart) * scale;
        const bottom = (Math.min(record.end, calendarEnd) - calendarStart) * scale;
        block.className = `review-actual-block ${taskKindClass(record.kind)}`;
        block.style.top = `${top}px`;
        block.style.height = `${Math.max(30, bottom - top)}px`;
        block.title = `实际：${record.title} ${fromMinutes(record.start)}-${fromMinutes(record.end)}`;
        block.innerHTML = `<strong>${escapeHtml(record.title)}</strong>`;
        column.appendChild(block);
      });

    grid.appendChild(column);
  });

  board.appendChild(grid);
}

function addReviewColumnCreateHandlers(column) {
  column.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.target.closest(".review-plan-block")) return;
    event.preventDefault();
    const start = Math.min(calendarEnd - 15, snapCalendarMinutes(event.clientY, column));
    const draft = document.createElement("div");
    draft.className = "review-actual-draft";
    column.appendChild(draft);
    reviewCreateDraft = {
      column,
      day: Number(column.dataset.day),
      anchor: start,
      start,
      end: Math.min(start + 30, calendarEnd),
      draft,
      moved: false,
    };
    updateReviewCreateDraft(event.clientY);
    document.addEventListener("mousemove", handleReviewCreateMove);
    document.addEventListener("mouseup", handleReviewCreateEnd);
  });
}

function handleReviewCreateMove(event) {
  if (!reviewCreateDraft) return;
  reviewCreateDraft.moved = true;
  updateReviewCreateDraft(event.clientY);
}

function handleReviewCreateEnd(event) {
  document.removeEventListener("mousemove", handleReviewCreateMove);
  document.removeEventListener("mouseup", handleReviewCreateEnd);
  if (!reviewCreateDraft) return;
  updateReviewCreateDraft(event.clientY);
  const { day, start, end, draft, moved } = reviewCreateDraft;
  draft.remove();
  reviewCreateDraft = null;
  if (!moved) return;

  $("#actualDay").value = String(day);
  $("#actualStart").value = fromMinutes(start);
  const formEnd = Math.min(calendarEnd - 1, Math.max(start + 15, end));
  $("#actualEnd").value = fromMinutes(formEnd);
  actualDraftGroupKey = "";
  $("#actualEntryStatus").textContent = `${days[day]} ${fromMinutes(start)}-${fromMinutes(formEnd)}`;
  document.querySelector(".actual-entry-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => $("#actualTitle").focus({ preventScroll: true }), 250);
}

function updateReviewCreateDraft(clientY) {
  if (!reviewCreateDraft) return;
  const endPoint = snapCalendarMinutes(clientY, reviewCreateDraft.column);
  const start = Math.min(reviewCreateDraft.anchor, endPoint);
  const end = Math.max(reviewCreateDraft.anchor, endPoint);
  reviewCreateDraft.start = start;
  reviewCreateDraft.end = end > start ? end : Math.min(start + 30, calendarEnd);
  const top = (reviewCreateDraft.start - calendarStart) * pxPerMinute;
  const height = Math.max(30, (reviewCreateDraft.end - reviewCreateDraft.start) * pxPerMinute);
  reviewCreateDraft.draft.style.top = `${top}px`;
  reviewCreateDraft.draft.style.height = `${height}px`;
  reviewCreateDraft.draft.textContent = `${fromMinutes(reviewCreateDraft.start)}-${fromMinutes(reviewCreateDraft.end)}`;
}

function fillActualFormFromPlan(entry) {
  $("#actualTitle").value = entry.title;
  $("#actualDay").value = String(entry.day);
  $("#actualKind").value = entry.kind;
  $("#actualStart").value = fromMinutes(entry.start);
  $("#actualEnd").value = fromMinutes(entry.end);
  actualDraftGroupKey = ["important", "flexible"].includes(entry.kind) ? summaryGroupKey(entry) : "";
  $("#actualEntryStatus").textContent = "已带入计划";
  $("#actualTitle").focus();
}

function clearActualForm() {
  $("#actualTitle").value = "";
  $("#actualStart").value = "";
  $("#actualEnd").value = "";
  actualDraftGroupKey = "";
  $("#actualEntryStatus").textContent = "新记录";
}

function addActualRecord() {
  const title = $("#actualTitle").value.trim();
  const day = Number($("#actualDay").value);
  const start = toMinutes($("#actualStart").value);
  const end = toMinutes($("#actualEnd").value);
  const kind = $("#actualKind").value;

  if (!title || !Number.isInteger(day) || start === null || end === null) {
    alert("请填写实际事项、日期、开始时间和结束时间。");
    return;
  }
  if (end <= start) {
    alert("结束时间必须晚于开始时间。");
    return;
  }

  captureUndo();
  const record = {
    id: uid(),
    title,
    day,
    start,
    end,
    kind,
    createdAt: new Date().toISOString(),
  };
  if (actualDraftGroupKey) {
    const { label } = parseSummaryGroupKey(actualDraftGroupKey);
    record.groupKey = `${kind}:${label}`;
  } else {
    record.groupKey = actualRecordGroupKey(record);
  }
  actualRecords.push(record);
  actualRecords.sort((a, b) => a.day - b.day || a.start - b.start);
  saveActualRecords();
  clearActualForm();
  render();
}

function deleteActualRecord(id) {
  if (!actualRecords.some((record) => record.id === id)) return;
  captureUndo();
  actualRecords = actualRecords.filter((record) => record.id !== id);
  saveActualRecords();
  render();
}

function renderActualRecordList() {
  const list = $("#actualRecordList");
  const count = $("#actualRecordCount");
  if (!list || !count) return;
  count.textContent = `${actualRecords.length} 条`;

  if (!actualRecords.length) {
    list.innerHTML = `<p class="actual-record-empty">还没有实际记录。点击上面的浅色计划块，或直接填写一条记录。</p>`;
    return;
  }

  list.innerHTML = days
    .map((day, dayIndex) => {
      const records = actualRecords.filter((record) => record.day === dayIndex);
      if (!records.length) return "";
      const total = records.reduce((sum, record) => sum + durationMinutes(record), 0);
      return `
        <section class="actual-day-group">
          <div class="actual-day-heading">
            <strong>${day}</strong>
            <span>${formatDuration(total)}</span>
          </div>
          <div class="actual-day-records">
            ${records
              .map(
                (record) => `
                  <article class="actual-record-card ${taskKindClass(record.kind)}">
                    <span class="actual-record-time">${fromMinutes(record.start)}-${fromMinutes(record.end)}</span>
                    <strong>${escapeHtml(record.title)}</strong>
                    <span class="actual-record-kind">${taskKindLabel(record.kind)}</span>
                    <button class="actual-delete-button" type="button" data-id="${record.id}" title="删除实际记录" aria-label="删除实际记录">×</button>
                  </article>
                `,
              )
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");

  list.querySelectorAll(".actual-delete-button").forEach((button) => {
    button.addEventListener("click", () => deleteActualRecord(button.dataset.id));
  });
}

function buildStat(plannedMinutes, actualMinutes) {
  return {
    hours: formatDuration(plannedMinutes),
    done: `${ratioPercent(actualMinutes, plannedMinutes)}%`,
  };
}

function readWeekTasks(weekId) {
  const previousWeekId = currentWeekId;
  currentWeekId = weekId;
  const weekTasks = readScopedArray(storageKey);
  currentWeekId = previousWeekId;
  return weekTasks;
}

function readWeekArray(weekId, key) {
  const previousWeekId = currentWeekId;
  currentWeekId = weekId;
  const value = readScopedArray(key);
  currentWeekId = previousWeekId;
  return value;
}

function readWeekObject(weekId, key) {
  const previousWeekId = currentWeekId;
  currentWeekId = weekId;
  const value = readScopedObject(key);
  currentWeekId = previousWeekId;
  return value;
}

function writeWeekValue(weekId, key, value) {
  localStorage.setItem(`${key}-${weekId}`, JSON.stringify(value));
}

function removeWeekValue(weekId, key) {
  localStorage.removeItem(`${key}-${weekId}`);
}

function cloneTasksForNewWeek(sourceTasks) {
  return sourceTasks.map((task) => ({
    ...task,
    id: uid(),
    done: false,
    completedUnits: [],
  }));
}

function nextAvailableWeekId(sourceWeekId) {
  const monday = dateFromWeekId(sourceWeekId);
  do {
    monday.setDate(monday.getDate() + 7);
  } while (weeks.some((week) => week.id === formatDateId(monday)));
  return formatDateId(monday);
}

function showHome() {
  $("#homeScreen").classList.remove("hidden");
  document.querySelector(".app-shell").classList.add("hidden");
  renderHome();
}

function showBoard(weekId) {
  currentWeekId = weekId;
  localStorage.setItem(activeWeekKey, currentWeekId);
  load();
  $("#homeScreen").classList.add("hidden");
  document.querySelector(".app-shell").classList.remove("hidden");
  document.querySelectorAll(".tab[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === "board"));
  $("#boardView").classList.remove("hidden");
  $("#reviewView").classList.add("hidden");
  if ($("#actualDay")) {
    const todayIndex = (new Date().getDay() + 6) % 7;
    $("#actualDay").value = String(currentWeekId === getWeekId() ? todayIndex : 0);
  }
  render();
}

function renderHome() {
  const list = $("#weekList");
  if (!list) return;
  saveWeeks();
  list.innerHTML = "";
  weeks.forEach((week) => {
    const weekTasks = readWeekTasks(week.id);
    const scheduled = weekTasks.filter((task) => task.day >= 0 && task.start !== null && task.end !== null).length;
    const inbox = weekTasks.length - scheduled;
    const card = document.createElement("article");
    card.className = "week-card";
    card.innerHTML = `
      <span class="week-card-range">${escapeHtml(week.range)}</span>
      <strong>${escapeHtml(week.title)}</strong>
      <span class="week-card-meta">${scheduled} 个已安排 · ${Math.max(0, inbox)} 个在收件箱</span>
      <div class="week-card-actions">
        <button class="secondary-button open-week-btn" type="button"><span class="button-icon">↗</span>打开</button>
        <button class="secondary-button copy-week-btn" type="button"><span class="button-icon">⧉</span>复制</button>
        <button class="danger-button delete-week-btn" type="button"><span class="button-icon">×</span>删除</button>
      </div>
    `;
    card.querySelector(".open-week-btn").addEventListener("click", () => showBoard(week.id));
    card.querySelector(".copy-week-btn").addEventListener("click", () => copyWeekBoard(week.id));
    card.querySelector(".delete-week-btn").addEventListener("click", () => deleteWeekBoard(week.id));
    card.addEventListener("dblclick", () => showBoard(week.id));
    list.appendChild(card);
  });
}

function deleteWeekBoard(weekId) {
  const week = weeks.find((item) => item.id === weekId);
  if (!week) return;
  if (!confirm(`确定删除「${week.title}」吗？这个周看板里的任务和设置都会被删除。`)) return;

  removeWeekValue(weekId, storageKey);
  removeWeekValue(weekId, summaryOrderKey);
  removeWeekValue(weekId, sleepScheduleKey);
  removeWeekValue(weekId, planTargetsKey);
  removeWeekValue(weekId, necessaryScheduleKey);
  removeWeekValue(weekId, actualRecordsKey);

  weeks = weeks.filter((item) => item.id !== weekId);
  if (!weeks.length) weeks = [makeWeek(getWeekId())];
  saveWeeks();

  if (currentWeekId === weekId) {
    currentWeekId = weeks[0].id;
    localStorage.setItem(activeWeekKey, currentWeekId);
    load();
  }
  showHome();
}

function copyWeekBoard(sourceWeekId) {
  const targetWeekId = nextAvailableWeekId(sourceWeekId);
  const targetWeek = makeWeek(targetWeekId);
  weeks.push(targetWeek);
  saveWeeks();

  writeWeekValue(targetWeekId, storageKey, cloneTasksForNewWeek(readWeekTasks(sourceWeekId)));
  writeWeekValue(targetWeekId, summaryOrderKey, readWeekArray(sourceWeekId, summaryOrderKey));
  writeWeekValue(targetWeekId, sleepScheduleKey, readWeekArray(sourceWeekId, sleepScheduleKey));
  writeWeekValue(targetWeekId, planTargetsKey, readWeekObject(sourceWeekId, planTargetsKey));
  writeWeekValue(targetWeekId, necessaryScheduleKey, readWeekArray(sourceWeekId, necessaryScheduleKey));
  writeWeekValue(targetWeekId, actualRecordsKey, []);

  showBoard(targetWeekId);
}

function addNextWeek() {
  const latest = weeks.reduce((max, week) => (week.id > max ? week.id : max), weeks[0]?.id || getWeekId());
  const nextMonday = dateFromWeekId(latest);
  nextMonday.setDate(nextMonday.getDate() + 7);
  const id = formatDateId(nextMonday);
  if (!weeks.some((week) => week.id === id)) {
    weeks.push(makeWeek(id));
    saveWeeks();
  }
  showBoard(id);
}

function render() {
  $("#weekLabel").textContent = `当前周 ${getWeekRange()}`;
  $("#boardTitle").textContent = `Eric D 周看板 ${getWeekRange()}`;
  renderNecessarySettings();
  renderSummary();
  renderSchedule();
  renderReview();
  renderStats();
}

function renderNecessarySettings() {
  const panel = $("#necessarySettings");
  if (!panel) return;
  necessarySchedule.forEach((item) => {
    const enabled = panel.querySelector(`input[type="checkbox"][data-item="${item.id}"]`);
    if (enabled) enabled.checked = item.enabled;
    ["weekday", "weekend"].forEach((group) => {
      const start = panel.querySelector(`input[data-item="${item.id}"][data-group="${group}"][data-field="start"]`);
      const end = panel.querySelector(`input[data-item="${item.id}"][data-group="${group}"][data-field="end"]`);
      if (start) start.value = item[group].start;
      if (end) end.value = item[group].end;
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}

function openEditor(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  editingId = id;
  $("#editTitle").value = task.title;
  $("#editDay").value = task.day;
  $("#editStart").value = task.start === null ? "" : fromMinutes(task.start);
  $("#editEnd").value = task.end === null ? "" : fromMinutes(task.end);
  $("#editCategory").value = ["HOMEWORK", "JAVA", "ENGLISH", "MATH", "SCIENCE", "SPORTS"].includes(task.category)
    ? task.category
    : "OTHER";
  $("#editKind").value = task.kind || "important";
  $("#editDone").checked = isTaskDone(task);
  $("#taskDialog").showModal();
}

function addTaskFromTopPanel() {
  const titleInput = $("#topTaskTitle");
  const title = titleInput.value.trim() || "新任务";
  const kind = $("#topTaskKind").value;
  const selectedDay = Number($("#topTaskDay").value);
  const start = $("#topTaskStart").value ? toMinutes($("#topTaskStart").value) : null;
  const endInput = $("#topTaskEnd").value ? toMinutes($("#topTaskEnd").value) : null;
  const hasSchedule = selectedDay >= 0 && start !== null;
  const end = hasSchedule ? Math.min(calendarEnd, endInput && endInput > start ? endInput : start + 30) : null;

  captureUndo();
  tasks.push({
    id: uid(),
    title,
    day: hasSchedule ? selectedDay : -1,
    start: hasSchedule ? start : null,
    end,
    category: inferCategory(title),
    kind,
    done: false,
    completedUnits: [],
  });

  titleInput.value = "";
  $("#topTaskStart").value = "";
  $("#topTaskEnd").value = "";
  save();
  render();
}

function bindEvents() {
  $("#addWeekBtn")?.addEventListener("click", addNextWeek);
  $("#homeBtn")?.addEventListener("click", showHome);
  $("#addTopTaskBtn")?.addEventListener("click", addTaskFromTopPanel);
  $("#addActualBtn")?.addEventListener("click", addActualRecord);
  $("#actualTitle")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addActualRecord();
  });
  $("#topTaskTitle")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addTaskFromTopPanel();
  });
  bindDeleteDropZone();
  document.addEventListener("keydown", (event) => {
    const isUndo = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z";
    if (!isUndo) return;
    const active = document.activeElement;
    const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(active?.tagName);
    if (isTyping && active.value) return;
    event.preventDefault();
    active?.blur?.();
    undoLastChange();
  });
  if ($("#taskInput")) $("#taskInput").value = demoText;
  $("#parseBtn")?.addEventListener("click", () => {
    captureUndo();
    tasks = parseTasks($("#taskInput").value);
    planTargets = {};
    savePlanTargets();
    save();
    render();
  });
  $("#loadDemoBtn")?.addEventListener("click", () => {
    captureUndo();
    $("#taskInput").value = demoText;
    tasks = parseTasks(demoText);
    planTargets = {};
    savePlanTargets();
    save();
    render();
  });
  $("#necessarySettings")?.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      const item = necessarySchedule.find((entry) => entry.id === input.dataset.item);
      if (!item) return;
      captureUndo();
      if (input.type === "checkbox") item.enabled = input.checked;
      else item[input.dataset.group][input.dataset.field] = input.value;
      saveNecessarySchedule();
      render();
    });
  });
  $("#addQuickBtn").addEventListener("click", () => {
    const title = $("#quickTitle").value.trim() || "新任务";
    captureUndo();
    tasks.push({
      id: uid(),
      title,
      day: -1,
      start: null,
      end: null,
      category: inferCategory(title),
      kind: "important",
      done: false,
      completedUnits: [],
    });
    $("#quickTitle").value = "";
    save();
    render();
  });
  $("#saveTaskBtn").addEventListener("click", () => {
    const task = tasks.find((item) => item.id === editingId);
    if (!task) return;
    const oldGroupKey = summaryGroupKey(task);
    captureUndo();
    task.title = $("#editTitle").value.trim() || "未命名任务";
    task.day = Number($("#editDay").value);
    task.start = $("#editStart").value ? toMinutes($("#editStart").value) : null;
    task.end = $("#editEnd").value ? toMinutes($("#editEnd").value) : null;
    task.category = $("#editCategory").value === "OTHER" ? inferCategory(task.title) : $("#editCategory").value;
    task.kind = $("#editKind").value;
    setTaskDone(task, $("#editDone").checked);
    const nextGroupKey = summaryGroupKey(task);
    const oldGroupStillExists = tasks.some((item) => item.id !== task.id && summaryGroupKey(item) === oldGroupKey);
    if (!oldGroupStillExists) migrateSummaryGroupKey(oldGroupKey, nextGroupKey);
    save();
    $("#taskDialog").close();
    render();
  });
  $("#deleteTaskBtn").addEventListener("click", () => {
    captureUndo();
    tasks = tasks.filter((task) => task.id !== editingId);
    save();
    $("#taskDialog").close();
    render();
  });
  $("#clearBtn").addEventListener("click", () => {
    if (!confirm("确定清空当前周看板吗？")) return;
    captureUndo();
    tasks = [];
    planTargets = {};
    savePlanTargets();
    save();
    render();
  });
  $("#printBtn").addEventListener("click", exportPdf);
  $("#exportBtn").addEventListener("click", exportJson);
  $("#importFile").addEventListener("change", importJson);
  document.querySelectorAll(".tab").forEach((tab) => {
    if (!tab.dataset.view) return;
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      const view = tab.dataset.view;
      $("#boardView").classList.toggle("hidden", view !== "board");
      $("#reviewView").classList.toggle("hidden", view !== "review");
    });
  });
}

function exportJson() {
  const payload = {
    version: 2,
    tasks,
    actualRecords,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `week-board-${getWeekRange().replace("/", "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      const importedTasks = Array.isArray(imported) ? imported : imported.tasks;
      if (!Array.isArray(importedTasks)) throw new Error("invalid");
      captureUndo();
      tasks = importedTasks;
      if (!Array.isArray(imported) && Array.isArray(imported.actualRecords)) {
        actualRecords = normalizeActualRecordList(imported.actualRecords);
        saveActualRecords();
      }
      tasks.forEach(normalizeTaskKind);
      tasks.forEach(normalizeTaskProgress);
      save();
      render();
    } catch {
      alert("导入失败：请选择这个工具导出的 JSON 文件。");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      if (existing.dataset.loaded) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function loadPdfLibraries() {
  if (!window.html2canvas) {
    await loadScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js");
  }
  if (!window.jspdf?.jsPDF) {
    await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
  }
}

function createPdfCaptureNode() {
  const board = $("#boardView").cloneNode(true);
  board.classList.remove("hidden");
  const wrapper = document.createElement("div");
  wrapper.className = "pdf-capture";
  wrapper.appendChild(board);
  document.body.appendChild(wrapper);

  const grid = wrapper.querySelector(".schedule-grid");
  const shell = wrapper.querySelector(".schedule-shell");
  const calendarHeight = Number.parseFloat(grid?.style.getPropertyValue("--calendar-height")) || (calendarEnd - calendarStart) * pxPerMinute;
  const scheduleScale = 0.78;
  if (grid && shell) {
    grid.style.transform = `scaleY(${scheduleScale})`;
    grid.style.transformOrigin = "top left";
    shell.style.height = `${(48 + calendarHeight) * scheduleScale}px`;
    shell.style.overflow = "hidden";
  }

  return wrapper;
}

async function exportPdf() {
  document.querySelectorAll(".tab[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === "board"));
  $("#boardView").classList.remove("hidden");
  $("#reviewView").classList.add("hidden");

  const button = $("#printBtn");
  const oldText = button.textContent;
  button.textContent = "生成中...";
  button.disabled = true;

  let captureNode = null;
  try {
    await loadPdfLibraries();
    captureNode = createPdfCaptureNode();
    const canvas = await window.html2canvas(captureNode, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
    });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = 297;
    const pageHeight = 210;
    const margin = 3;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const imageRatio = canvas.width / canvas.height;
    const pageRatio = usableWidth / usableHeight;
    const width = imageRatio > pageRatio ? usableWidth : usableHeight * imageRatio;
    const height = imageRatio > pageRatio ? usableWidth / imageRatio : usableHeight;
    const x = (pageWidth - width) / 2;
    const y = (pageHeight - height) / 2;
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.96), "JPEG", x, y, width, height);
    pdf.save(`Eric-D-周看板-${getWeekRange().replace("/", "-")}.pdf`);
  } catch (error) {
    alert("PDF 生成失败。请确认网络可以加载 PDF 组件后再试一次。");
  } finally {
    captureNode?.remove();
    button.textContent = oldText;
    button.disabled = false;
  }
}

loadWeeks();
load();
bindEvents();
showHome();
