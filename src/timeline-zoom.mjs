export const ZOOM_KEY = 'wb-timeline-zoom-v1';
export const MIN_ZOOM = 25;
export const MAX_ZOOM = 150;
export const MIN_TIMELINE_WIDTH = 1024;

export function clampZoom(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(number / 5) * 5)) : 100;
}

export function readZoomPreference(storage) {
  try {
    const value = JSON.parse(storage?.getItem(ZOOM_KEY));
    return { percent: clampZoom(value?.percent ?? 100), fit: value?.fit === true };
  } catch { return { percent: 100, fit: false }; }
}

export function fitTimelineScale(width, height, contentHeight, minimumWidth = MIN_TIMELINE_WIDTH) {
  if (!(width > 0 && height > 0 && contentHeight > 0)) return 1;
  return Math.max(0.01, Math.min(1, (width - 12) / minimumWidth, (height - 12) / contentHeight));
}

export function gridPixelsPerMinute(rect, range, fallback = 1.2) {
  const scale = rect.height / (range.end - range.start);
  return Number.isFinite(scale) && scale > 0 ? scale : fallback;
}

export function pointerMinute(clientY, rect, range, step = 10) {
  return range.start + Math.round((clientY - rect.top) / gridPixelsPerMinute(rect, range) / step) * step;
}
