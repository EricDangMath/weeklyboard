export const validWeekKey = (value) => typeof value === 'string' && /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value);

export function excludedWeeks(event) {
  let value = event.excluded_weeks;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = []; } }
  return Array.isArray(value) ? [...new Set(value.filter(validWeekKey))] : [];
}

export function occursInWeek(event, week) {
  if (excludedWeeks(event).includes(week)) return false;
  return !event.week_key || event.week_key === week || (event.repeat_rule === 'weekly' && event.layer !== 'actual');
}
