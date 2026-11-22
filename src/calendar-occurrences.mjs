export const validWeekKey = (value) => typeof value === 'string' && /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value);

export function excludedWeeks(event) {
  let value = event.excluded_weeks;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = []; } }
  return Array.isArray(value) ? [...new Set(value.filter(validWeekKey))] : [];
}

export function occursInWeek(event, week) {
  const start = recurrenceStartWeek(event);
  if (start && week < start) return false;
  const end = recurrenceEndWeek(event);
  if (end && week >= end) return false;
  if (excludedWeeks(event).includes(week)) return false;
  return !event.week_key || event.week_key === week || (event.repeat_rule === 'weekly' && event.layer !== 'actual');
}

// Exclusive boundary: occurrences before this ISO week remain unchanged.
export function recurrenceEndWeek(event) {
  return validWeekKey(event.ends_before_week) ? event.ends_before_week : null;
}

export function recurrenceStartWeek(event) {
  return validWeekKey(event.starts_on_week) ? event.starts_on_week : null;
}

export function hasWeeklyRecurrence(event) {
  return !event.week_key || (event.repeat_rule === 'weekly' && event.layer !== 'actual');
}

export function applyCalendarEdit(events, result, id) {
  if (!result.replacement) return events.map((event) => event.id === id ? result : event);
  return [...events.filter((event) => event.id !== id && event.id !== result.replacement.id), result.event, result.replacement];
}
