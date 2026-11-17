import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('deadline list, badge and detail share kind, due time and completion without rendering unsafe HTML', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { DeadlineList, DeadlineBadge, DeadlineModal, DeadlineTimeMarkers } = await vite.ssrLoadModule('/src/Deadlines.jsx');
    const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
    const item = { id:'calendar-deadline-1',event_id:1,subscription_id:1,text:'Test <script>alert(1)</script>',kind:'exam',date:'2026-09-14',due_minute:1439,description:'<img src=x onerror=alert(1)>',course:'Science',completed:true,url:'javascript:alert(1)' };
    const list = render(DeadlineList,{items:[item],onOpen(){},onToggle(){},onRemove(){}});
    assert.match(list,/is-complete/); assert.match(list,/checked=""/); assert.match(list,/23:59 截止/); assert.match(list,/考试/);
    assert.doesNotMatch(list,/删除截止提醒/); assert.doesNotMatch(list,/<script>/);
    const badge = render(DeadlineBadge,{item,onOpen(){}});
    assert.match(badge,/is-complete/); assert.match(badge,/23:59/);
    const modal = render(DeadlineModal,{item,onClose(){},onToggle(){},onKind(){}});
    assert.doesNotMatch(modal,/href="javascript/); assert.doesNotMatch(modal,/<img /); assert.match(modal,/Science/);
    assert.match(render(DeadlineBadge,{item:{...item,due_minute:null},onOpen(){}}),/当日截止/);
    assert.match(render(DeadlineModal,{item:{...item,url:'https://school.instructure.com/courses/1/assignments/2'},onClose(){},onToggle(){},onKind(){}}),/rel="noopener noreferrer"/);
    const timed = {...item,day:'周二',due_minute:840};
    const marker = render(DeadlineTimeMarkers,{items:[timed],start:360,end:1380,pixelsPerMinute:1.2,onOpen(){}});
    assert.match(marker,/data-due-minute="840" style="top:576px"/);
    assert.match(marker,/周二 14:00 截止/); assert.match(marker,/is-complete/);
    assert.doesNotMatch(marker,/<script>|class="event"|draggable/);
    const unchecked = render(DeadlineTimeMarkers,{items:[{...timed,completed:false}],start:360,end:1380,pixelsPerMinute:1.2,onOpen(){}});
    assert.doesNotMatch(unchecked,/is-complete/);
    const grouped = render(DeadlineTimeMarkers,{items:[timed,{...timed,id:'second',completed:false}],start:360,end:1380,pixelsPerMinute:1.2,onOpen(){}});
    assert.match(grouped,/2 项截止/); assert.match(grouped,/aria-expanded="false"/); assert.doesNotMatch(grouped,/is-complete/);
    assert.doesNotMatch(render(DeadlineTimeMarkers,{items:[{...timed,due_minute:null}],start:360,end:1380,pixelsPerMinute:1.2,onOpen(){}}),/data-due-minute/);
  } finally { await vite.close(); }
});
