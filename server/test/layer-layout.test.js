import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDayEvents, normalizeLayerView, readLayerView, toggleVisibleLayer, selectEditingLayer, fillBackground } from '../../src/layer-layout.mjs';

const event = (id, start, end, layer = 'actual') => ({ id, start_minute: start, end_minute: end, layer });
const horizontalOverlap = (a, b) => a.column / a.columns < (b.column + b.span) / b.columns && b.column / b.columns < (a.column + a.span) / a.columns;

test('overlapping layers share columns; touching endpoints and hidden events use full width', () => {
  const input = [event('fixed',540,600,'fixed'),event('actual',570,630),event('next',630,660)];
  const original = JSON.stringify(input);
  const rows = layoutDayEvents(input);
  assert.equal(rows[0].columns,2); assert.equal(rows[1].columns,2);
  assert.notEqual(rows[0].column,rows[1].column);
  assert.equal(rows[2].columns,1);
  assert.equal(layoutDayEvents([input[0]])[0].columns,1);
  assert.equal(JSON.stringify(input),original);
  assert.deepEqual(layoutDayEvents([...input].reverse()),rows);
});

test('nested, chained and same-start conflicts never cover each other, including short events', () => {
  const items = [event('long',0,1440,'fixed'),event('a',540,600,'flex'),event('b',540,545,'once'),event('c',545,610),event('d',600,605),event('e',610,620)];
  const rows = layoutDayEvents(items);
  assert.equal(rows.length,items.length);
  for (const row of rows) {
    assert.ok(row.column >= 0 && row.span >= 1 && row.column + row.span <= row.columns);
    for (const other of rows) {
      if (row === other || row.start >= other.end || other.start >= row.end) continue;
      assert.equal(horizontalOverlap(row,other),false,`${row.event.id} covers ${other.event.id}`);
    }
  }
  assert.equal(layoutDayEvents([event('a',540,600),event('b',540,600),event('c',540,600)])[0].columns,3);
  assert.deepEqual(layoutDayEvents([{...event('all',0,1440),all_day:1},{...event('due',0,1440),deadline_kind:'hw'},event('invalid',90,0)]),[]);
});

test('four independent visibility preferences persist and maintain a visible editing target', () => {
  let view = readLayerView({getItem:()=>null});
  assert.deepEqual(view.visible,['fixed','flex','once','actual']);
  view = toggleVisibleLayer(view,'actual');
  assert.equal(view.active,'fixed'); assert.equal(view.visible.includes('actual'),false);
  assert.deepEqual(readLayerView({getItem:()=>JSON.stringify(view)}),view);
  for (const id of [...view.visible]) view = toggleVisibleLayer(view,id);
  assert.deepEqual(view.visible,[]);
  view = selectEditingLayer(view,'once');
  assert.deepEqual(view,{visible:['once'],active:'once'});
  assert.deepEqual(normalizeLayerView({visible:['unknown','once','once'],active:'bad'}),view);
  assert.equal(readLayerView({getItem:()=>'{bad'}).visible.length,4);
  assert.equal(readLayerView({getItem:()=>{throw Error('blocked');}}).visible.length,4);
});

test('simultaneous layer fills are all visible without changing their stored category', () => {
  const fills=[{cat:'a'},{cat:'b'}];
  const color=(id)=>id === 'a'?'#123456':'#abcdef';
  assert.equal(fillBackground([],color),undefined);
  assert.equal(fillBackground(fills.slice(0,1),color),'#12345627');
  assert.equal(fillBackground(fills,color),'linear-gradient(to right, #12345627 0% 50%, #abcdef27 50% 100%)');
});
