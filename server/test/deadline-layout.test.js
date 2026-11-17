import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlineTimeRange, deadlineMarkerLayout } from '../../src/deadline-layout.mjs';

test('deadline markers use exact minutes, not rounded schedule slots or invented work duration', () => {
  const items = [{ id:'a', due_minute:840 }, { id:'b', due_minute:853 }, { id:'all-day', due_minute:null }];
  const range = deadlineTimeRange(items);
  assert.deepEqual(range, { start:360, end:1380 });
  const markers = deadlineMarkerLayout(items, range.start, range.end, 1.2);
  assert.equal(markers.length, 2);
  assert.equal(markers[0].top, 576);
  assert.ok(Math.abs(markers[1].top - 591.6) < 0.00001);
  assert.notEqual(markers[0].lane, markers[1].lane);
  assert.equal(markers[0].lanes, 2);
  assert.deepEqual(items[0], { id:'a', due_minute:840 });
});

test('midnight and late-night deadlines extend the shared time grid; date-only reminders do not', () => {
  assert.deepEqual(deadlineTimeRange([{due_minute:null},{due_minute:-1},{due_minute:1440},{due_minute:'840'}]), {start:360,end:1380});
  const range = deadlineTimeRange([{due_minute:0},{due_minute:1439}]);
  assert.deepEqual(range, {start:0,end:1440});
  const markers = deadlineMarkerLayout([{due_minute:0},{due_minute:1439}],0,1440,1.2);
  assert.equal(markers[0].top,0);
  assert.equal(markers[0].labelTop,0);
  assert.ok(Math.abs(markers[1].top - 1726.8) < 0.00001);
  assert.ok(markers.every((marker) => marker.labelTop >= 0 && marker.labelTop + marker.height <= 1728));
  assert.deepEqual(deadlineTimeRange([{due_minute:1380}]), {start:360,end:1440});
});

test('coincident deadlines share one marker and retain all records and current completion', () => {
  const items = [{id:'a',due_minute:840,completed:true},{id:'b',due_minute:840,completed:false},{id:'c',due_minute:960}];
  const markers = deadlineMarkerLayout(items,360,1380,1.2);
  assert.equal(markers.length,2);
  assert.deepEqual(markers[0].items,items.slice(0,2));
  assert.equal(markers[0].lanes,1);
  assert.equal(markers[1].lanes,1);
  assert.deepEqual(deadlineMarkerLayout([],360,1380,1.2),[]);
});
