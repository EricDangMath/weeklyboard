import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyTarget, eventCopyPayload } from '../../src/event-copy.mjs';

test('drag copy snaps to the grid, preserves duration and stays within the visible day', () => {
  const source = { day: '周一', start_minute: 545, end_minute: 600 };
  const range = { start: 360, end: 1440 };
  assert.deepEqual(copyTarget(source, '周二', 608, range), { day: '周二', start_minute: 610, end_minute: 665 });
  assert.deepEqual(copyTarget(source, '周日', 1440, range), { day: '周日', start_minute: 1385, end_minute: 1440 });
  assert.equal(copyTarget(source, null, 600, range), null);
  assert.equal(copyTarget(source, '周二', NaN, range), null);
  assert.deepEqual(copyTarget(source, '周二', 0, range), { day: '周二', start_minute: 360, end_minute: 415 });
});

test('copy payload keeps event content and task linkage without external identities or repeat/completion', () => {
  const original = { id: 7, title: 'A', description: 'B', category: 'class', layer: 'once', task_id: 3, locked: 1, repeat_rule: 'weekly', subscription_id: 4, external_key: 'private', deadline_completed: 1 };
  const before = structuredClone(original);
  const copy = eventCopyPayload(original, { day: '周二', start_minute: 600, end_minute: 660 }, '2026-W41');
  assert.deepEqual(original, before);
  assert.equal(copy.title, 'A'); assert.equal(copy.description, 'B'); assert.equal(copy.task_id, 3);
  assert.equal(copy.layer, 'once'); assert.equal(copy.week_key, '2026-W41');
  assert.equal(copy.locked, false); assert.equal(copy.repeat, false);
  for (const key of ['id', 'subscription_id', 'external_key', 'deadline_completed', 'repeat_rule']) assert.equal(copy[key], undefined);
});
