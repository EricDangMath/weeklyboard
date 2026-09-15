import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('four visible layer checkboxes are separate from the new-event target', async () => {
  const vite = await createServer({ server:{middlewareMode:true,hmr:false,ws:false},appType:'custom' });
  try {
    const { default:LayerControls } = await vite.ssrLoadModule('/src/LayerControls.jsx');
    const layers=[{id:'fixed',label:'每周固定'},{id:'flex',label:'预估'},{id:'once',label:'一次性'},{id:'actual',label:'实际'}];
    const render=(extra={})=>renderToStaticMarkup(React.createElement(LayerControls,{layers,visibleLayers:['fixed','actual'],activeLayer:'actual',onToggle(){},onSelect(){},...extra}));
    const html=render();
    assert.equal((html.match(/type="checkbox"/g)||[]).length,4);
    assert.equal((html.match(/checked=""/g)||[]).length,2);
    assert.match(html,/新增日程图层/);
    assert.equal((html.match(/<option /g)||[]).length,2);
    assert.match(render({visibleLayers:[]}),/disabled=""/);
    assert.doesNotMatch(render({compact:true}),/<select/);
    const { Timeline } = await vite.ssrLoadModule('/src/main.jsx');
    const events = [
      {id:'fixed',title:'Fixed',day:'周一',start_minute:540,end_minute:600,layer:'fixed',cat:'class'},
      {id:'actual',title:'Actual',day:'周一',start_minute:570,end_minute:630,layer:'actual',cat:'study'},
    ];
    const timeline = renderToStaticMarkup(React.createElement(Timeline,{visibleLayers:['fixed','actual'],timeRange:{start:360,end:1380},weekStart:new Date(2026,8,14),events,fills:[],currentWeekKey:'2026-W38',activeLayer:'actual',activeCat:'class',nights:[],deadlines:[]}));
    assert.equal((timeline.match(/width:calc\(50% - 6px\)/g)||[]).length,2);
    assert.match(timeline,/left:calc\(0% \+ 3px\)/);
    assert.match(timeline,/left:calc\(50% \+ 3px\)/);
    assert.match(timeline,/data-layer="actual"/);
  } finally {await vite.close();}
});
