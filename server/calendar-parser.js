import ical from 'node-ical';
import { createHash } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const text = (value) => String(value?.val ?? value ?? '');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const DAY = 86400000;
const safeUrl = (value) => { try { const url = new URL(text(value)); return url.protocol === 'https:' && !url.username && !url.password && !url.pathname.includes('/feeds/calendars/') ? url.href : ''; } catch { return ''; } };
const deadlineKind = (title) => /\b(?:exam|quiz|test|midterm)\b|考试|测验|期中|期末/i.test(title) ? 'exam' : 'hw';
export function isoWeek(date) {
  const d = new Date(date); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  return `${year}-W${String(Math.ceil(((d - Date.UTC(year, 0, 1)) / DAY + 1) / 7)).padStart(2, '0')}`;
}

export function parseFeed(raw, { timezone = 'UTC', mode = 'schedule', now = new Date().toISOString() } = {}) {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new Error('时区无效'); }
  const unfolded = raw.replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '');
  if (!/^BEGIN:VCALENDAR\s*$/m.test(unfolded) || !/^END:VCALENDAR\s*$/m.test(unfolded) || (unfolded.match(/^BEGIN:VEVENT\s*$/gm) || []).length !== (unfolded.match(/^END:VEVENT\s*$/gm) || []).length) throw new Error('链接没有返回完整的 ICS 日历，可能是登录页面或链接已过期');
  const calendarZone = unfolded.match(/^X-WR-TIMEZONE:(.+)$/m)?.[1].trim() || timezone;
  try { new Intl.DateTimeFormat('en', { timeZone: calendarZone }).format(); } catch { throw new Error('日历的时区暂不支持'); }
  const prepared = unfolded.replace(/^(DTSTART|DTEND|RECURRENCE-ID|EXDATE|RDATE):(\d{8}T\d{6}(?:,\d{8}T\d{6})*)\r?$/gm, `$1;TZID=${calendarZone}:$2`);
  const calendar = ical.sync.parseICS(prepared);
  const components = Object.values(calendar).filter((event) => event.type === 'VEVENT');
  const from = new Date(new Date(now).getTime() - 28 * DAY), to = new Date(new Date(now).getTime() + 183 * DAY);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const local = (date, allDay) => {
    if (allDay) return { date: Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()), minute: 0 };
    const p = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
    return { date: Date.UTC(+p.year, +p.month - 1, +p.day), minute: +p.hour * 60 + +p.minute };
  };
  const blocks = new Map();
  for (const event of components) {
    if (event.status === 'CANCELLED') continue;
    if (!(event.start instanceof Date) || !Number.isFinite(+event.start)) throw new Error('日历中有无效的开始时间，同步已停止');
    const uid = text(event.uid) || hash([text(event.summary), event.start.toISOString()]);
    // Preserve the wall-clock values of earlier WeeklyBoard exports.
    if (DAYS.includes(text(event['WB-DAY'])) && /^\d{4}-W\d{2}$/.test(text(event['WB-WEEK']))) {
      const start = Number(text(event['WB-START'])), end = Number(text(event['WB-END']));
      if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 1440 && start < end) {
        const key = hash([uid, 'wb']);
        blocks.set(key, { external_key: key, title: text(event.summary).slice(0, 200) || '未命名日程', description: '', day: text(event['WB-DAY']), start_minute: start, end_minute: end, week_key: text(event['WB-WEEK']), all_day: 0 });
        continue;
      }
    }
    const instances = event.rrule ? ical.expandRecurringEvent(event, { from, to, expandOngoing: true }) : [{ start: event.start, end: event.end, event, isFullDay: event.datetype === 'date' || Boolean(event.start.dateOnly) }];
    for (const instance of instances) {
      const item = instance.event;
      if (item.status === 'CANCELLED') continue;
      const allDay = instance.isFullDay;
      const start = local(instance.start, allDay);
      const identity = event.rrule ? (item.recurrenceid || instance.start).toISOString() : text(item.recurrenceid);
      if (mode === 'deadlines') {
        const summary = text(item.summary || event.summary).trim();
        const course = summary.match(/\s*\[([^\]]+)\]\s*$/)?.[1] || '';
        const title = (course ? summary.replace(/\s*\[[^\]]+\]\s*$/, '') : summary) || '未命名截止事项';
        const key = hash([uid, identity, 0]);
        blocks.set(key, {
          external_key: key, title: title.slice(0, 500), description: text(item.description || event.description).slice(0, 20000),
          course: course.slice(0, 300), event_url: safeUrl(item.url || event.url), deadline_kind: deadlineKind(title),
          due_minute: allDay ? null : start.minute, day: DAYS[(new Date(start.date).getUTCDay() + 6) % 7],
          week_key: isoWeek(start.date), date: new Date(start.date).toISOString().slice(0, 10), start_minute: 0, end_minute: 1440, all_day: 1,
        });
        if (blocks.size > 5000) throw new Error('日历日程超过 5000 条，请缩小订阅范围');
        continue;
      }
      const end = local(instance.end || new Date(+instance.start + (allDay ? DAY : 30 * 60000)), allDay);
      // Some school feeds use an inclusive same-day DTEND for all-day reminders.
      if (allDay && end.date === start.date) end.date += DAY;
      if (end.date + end.minute * 60000 <= start.date + start.minute * 60000) continue;
      if ((end.date - start.date) / DAY > 366) throw new Error('日历中的单个日程超过一年');
      let segment = 0;
      for (let date = start.date; date <= end.date; date += DAY, segment++) {
        const a = date === start.date ? start.minute : 0, b = date === end.date ? end.minute : 1440;
        if (b <= a) continue;
        const key = hash([uid, identity, segment]);
        blocks.set(key, {
          external_key: key, title: text(item.summary || event.summary).slice(0, 200) || '未命名日程',
          description: [text(item.location), text(item.description)].filter(Boolean).join('\n').slice(0, 2000),
          day: DAYS[(new Date(date).getUTCDay() + 6) % 7], week_key: isoWeek(date), date: new Date(date).toISOString().slice(0, 10),
          start_minute: a, end_minute: b, all_day: allDay ? 1 : 0,
        });
        if (blocks.size > 5000) throw new Error('日历日程超过 5000 条，请缩小订阅范围');
      }
    }
  }
  return { blocks: [...blocks.values()], events: components.length, timezone };
}

if (parentPort) {
  try { parentPort.postMessage(parseFeed(workerData.raw, workerData.options)); }
  catch (error) {
    const safe = /^(时区无效|链接没有|日历中|日历的|日历日程)/.test(error.message);
    parentPort.postMessage({ error: safe ? error.message : '日历格式无法解析，已有日程未改动' });
  }
}
