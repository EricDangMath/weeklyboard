import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicSchedule } from '../scheduler.js';

test('deterministic scheduler respects fixed events and is repeatable', () => {
  const input = {
    tasks: [
      { id: 1, title: 'High priority', estimate_minutes: 60, priority: 5 },
      { id: 2, title: 'Lower priority', estimate_minutes: 30, priority: 2 },
    ],
    fixed: [{ day: '周一', start_minute: 540, end_minute: 600 }],
    windows: { 周一: [540, 720] },
  };
  const first = deterministicSchedule(input);
  const second = deterministicSchedule(input);
  assert.deepEqual(first, second);
  assert.equal(first.blocks[0].title, 'High priority');
  assert.ok(first.blocks.every(block => !block.day || !(block.day === '周一' && block.start_minute < 600 && block.end_minute > 540)));
  assert.equal(first.warnings.length, 0);
});

test('scheduler reports work that cannot fit', () => {
  const result = deterministicSchedule({ tasks: [{ title: 'Too large', estimate_minutes: 200 }], windows: { 周一: [540, 600], 周二: [540, 540], 周三: [540, 540], 周四: [540, 540], 周五: [540, 540], 周六: [540, 540], 周日: [540, 540] } });
  assert.ok(result.warnings.some(message => message.includes('Too large')));
});
