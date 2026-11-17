import React, { useState } from 'react';
import { BookOpen, FilePenLine, ExternalLink, Bell, X } from 'lucide-react';
import { deadlineMarkerLayout, hasDueTime } from './deadline-layout.mjs';
import './deadlines.css';

export const dueLabel = (item) => hasDueTime(item) ? `${String(Math.floor(item.due_minute / 60)).padStart(2, '0')}:${String(item.due_minute % 60).padStart(2, '0')} 截止` : '当日截止';
const label = (item) => item.kind === 'exam' ? '考试' : '作业';
const safeLink = (value) => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.pathname.includes('/feeds/calendars/') ? url.href : null; } catch { return null; } };

export function DeadlineList({ items, onOpen, onToggle, onRemove, empty = '本周暂无截止提醒' }) {
  if (!items?.length) return <p className="deadline-empty">{empty}</p>;
  return <ul className="deadline-records">{items.map((item) => <li className={`deadline-record ${item.completed ? 'is-complete' : ''}`} key={item.id}>
    <input type="checkbox" checked={Boolean(item.completed)} aria-label={`${item.completed ? '取消完成' : '完成'}提醒：${item.text}`} onChange={() => onToggle(item)} />
    <button className="deadline-record-content" onClick={() => onOpen(item)}><span className={`deadline-kind ${item.kind}`}>{label(item)}</span><strong>{item.text}</strong><span>{item.date || item.day} · {dueLabel(item)}</span>{item.course && <small>{item.course}</small>}</button>
    {!item.subscription_id && onRemove && <button className="deadline-remove" title="删除提醒" aria-label={`删除截止提醒 ${item.text}`} onClick={() => onRemove(item)}><X size={14} /></button>}
  </li>)}</ul>;
}

export function DeadlineBadge({ item, onOpen }) {
  const Icon = item.kind === 'exam' ? FilePenLine : BookOpen;
  return <button className={`deadline-badge ${item.kind} ${item.completed ? 'is-complete' : ''}`} title={`${label(item)} · ${item.text}\n${dueLabel(item)}${item.course ? `\n${item.course}` : ''}`} onClick={() => onOpen(item)}><Icon size={12} /><span>{item.text}</span>{Number.isInteger(item.due_minute) && <time>{dueLabel(item).replace(' 截止', '')}</time>}</button>;
}

export function DeadlineModal({ item, onClose, onToggle, onKind }) {
  const link = safeLink(item.url);
  return <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal-card deadline-modal" role="dialog" aria-modal="true" aria-labelledby="deadline-title">
    <div className="deadline-modal-heading"><span className={`deadline-kind ${item.kind}`}>{label(item)}</span><button autoFocus className="icon-btn" title="关闭" aria-label="关闭提醒详情" onClick={onClose}><X size={18} /></button></div>
    <h3 id="deadline-title">{item.text}</h3>
    <p className="deadline-due">{item.date || item.day} · {dueLabel(item)}</p>
    {item.course && <p className="deadline-course">{item.course}</p>}
    {item.timezone && <span className="deadline-zone">{item.timezone}</span>}
    {item.description && <div className="deadline-description">{item.description}</div>}
    <div className="deadline-modal-controls"><label>提醒类型<select aria-label="提醒类型" value={item.kind} onChange={(e) => onKind(item, e.target.value)}><option value="hw">作业</option><option value="exam">考试</option></select></label><label className="check-row"><input type="checkbox" checked={Boolean(item.completed)} onChange={() => onToggle(item)} />已完成</label></div>
    <footer className="deadline-modal-footer">{item.subscription_name && <span>{item.subscription_name}</span>}{link && <a className="paper-btn" href={link} target="_blank" rel="noopener noreferrer">打开原始内容<ExternalLink size={14} /></a>}</footer>
  </section></div>;
}

export function DeadlineTimeMarkers({ items, start, end, pixelsPerMinute, onOpen }) {
  const [expandedMinute, setExpandedMinute] = useState(null);
  const markers = deadlineMarkerLayout(items, start, end, pixelsPerMinute);
  return <div className="deadline-time-layer" onDoubleClick={(event) => event.stopPropagation()}>
    {markers.map((marker) => {
      const first = marker.items[0];
      const complete = marker.items.every((item) => item.completed);
      const multiple = marker.items.length > 1;
      const expanded = multiple && expandedMinute === marker.minute;
      const title = marker.items.map((item) => `${label(item)} · ${item.text}`).join('\n');
      return <div key={marker.minute} className={`deadline-time-marker ${first.kind} ${complete ? 'is-complete' : ''}`} data-due-minute={marker.minute} style={{ top: marker.top }}>
        <span className="deadline-time-line" />
        <button type="button" className={`deadline-time-chip ${marker.lanes > 1 ? 'is-crowded' : ''}`} title={`${dueLabel(first)}\n${title}`} aria-label={`${first.day} ${dueLabel(first)}：${multiple ? `${marker.items.length} 项提醒` : first.text}`}
          aria-expanded={multiple ? expanded : undefined} style={{ top: marker.labelTop - marker.top, left: `${marker.lane / marker.lanes * 100}%`, width: `${100 / marker.lanes}%` }}
          onClick={(event) => { event.stopPropagation(); if (multiple) setExpandedMinute(expanded ? null : marker.minute); else onOpen(first); }}>
          <Bell size={12} /><time>{dueLabel(first).replace(' 截止', '')}</time><span>{multiple ? `${marker.items.length} 项截止` : first.text}</span>
        </button>
        {expanded && <div className="deadline-time-popover" role="group" aria-label={`${dueLabel(first)}的提醒`} style={{ top: marker.labelTop - marker.top + marker.height }}>
          <div className="deadline-time-popover-heading"><strong>{dueLabel(first)}</strong><button type="button" title="收起提醒" aria-label="收起同一时间的提醒" onClick={() => setExpandedMinute(null)}><X size={14} /></button></div>
          {marker.items.map((item) => <DeadlineBadge key={item.id} item={item} onOpen={onOpen} />)}
        </div>}
      </div>;
    })}
  </div>;
}
