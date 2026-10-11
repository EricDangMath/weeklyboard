import React from 'react';
import { Copy } from 'lucide-react';
import useEventGesture from './useEventGesture.jsx';
import './event-copy.css';

export default function EventCopyHandle({ event, range, pixelsPerMinute, onPreview, onCopy }) {
  const gesture = useEventGesture();
  return <button type="button" className="event-copy-handle" title="拖拽复制日程" aria-label={`复制 ${event.title}`} draggable={false}
    onPointerDown={(down) => gesture.start(down, { event, mode: 'copy', range, pixelsPerMinute, onPreview, onCommit: onCopy })}
    onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
    onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCopy?.(event, null); }
    }}><Copy size={10} /></button>;
}

export function EventCopyPreview({ preview, day, range, pixelsPerMinute }) {
  if (!preview || preview.day !== day) return null;
  const fmt = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return <div className={`event-copy-preview ${preview.mode === 'move' ? 'event-move-preview' : ''}`} aria-hidden="true" style={{ top: (preview.start_minute - range.start) * pixelsPerMinute, height: (preview.end_minute - preview.start_minute) * pixelsPerMinute }}>
    <strong>{preview.title}</strong><span>{fmt(preview.start_minute)} – {fmt(preview.end_minute)}</span>
  </div>;
}
