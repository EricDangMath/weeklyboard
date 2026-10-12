import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitTimelineScale, gridPixelsPerMinute, pointerMinute, readZoomPreference, MIN_TIMELINE_WIDTH } from '../../src/timeline-zoom.mjs';
import { copyTarget } from '../../src/event-copy.mjs';

test('fit scale keeps the entire week inside desktop and mobile viewports, including extended hours', () => {
  for (const [width, height, contentHeight] of [[1440, 700, 1250], [986, 808, 1416], [390, 700, 1810], [320, 460, 1500]]) {
    const minimumWidth = width < 760 ? 640 : MIN_TIMELINE_WIDTH;
    const scale = fitTimelineScale(width, height, contentHeight, minimumWidth);
    const logicalWidth = Math.max(minimumWidth, (width - 8) / scale);
    assert.ok(logicalWidth * scale <= width);
    assert.ok(contentHeight * scale <= height);
    assert.ok(scale > 0 && scale <= 1);
  }
});

test('scaled drop, copy and resize coordinates preserve exact minute positions and durations', () => {
  const range = { start: 360, end: 1380 }, source = { day: '周一', start_minute: 540, end_minute: 600 };
  for (const scale of [0.25, 0.5, 0.73, 1, 1.5]) {
    const rect = { top: 80, height: 1224 * scale };
    const ppm = gridPixelsPerMinute(rect, range);
    assert.equal(pointerMinute(rect.top + (780 - range.start) * ppm, rect, range), 780);
    const copy = copyTarget(source, '周三', pointerMinute(rect.top + (780 - range.start) * ppm, rect, range), range);
    assert.deepEqual(copy, { day: '周三', start_minute: 780, end_minute: 840 });
    assert.equal(Math.round((36 * scale) / ppm / 10) * 10, 30);
  }
});

test('saved zoom settings recover from invalid storage and retain a chosen preview mode', () => {
  assert.deepEqual(readZoomPreference({ getItem: () => '{broken' }), { percent: 100, fit: false });
  assert.deepEqual(readZoomPreference({ getItem: () => JSON.stringify({ percent: 50, fit: true }) }), { percent: 50, fit: true });
  assert.deepEqual(readZoomPreference({ getItem: () => JSON.stringify({ percent: -100, fit: false }) }), { percent: 25, fit: false });
});
