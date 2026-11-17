import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MOODS, MOOD_BY_ID, localDateKey, moodDays } from './mood-data.mjs';

const MOUTHS = {
  happy: 'M9 17 Q14 22 19 17', great: 'M8 16 Q14 24 20 16', excited: 'M8 16 Q10 21 14 17 Q18 21 20 16',
  calm: 'M10 18 H18', tired: 'M9 19 Q14 15.5 19 19', sad: 'M9 19 Q14 14 19 19', angry: 'M9 19.5 L14 16.5 L19 19.5',
  sick: 'M9 18 q2.5 -3.5 5 0 q2.5 3.5 5 0', phone: 'M10.5 18.5 q3.5 2.5 7 0',
  busy: 'M9 18 L11.5 16.6 L14 18 L16.5 16.6 L19 18', sleepy: 'M12 18 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0',
  philo: 'M9 18 q2.5 -2.5 5 0 q2.5 2.5 5 0',
};
const EYES = {
  tired: 'M8 11.5 h4 M16 11.5 h4', angry: 'M8 10 l4.5 2.5 M20 10 l-4.5 2.5',
  great: 'M10 7.5 v5 M7.5 10 h5 M18 7.5 v5 M15.5 10 h5', sick: 'M8 10.5 q2 -2 4 0 M16 10.5 q2 -2 4 0',
  phone: 'M8 12.5 q2 1.8 4 0 M16 12.5 q2 1.8 4 0', sleepy: 'M8 11 q2 2.2 4 0 M16 11 q2 2.2 4 0',
};

// The hand-drawn faces follow the supplied source; no external image dependency.
export function MoodFace({ id, size = 28 }) {
  const mood = MOOD_BY_ID[id];
  if (!mood) return null;
  return <svg viewBox="0 0 28 28" width={size} height={size} className="mood-face" aria-hidden="true" style={{ color: mood.color }}>
    <path d="M14 2.6 C21 2.2 25.8 7.5 25.4 14.2 C25 21.5 20 25.6 13.6 25.4 C7 25.2 2.4 20.5 2.7 13.8 C3 7 7.5 3 14 2.6Z" fill={`${mood.color}22`} stroke="currentColor" strokeWidth="2" />
    {EYES[id] ? <path d={EYES[id]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : <>
      <circle cx="10" cy={id === 'philo' ? 12.2 : 11} r={id === 'busy' ? 2.1 : 1.5} fill="currentColor" />
      <circle cx="18" cy={id === 'philo' ? 12.2 : 11} r={id === 'busy' ? 2.1 : 1.5} fill="currentColor" />
      {id === 'philo' && <path d="M7 8.6 q2.6 -1.7 5.2 0 M15.6 9.2 q2.6 1.3 5.2 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </>}
    <path d={MOUTHS[id]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

export function MoodPalette({ active, disabled, onChoose, onPointerDown }) {
  return <div className="mood-grid caw-today-grid" aria-label="选择心情">
    {MOODS.map((mood) => <button key={mood.id} type="button" className={`mood-sticker caw-tap${active === mood.id ? ' active' : ''}`}
      draggable={false} disabled={disabled} aria-pressed={active === mood.id}
      title={active === mood.id ? `取消${mood.label}` : mood.label}
      onClick={() => onChoose(mood.id)} onPointerDown={(event) => onPointerDown(event, mood.id)}>
      <MoodFace id={mood.id} /><span className="mood-label">{mood.label}</span>
    </button>)}
  </div>;
}

export function useMoodDrag({ disabled, onDrop }) {
  const [preview, setPreview] = useState(null);
  const [target, setTarget] = useState(null);
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const drop = useRef(onDrop);
  drop.current = onDrop;
  useEffect(() => {
    const targetAt = (event) => document.elementFromPoint(event.clientX, event.clientY)?.closest('.mood-calendar [data-date]')?.dataset.date || null;
    const move = (event) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
      current.active = true;
      suppressClick.current = true;
      if (event.cancelable) event.preventDefault();
      setPreview({ ...current, x: event.clientX, y: event.clientY });
      setTarget(targetAt(event));
    };
    const end = (event) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      gesture.current = null;
      setPreview(null);
      setTarget(null);
      if (event.type === 'pointercancel') suppressClick.current = false;
      if (current.active && event.type === 'pointerup') {
        const date = targetAt(event);
        if (date) drop.current(date, current.mood, current.fromDate);
      }
    };
    const cancel = () => { gesture.current = null; suppressClick.current = false; setPreview(null); setTarget(null); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', cancel);
    };
  }, []);
  return {
    preview, target,
    start: (event, mood, fromDate) => {
      if (disabled || event.button !== 0) return;
      suppressClick.current = false;
      gesture.current = { mood, fromDate, x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    resetClick: () => { suppressClick.current = false; },
    clickCapture: (event) => {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
    },
  };
}

export function useCalendarMoods({ call, month, today, notify }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const generation = useRef(0);
  const writing = useRef(false);
  const reading = useRef(true);
  const year = month.getFullYear(), monthIndex = month.getMonth();
  const reload = useCallback(async () => {
    const current = ++generation.current;
    reading.current = true;
    setLoading(true);
    setError('');
    try {
      const first = localDateKey(new Date(year, monthIndex, 1));
      const last = localDateKey(new Date(year, monthIndex + 1, 0));
      const recent = moodDays(today);
      const ranges = [[first, last], [recent[0], today]];
      const batches = await Promise.all(ranges.map(([from, to]) => call(`/calendar/moods?from=${from}&to=${to}`)));
      if (generation.current !== current) return;
      setRecords([...new Map(batches.flat().map((record) => [record.date, record])).values()]);
      setReady(true);
    } catch (failure) {
      if (generation.current !== current) return;
      setReady(false);
      setError(`心情加载失败：${failure.message}`);
    } finally {
      if (generation.current === current) { reading.current = false; setLoading(false); }
    }
  }, [call, year, monthIndex, today]);
  useEffect(() => { reload(); return () => { generation.current += 1; }; }, [reload]);

  const change = async (date, mood, fromDate) => {
    if (writing.current || reading.current || !ready) return false;
    writing.current = true;
    setBusy(true);
    setError('');
    setStatus('正在保存…');
    try {
      if (mood) {
        const saved = await call(`/calendar/moods/${date}`, { method: 'PUT', body: JSON.stringify({ mood, ...(fromDate ? { from_date: fromDate } : {}) }) });
        setRecords((items) => [...items.filter((item) => item.date !== date && (!fromDate || item.date !== fromDate)), saved]);
      } else {
        await call(`/calendar/moods/${date}`, { method: 'DELETE' });
        setRecords((items) => items.filter((item) => item.date !== date));
      }
      setStatus(mood ? '已保存' : '已取消记录');
      return true;
    } catch (failure) {
      setStatus('');
      setError(`保存失败：${failure.message}`);
      notify?.(`心情没有保存成功：${failure.message}`);
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  return { records, loading, busy, error, status, reload, change, disabled: loading || busy || !ready };
}
