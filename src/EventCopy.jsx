import React, { useEffect, useRef } from 'react';
import { Copy } from 'lucide-react';
import { copyTarget } from './event-copy.mjs';
import './event-copy.css';

export default function EventCopyHandle({ event, range, pixelsPerMinute, onPreview, onCopy }) {
  const cleanup = useRef(null);
  useEffect(() => () => cleanup.current?.(), []);
  const start = (down) => {
    if (down.button !== 0 || !onCopy) return;
    down.preventDefault(); down.stopPropagation();
    const handle = down.currentTarget;
    const board = handle.closest('.timeline-scroll');
    const originGrid = handle.closest('.day-grid');
    if (!board || !originGrid) return;
    cleanup.current?.();
    const offset = (down.clientY - originGrid.getBoundingClientRect().top) / pixelsPerMinute - (event.start_minute - range.start);
    const initial = { x: down.clientX, y: down.clientY };
    let point = initial, moved = false, target = null, frame, previewKey = '';
    const findTarget = () => {
      const viewport = board.getBoundingClientRect();
      if (point.x < viewport.left || point.x > viewport.right || point.y < Math.max(0, viewport.top) || point.y > Math.min(window.innerHeight, viewport.bottom)) return null;
      for (const grid of board.querySelectorAll('.day-grid[data-day]')) {
        const rect = grid.getBoundingClientRect();
        if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) {
          return copyTarget(event, grid.dataset.day, range.start + (point.y - rect.top) / pixelsPerMinute - offset, range);
        }
      }
      return null;
    };
    const preview = () => {
      target = findTarget();
      const nextKey = target ? `${target.day}:${target.start_minute}` : '';
      if (nextKey !== previewKey) {
        previewKey = nextKey;
        onPreview(target ? { ...target, title: event.title } : null);
      }
    };
    const tick = () => {
      if (moved) {
        const rect = board.getBoundingClientRect();
        const speed = (value, min, max) => value < min + 36 ? -8 : value > max - 36 ? 8 : 0;
        if (point.x >= rect.left - 20 && point.x <= rect.right + 20) {
          board.scrollLeft += speed(point.x, rect.left, rect.right);
          const dy = speed(point.y, Math.max(0, rect.top), Math.min(window.innerHeight, rect.bottom));
          if (board.scrollHeight > board.clientHeight) board.scrollTop += dy;
          else window.scrollBy(0, dy);
        }
        preview();
      }
      frame = requestAnimationFrame(tick);
    };
    const move = (e) => {
      if (e.pointerId !== down.pointerId) return;
      point = { x: e.clientX, y: e.clientY };
      moved ||= Math.hypot(point.x - initial.x, point.y - initial.y) >= 5;
      if (moved) preview();
    };
    const clear = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      handle.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('keydown', key, true);
      if (handle.hasPointerCapture?.(down.pointerId)) handle.releasePointerCapture(down.pointerId);
      document.body.classList.remove('event-copying'); onPreview(null); cleanup.current = null;
    };
    const cancel = () => clear();
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    const up = (e) => {
      if (e.pointerId !== down.pointerId) return;
      point = { x: e.clientX, y: e.clientY }; target = findTarget();
      const changed = target && (target.day !== event.day || target.start_minute !== Number(event.start_minute));
      clear();
      if (moved && changed) onCopy(event, target);
    };
    handle.setPointerCapture(down.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
    handle.addEventListener('lostpointercapture', cancel);
    window.addEventListener('keydown', key, true);
    document.body.classList.add('event-copying'); cleanup.current = clear;
    frame = requestAnimationFrame(tick);
  };
  return <button type="button" className="event-copy-handle" title="拖拽复制日程" aria-label={`复制 ${event.title}`} draggable={false}
    onPointerDown={start} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
    onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCopy?.(event, null); }
    }}><Copy size={10} /></button>;
}

export function EventCopyPreview({ preview, day, range, pixelsPerMinute }) {
  if (!preview || preview.day !== day) return null;
  const fmt = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return <div className="event-copy-preview" style={{ top: (preview.start_minute - range.start) * pixelsPerMinute, height: (preview.end_minute - preview.start_minute) * pixelsPerMinute }}>
    <strong>{preview.title}</strong><span>{fmt(preview.start_minute)} – {fmt(preview.end_minute)}</span>
  </div>;
}
