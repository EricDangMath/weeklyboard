import { useEffect, useRef } from 'react';
import { copyTarget } from './event-copy.mjs';

const formatTime = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export default function useEventGesture() {
  const cleanup = useRef(null);
  const suppressClickUntil = useRef(0);
  useEffect(() => () => cleanup.current?.(), []);

  const start = (down, { event, mode, range, pixelsPerMinute, onPreview, onCommit }) => {
    if (down.button !== 0 || !onCommit) return;
    const handle = down.currentTarget;
    const article = handle.closest('.event');
    const board = handle.closest('.timeline-scroll');
    const origin = handle.closest('.day-grid');
    if (!article || !board || !origin) return;
    cleanup.current?.();
    down.preventDefault(); down.stopPropagation();
    handle.focus({ preventScroll: true });
    const offset = (down.clientY - origin.getBoundingClientRect().top) / pixelsPerMinute - (Number(event.start_minute) - range.start);
    const initial = { x: down.clientX, y: down.clientY };
    let point = initial, moved = false, target = null, frame, ghost = null, previewKey = '';

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
    const showGhost = () => {
      if (ghost) return;
      const style = getComputedStyle(article);
      ghost = document.createElement('div');
      ghost.className = `event-drag-ghost ${mode}`;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = `${Math.max(90, Math.min(160, article.getBoundingClientRect().width))}px`;
      ghost.style.background = style.backgroundColor;
      ghost.style.borderLeftColor = style.borderLeftColor;
      const title = document.createElement('strong');
      title.textContent = event.title;
      const time = document.createElement('span');
      ghost.append(title, time);
      document.body.append(ghost);
      article.classList.add(mode === 'move' ? 'event-moving' : 'event-copy-source');
      document.body.classList.add('event-gesturing');
    };
    const preview = () => {
      target = findTarget();
      const nextKey = target ? `${target.day}:${target.start_minute}` : '';
      if (nextKey !== previewKey) {
        previewKey = nextKey;
        onPreview?.(target ? { ...target, title: event.title, mode, eventId: event.id } : null);
      }
      if (ghost) {
        ghost.style.transform = `translate3d(${Math.max(0, Math.min(window.innerWidth - ghost.offsetWidth - 4, point.x + 14))}px,${Math.max(0, Math.min(window.innerHeight - ghost.offsetHeight - 4, point.y + 14))}px,0)`;
        ghost.style.opacity = target ? '0.95' : '0.6';
        ghost.lastChild.textContent = target ? `${target.day} ${formatTime(target.start_minute)} – ${formatTime(target.end_minute)}` : '移到时间表内';
      }
    };
    const tick = () => {
      if (moved) {
        const rect = board.getBoundingClientRect();
        const speed = (value, min, max) => value < min + 36 ? -8 : value > max - 36 ? 8 : 0;
        if (point.x >= rect.left && point.x <= rect.right && point.y >= Math.max(0, rect.top) && point.y <= Math.min(window.innerHeight, rect.bottom)) {
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
      if (moved) { showGhost(); preview(); }
    };
    const clear = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      handle.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('keydown', key, true);
      if (handle.hasPointerCapture?.(down.pointerId)) handle.releasePointerCapture(down.pointerId);
      ghost?.remove();
      article.classList.remove('event-moving', 'event-copy-source');
      document.body.classList.remove('event-gesturing');
      onPreview?.(null);
      if (moved) suppressClickUntil.current = Date.now() + 250;
      cleanup.current = null;
    };
    const cancel = () => clear();
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    const up = (e) => {
      if (e.pointerId !== down.pointerId) return;
      point = { x: e.clientX, y: e.clientY }; target = findTarget();
      const changed = target && (target.day !== event.day || target.start_minute !== Number(event.start_minute));
      clear();
      if (moved && changed) onCommit(event, target);
    };
    handle.setPointerCapture(down.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
    handle.addEventListener('lostpointercapture', cancel);
    window.addEventListener('keydown', key, true);
    cleanup.current = clear;
    frame = requestAnimationFrame(tick);
  };
  return { start, shouldIgnoreClick: () => Date.now() < suppressClickUntil.current };
}
