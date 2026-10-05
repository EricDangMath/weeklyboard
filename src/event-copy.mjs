export function copyTarget(source, day, minute, range, step = 10) {
  const duration = Number(source.end_minute) - Number(source.start_minute);
  if (!day || !Number.isFinite(minute) || duration <= 0 || duration > range.end - range.start) return null;
  const start = Math.max(range.start, Math.min(range.end - duration, Math.round(minute / step) * step));
  return { day, start_minute: start, end_minute: start + duration };
}

export function eventCopyPayload(source, target, weekKey) {
  // Whitelist user-editable fields: a copy never inherits a source feed's
  // identity, lock, recurrence, or completion state.
  return {
    title: source.title,
    description: source.description || '',
    category: source.category || source.cat || 'other',
    layer: source.layer || 'actual',
    task_id: source.task_id ?? null,
    ...target,
    week_key: weekKey,
    repeat: false,
    locked: false,
    source: 'calendar',
  };
}
