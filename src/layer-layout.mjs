export const LAYER_IDS = ['fixed', 'flex', 'once', 'actual'];
export const LAYER_VIEW_KEY = 'wb-layer-view-v1';

export function normalizeLayerView(value) {
  const visible = Array.isArray(value?.visible) ? LAYER_IDS.filter((id) => value.visible.includes(id)) : [...LAYER_IDS];
  const requested = LAYER_IDS.includes(value?.active) ? value.active : 'actual';
  return { visible, active: visible.length && !visible.includes(requested) ? visible[0] : requested };
}

export function readLayerView(storage) {
  try { return normalizeLayerView(JSON.parse(storage.getItem(LAYER_VIEW_KEY))); }
  catch { return normalizeLayerView(null); }
}

export function toggleVisibleLayer(view, id) {
  if (!LAYER_IDS.includes(id)) return view;
  return normalizeLayerView({ ...view, visible: view.visible.includes(id) ? view.visible.filter((item) => item !== id) : [...view.visible, id] });
}

export function selectEditingLayer(view, id) {
  if (!LAYER_IDS.includes(id)) return view;
  return normalizeLayerView({ active: id, visible: [...view.visible, id] });
}

export function layoutDayEvents(events) {
  const sorted = events.filter((event) => !event.all_day && !event.deadline_kind)
    .map((event) => ({ event, start: Number(event.start_minute), end: Number(event.end_minute) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start || b.end - a.end || LAYER_IDS.indexOf(a.event.layer) - LAYER_IDS.indexOf(b.event.layer) || String(a.event.id).localeCompare(String(b.event.id)));
  const result = [];
  let group = [];
  let groupEnd = -Infinity;
  const flush = () => {
    const columns = [];
    for (const item of group) {
      let column = columns.findIndex((entries) => entries.at(-1).end <= item.start);
      if (column === -1) { column = columns.length; columns.push([]); }
      item.column = column;
      columns[column].push(item);
    }
    // Expand into unused lanes without covering any simultaneous event.
    for (const item of group) {
      let span = 1;
      for (let column = item.column + 1; column < columns.length; column++) {
        if (columns[column].some((other) => item.start < other.end && other.start < item.end)) break;
        span++;
      }
      result.push({ ...item, columns: columns.length, span });
    }
  };
  for (const item of sorted) {
    if (item.start >= groupEnd) { flush(); group = []; }
    group.push(item);
    groupEnd = Math.max(item.end, group.length === 1 ? -Infinity : groupEnd);
  }
  flush();
  return result;
}

export function fillBackground(fills, colorFor) {
  const colors = fills.map((fill) => `${colorFor(fill.cat)}27`);
  if (!colors.length) return undefined;
  if (colors.length === 1) return colors[0];
  return `linear-gradient(to right, ${colors.map((color, index) => `${color} ${index / colors.length * 100}% ${(index + 1) / colors.length * 100}%`).join(', ')})`;
}
