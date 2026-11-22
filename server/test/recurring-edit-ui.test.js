import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('recurring edit prompt offers explicit week/future choices with escaped content and an accessible dialog', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { default: Dialog } = await vite.ssrLoadModule('/src/RecurringEditDialog.jsx');
    const html = renderToStaticMarkup(React.createElement(Dialog, {
      source: { title: '<img src=x>', day: '周一', start_minute: 540, end_minute: 600 },
      patch: { day: '周二', end_minute: 630 }, weekLabel: '11/16–11/22', onApply() {}, onClose() {},
    }));
    assert.match(html, /role="dialog" aria-modal="true"/);
    assert.match(html, /aria-labelledby="recurring-edit-title"/);
    assert.match(html, /只修改本周/);
    assert.match(html, /修改本次及以后/);
    assert.match(html, /周二 09:00–10:30/);
    assert.match(html, /&lt;img src=x&gt;/);
    assert.doesNotMatch(html, /<img /);
    assert.equal((html.match(/<button /g) || []).length, 3);
  } finally { await vite.close(); }
});
