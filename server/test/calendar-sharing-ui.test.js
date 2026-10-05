import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('publish is opt-in and copy handles coexist with resize and use noninteractive previews', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { default: CalendarPublish } = await vite.ssrLoadModule('/src/CalendarPublish.jsx');
    const { default: EventCopyHandle, EventCopyPreview } = await vite.ssrLoadModule('/src/EventCopy.jsx');
    const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
    const layers = ['fixed', 'flex', 'once', 'actual'].map((id) => ({ id, label: id }));
    const publish = render(CalendarPublish, { layers, api: 'http://127.0.0.1:8787/api', call() {} });
    assert.match(publish, /开启并生成链接/);
    assert.doesNotMatch(publish, /calendar\/feeds\//);
    assert.match(publish, /aria-labelledby="publish-title"/);
    const source = { id: 1, title: '<test>', day: '周一', start_minute: 540, end_minute: 600, layer: 'once', cat: 'class', locked: 1 };
    const handle = render(EventCopyHandle, { event: source });
    assert.match(handle, /aria-label="复制 &lt;test&gt;"/);
    assert.match(handle, /draggable="false"/);
    const preview = render(EventCopyPreview, { preview: source, day: '周一', range: { start: 480, end: 1080 }, pixelsPerMinute: 1.2 });
    assert.match(preview, /top:72px;height:72px/);
    assert.doesNotMatch(preview, /<button/);
    assert.equal(render(EventCopyPreview, { preview: source, day: '周二' }), '');
    const { Timeline } = await vite.ssrLoadModule('/src/main.jsx');
    const timeline = render(Timeline, { onCopy() {}, visibleLayers: ['once'], timeRange: { start: 480, end: 1080 }, weekStart: new Date(2026, 9, 5), events: [source], fills: [], currentWeekKey: '2026-W41', activeLayer: 'once', activeCat: 'class', nights: [], deadlines: [] });
    assert.match(timeline, /event-copy-handle/);
    assert.match(timeline, /event-resize/);
    assert.equal((timeline.match(/class="day-grid" data-day=/g) || []).length, 7);
  } finally { await vite.close(); }
});
