import React, { useEffect, useRef, useState } from 'react';
import { CalendarClock, CalendarDays } from 'lucide-react';
import './recurring-edit.css';

const time = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export default function RecurringEditDialog({ source, patch, weekLabel, onApply, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const card = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const escape = (event) => {
      if (event.key === 'Tab') {
        const buttons = [...(card.current?.querySelectorAll('button:not([disabled])') || [])];
        const first = buttons[0], last = buttons.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!locked.current) close.current();
    };
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('keydown', escape, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  const apply = async (scope) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await onApply(scope); }
    catch (failure) { setError(`保存失败：${failure.message}`); }
    finally { locked.current = false; setBusy(false); }
  };
  const next = { ...source, ...patch };
  return <div className="modal-mask recurring-edit-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={card} className="modal-card recurring-edit-card" role="dialog" aria-modal="true" aria-labelledby="recurring-edit-title" aria-describedby="recurring-edit-summary" aria-busy={busy}>
      <div className="modal-tape" /><h3 id="recurring-edit-title">应用到哪些日程？</h3>
      <p id="recurring-edit-summary" className="recurring-edit-summary"><strong>{next.title}</strong><span>{weekLabel} · {next.day}{!next.all_day && ` ${time(next.start_minute)}–${time(next.end_minute)}`}</span></p>
      <div className="recurring-edit-actions">
        <button type="button" autoFocus className="paper-btn" disabled={busy} onClick={() => apply('week')}><CalendarDays size={18} /><span>只修改本周</span></button>
        <button type="button" className="paper-btn primary" disabled={busy} onClick={() => apply('future')}><CalendarClock size={18} /><span>修改本次及以后</span></button>
      </div>
      {error && <p className="recurring-edit-error" role="alert">{error}</p>}
      <div className="modal-actions"><span className="spacer" /><button type="button" className="paper-btn" disabled={busy} onClick={onClose}>取消</button></div>
    </div>
  </div>;
}
