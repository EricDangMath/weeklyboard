import React, { useState } from 'react';
import { CalendarX, Trash2 } from 'lucide-react';
import './event-modal.css';

const formatTime = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const parseTime = (value) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };

export default function EventModal({ taskOptions, value, setValue, save, remove, close, days, categories, layers }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const recurring = value.repeat_rule === 'weekly' || (!value.week_key && value.id && !String(value.id).startsWith('plan-'));
  const deleteScope = async (scope) => {
    if (deleting) return;
    setDeleting(true);
    try { await remove(scope); } finally { setDeleting(false); }
  };
  return <div className="modal-mask" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !deleting && close()}>
    <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="event-modal-title">
      <div className="modal-tape" /><h3 id="event-modal-title">{value.id ? '编辑日程' : '新建日程'}</h3>
      <label>标题<input autoFocus value={value.title} onChange={(e) => setValue({ ...value, title: e.target.value })} placeholder="例如：Physics Class" /></label>
      {value.all_day ? <p>全天</p> : <div className="modal-row2"><label>开始<input type="time" value={formatTime(value.start_minute)} onChange={(e) => setValue({ ...value, start_minute: parseTime(e.target.value) })} /></label><label>结束<input type="time" value={formatTime(value.end_minute)} onChange={(e) => setValue({ ...value, end_minute: parseTime(e.target.value) })} /></label></div>}
      {taskOptions?.length > 0 && <label>对应任务<select aria-label="日程对应任务" value={value.task_id || ''} onChange={(e) => setValue({ ...value, task_id: e.target.value ? Number(e.target.value) : null })}><option value="">独立日程</option>{taskOptions.map((task) => <option value={task.task_id} key={task.task_id}>{task.title}{task.project ? ` · ${task.project}` : ''}</option>)}</select></label>}
      <label>日期<select value={value.day} onChange={(e) => setValue({ ...value, day: e.target.value })}>{days.map((day) => <option key={day}>{day}</option>)}</select></label>
      <span className="cat-label" id="event-color-label">颜色</span><div className="cat-picker" role="group" aria-labelledby="event-color-label">{categories.map((cat) => <button type="button" aria-label={cat.label} aria-pressed={value.cat === cat.id} className={`cat-option ${value.cat === cat.id ? 'selected' : ''}`} key={cat.id} title={cat.label} style={{ background: cat.color }} onClick={() => setValue({ ...value, cat: cat.id })} />)}</div>
      <label>图层<select value={value.layer || 'actual'} onChange={(e) => setValue({ ...value, layer: e.target.value })}>{layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.label}</option>)}</select></label>
      <label className="check-row"><input type="checkbox" checked={Boolean(value.repeat ?? (value.repeat_rule === 'weekly'))} onChange={(e) => setValue({ ...value, repeat: e.target.checked })} /><span>每周重复</span><span className="check-hint">勾选后每周同一时间自动出现</span></label>
      <label>备注<textarea rows="2" value={value.description || ''} onChange={(e) => setValue({ ...value, description: e.target.value })} placeholder="可选，例如教室地点、准备事项…" /></label>
      {deleteOpen && <div className="event-delete-options" role="group" aria-label="删除范围">
        <strong>删除这条日程？</strong>
        <div><button className="paper-btn" disabled={deleting} onClick={() => deleteScope('week')}><CalendarX size={16} />只删除本周</button><button className="paper-btn danger" disabled={deleting} onClick={() => deleteScope('all')}><Trash2 size={16} />{recurring ? '删除全部重复' : '删除日程'}</button><button className="text-btn" disabled={deleting} onClick={() => setDeleteOpen(false)}>取消删除</button></div>
      </div>}
      <div className="modal-actions">{value.id && !deleteOpen && <button className="paper-btn danger" disabled={deleting} onClick={() => setDeleteOpen(true)}><Trash2 size={15} />删除</button>}<span className="spacer" /><button className="paper-btn" disabled={deleting} onClick={close}>取消</button><button className="paper-btn primary" disabled={deleting || deleteOpen} onClick={save}>保存</button></div>
    </div>
  </div>;
}
