const DAYS = ['周一','周二','周三','周四','周五','周六','周日'];

export function deterministicSchedule({ tasks = [], fixed = [], windows = {} } = {}) {
  const occupied = new Map(DAYS.map(day => [day, fixed.filter(x => x.day === day).map(x => [x.start_minute, x.end_minute]) ]));
  const blocks = [];
  const sorted = [...tasks].filter(t => t && t.title).sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
  for (const task of sorted) {
    let remaining = Math.max(15, Number(task.estimate_minutes) || 30);
    for (const day of DAYS) {
      if (!remaining) break;
      const [from, to] = windows[day] || [540, 1080];
      for (let start = from; start + 15 <= to && remaining; start += 15) {
        const end = Math.min(start + Math.min(remaining, 60), to);
        if (occupied.get(day).some(([a, b]) => start < b && end > a)) continue;
        occupied.get(day).push([start, end]);
        blocks.push({ task_id: task.id ?? null, title: task.title, day, start_minute: start, end_minute: end });
        remaining -= end - start;
      }
    }
    if (remaining) blocks.push({ task_id: task.id ?? null, title: task.title, day: null, start_minute: null, end_minute: null, unscheduled_minutes: remaining });
  }
  return { summary: `本地排程完成：${blocks.filter(x => x.day).length} 个时间块`, blocks, warnings: blocks.filter(x => !x.day).map(x => `${x.title} 仍有 ${x.unscheduled_minutes} 分钟未安排`) };
}
