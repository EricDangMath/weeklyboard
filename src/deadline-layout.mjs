export const hasDueTime = (item) => Number.isInteger(item.due_minute) && item.due_minute >= 0 && item.due_minute < 1440;

export function deadlineTimeRange(items, start = 360, end = 1380) {
  const minutes = items.filter(hasDueTime).map((item) => item.due_minute);
  return {
    start: Math.floor(Math.min(start, ...minutes) / 60) * 60,
    end: Math.min(1440, Math.ceil(Math.max(end, ...minutes.map((minute) => minute + 1)) / 60) * 60),
  };
}

export function deadlineMarkerLayout(items, start, end, pixelsPerMinute) {
  const byMinute = new Map();
  for (const item of items.filter(hasDueTime)) {
    if (item.due_minute < start || item.due_minute >= end) continue;
    if (!byMinute.has(item.due_minute)) byMinute.set(item.due_minute, []);
    byMinute.get(item.due_minute).push(item);
  }
  const height = 24;
  const gridHeight = (end - start) * pixelsPerMinute;
  const markers = [...byMinute].sort(([a], [b]) => a - b).map(([minute, records]) => {
    const top = (minute - start) * pixelsPerMinute;
    return { minute, items: records, top, labelTop: Math.max(0, Math.min(top - height, gridHeight - height)), height };
  });
  // Nearby labels share horizontal lanes; their deadline lines stay at the exact minute.
  let cluster = [];
  let clusterEnd = -Infinity;
  const finishCluster = () => cluster.forEach((marker, lane) => Object.assign(marker, { lane, lanes: cluster.length }));
  for (const marker of markers) {
    if (marker.labelTop >= clusterEnd) { finishCluster(); cluster = []; }
    cluster.push(marker);
    clusterEnd = marker.labelTop + height;
  }
  finishCluster();
  return markers;
}
