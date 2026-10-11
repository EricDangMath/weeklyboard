import React, { useEffect, useRef } from 'react';
import EventCopyHandle from './EventCopy.jsx';
import useEventGesture from './useEventGesture.jsx';
import './event-gesture.css';

const formatTime = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function ResizeHandle({ event, range, interval, pixelsPerMinute, onPreview, onEnd, onOpen }) {
  const cleanup = useRef(null);
  const suppressClickUntil = useRef(0);
  useEffect(() => () => cleanup.current?.(), []);
  const clamp = (end) => Math.max(Number(event.start_minute) + interval, Math.min(range.end, end));
  return <span className="event-resize" role="slider" tabIndex={0} title="调整结束时间"
    aria-label={`调整 ${event.title} 结束时间`} aria-valuemin={Number(event.start_minute) + interval} aria-valuemax={range.end} aria-valuenow={Number(event.end_minute)} aria-valuetext={formatTime(event.end_minute)}
    onClick={(e) => { e.stopPropagation(); if (Date.now() >= suppressClickUntil.current) onOpen(event); }}
    onKeyDown={(e) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') return onOpen(event);
      const end = clamp(e.key === 'Home' ? Number(event.start_minute) + interval : e.key === 'End' ? range.end : Number(event.end_minute) + (e.key === 'ArrowUp' ? -interval : interval));
      onPreview?.(event.id, end); onEnd?.(event.id, end);
    }}
    onPointerDown={(down) => {
      if (down.button !== 0) return;
      down.preventDefault(); down.stopPropagation(); cleanup.current?.();
      const handle = down.currentTarget, initialEnd = Number(event.end_minute), initialY = down.clientY;
      let currentEnd = initialEnd, moved = false;
      const move = (e) => {
        if (e.pointerId !== down.pointerId) return;
        moved ||= Math.abs(e.clientY - initialY) >= 5;
        if (!moved) return;
        currentEnd = clamp(initialEnd + Math.round((e.clientY - initialY) / pixelsPerMinute / interval) * interval);
        onPreview?.(event.id, currentEnd);
      };
      const clear = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', cancel); handle.removeEventListener('lostpointercapture', cancel);
        if (handle.hasPointerCapture?.(down.pointerId)) handle.releasePointerCapture(down.pointerId);
        if (moved) suppressClickUntil.current = Date.now() + 250;
        cleanup.current = null;
      };
      const up = (e) => { if (e.pointerId !== down.pointerId) return; clear(); if (moved && currentEnd !== initialEnd) onEnd?.(event.id, currentEnd); };
      const cancel = () => { clear(); if (moved) onPreview?.(event.id, initialEnd); };
      handle.setPointerCapture(down.pointerId); handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', cancel); handle.addEventListener('lostpointercapture', cancel); cleanup.current = clear;
    }} />;
}

export default function CalendarEvent({ event, height, columns, style, layerLabel, range, interval, pixelsPerMinute, onOpen, onMove, onCopy, onPreview, onResizePreview, onResizeEnd }) {
  const gesture = useEventGesture();
  return <article className={`event ${columns > 1 ? 'event-split' : ''} ${height < 44 ? 'event-compact' : ''} ${height < 18 ? 'event-short' : ''}`}
    data-event-id={event.id} data-layer={event.layer} role="button" tabIndex={0}
    title={`${event.title} · ${layerLabel} · ${formatTime(event.start_minute)}–${formatTime(event.end_minute)}`}
    aria-label={`${event.title}，${formatTime(event.start_minute)} 至 ${formatTime(event.end_minute)}`} style={style}
    onClick={(e) => { e.stopPropagation(); if (!gesture.shouldIgnoreClick()) onOpen(event); }}
    onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(event); } }}
    onPointerDown={(down) => {
      if (event.locked || down.target.closest('.event-copy-handle, .event-resize')) return;
      gesture.start(down, { event, mode: 'move', range, pixelsPerMinute, onPreview, onCommit: onMove });
    }}
    draggable={false} onDragStart={(e) => e.preventDefault()}>
    <strong className="event-title">{event.title}</strong><span className="event-layer-label">{layerLabel}</span>
    <span className="event-time">{formatTime(event.start_minute)} – {formatTime(event.end_minute)}</span>
    {event.description && <span className="event-desc">{event.description}</span>}
    {onCopy && <EventCopyHandle event={event} range={range} pixelsPerMinute={pixelsPerMinute} onCopy={onCopy} onPreview={onPreview} />}
    {!event.locked && <ResizeHandle event={event} range={range} interval={interval} pixelsPerMinute={pixelsPerMinute} onPreview={onResizePreview} onEnd={onResizeEnd} onOpen={onOpen} />}
  </article>;
}
