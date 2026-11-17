import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { summarizePomodoros } from '../pomodoro.js';

test('pomodoro rendering has an accessible switch, exact checkboxes and multi-cycle progress', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { PomodoroPanel, PomodoroSwitch, Progress } = await vite.ssrLoadModule('/src/Pomodoro.jsx');
    const data = summarizePomodoros([{ id: 1, title: 'Math', estimate_minutes: 60 }], [
      { id: 1, title: 'Math', task_id: 1, category: 'study', day: '周一', start_minute: 540, end_minute: 600, layer: 'flex' },
    ]);
    const controller = { data, enabled: true, pending: false, error: '', toggle() {}, check() {}, plan() {} };
    const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
    let html = render(PomodoroPanel, { controller, categories: [] });
    assert.equal((html.match(/role="checkbox"/g) || []).length, 2);
    assert.ok(html.includes('Math 周一 第 2 个番茄钟'));
    assert.ok(!html.includes('第 3 个番茄钟'));
    assert.ok(!html.includes('0个番茄钟'));
    assert.ok(html.includes('type="number"'));
    assert.ok(html.includes('step="1"'));
    assert.equal(render(PomodoroPanel, { controller: { ...controller, enabled: false }, categories: [] }), '');
    assert.match(render(PomodoroSwitch, { controller }), /role="switch"/);
    html = render(Progress, { percent: 150, label: 'Math' });
    assert.match(html, /aria-valuenow="150"/);
    assert.match(html, /width:50%/);
    assert.match(html, /#DBB355/);
    assert.match(render(Progress, { percent: 200, label: 'Math' }), /width:100%/);
  } finally { await vite.close(); }
});
