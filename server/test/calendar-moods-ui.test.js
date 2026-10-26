import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { MOODS } from '../../src/mood-data.mjs';

test('calendar moods retain reference faces, accessible toggles and independent date navigation', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { MoodFace, MoodPalette } = await vite.ssrLoadModule('/src/CalendarMoods.jsx');
    for (const mood of MOODS) {
      const face = renderToStaticMarkup(React.createElement(MoodFace, { id: mood.id }));
      assert.match(face, /<svg/);
      assert.ok(face.includes(mood.color));
      assert.doesNotMatch(face, /undefined|NaN/);
    }
    const palette = renderToStaticMarkup(React.createElement(MoodPalette, { active: 'calm', disabled: false, onChoose() {}, onPointerDown() {} }));
    assert.equal((palette.match(/<button /g) || []).length, 12);
    assert.equal((palette.match(/aria-pressed="true"/g) || []).length, 1);
    assert.match(palette, /title="取消平静"/);
    const { default: CalendarView } = await vite.ssrLoadModule('/src/CalendarView.jsx');
    const html = renderToStaticMarkup(React.createElement(CalendarView, {
      month: new Date(2026, 9, 1), weekStart: new Date(2026, 9, 19), nights: [], deadlines: [],
      call() {}, setMonth() {}, setWeekStart() {}, close() {},
    }));
    assert.equal((html.match(/aria-label="进入 2026-10-\d{2} 所在周"/g) || []).length, 31);
    assert.equal((html.match(/aria-label="记录 2026-10-\d{2} 的心情"/g) || []).length, 31);
    assert.match(html, /心情趋势/);
    assert.match(html, /正在读取/);
    assert.doesNotMatch(html, /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
  } finally { await vite.close(); }
});
