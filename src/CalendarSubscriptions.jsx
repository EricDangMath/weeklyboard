import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, RefreshCw, Trash2, X, Plus } from 'lucide-react';
import './subscriptions.css';

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
const zones = [...new Set(['America/New_York', localZone, 'America/Los_Angeles', 'Asia/Shanghai', 'Europe/London', 'UTC'])];

export default function CalendarSubscriptions({ call, onChanged, notify, layers }) {
  const dialog = useRef(null);
  const signature = useRef('');
  const [rows, setRows] = useState([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(localZone);
  const [layer, setLayer] = useState('once');
  const [mode, setMode] = useState('schedule');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  const [removeEvents, setRemoveEvents] = useState(false);
  const reload = useCallback(async () => {
    const items = await call('/calendar/subscriptions');
    setRows(items);
    const next = JSON.stringify(items.map((item) => [item.id, item.last_synced, item.layer, item.mode]));
    if (signature.current && signature.current !== next) await onChanged(false);
    signature.current = next;
  }, [call, onChanged]);
  useEffect(() => {
    signature.current = '';
    reload().catch(() => {});
    const timer = setInterval(() => reload().catch(() => {}), 60000);
    return () => clearInterval(timer);
  }, [reload]);
  const open = () => { setError(''); dialog.current.showModal(); reload().catch(() => setError('无法读取订阅，请检查后端连接')); };
  const run = async (key, action) => {
    setBusy(key); setError('');
    try { await action(); await reload(); }
    catch (e) { setError(e.message); await reload().catch(() => {}); }
    finally { setBusy(null); }
  };
  const add = (event) => {
    event.preventDefault();
    run('add', async () => {
      const result = await call('/calendar/subscriptions', { method: 'POST', body: JSON.stringify({ url, name, timezone, layer, mode }) });
      setUrl(''); setName('');
      await onChanged(result.layer);
      notify(`订阅成功，已同步 ${result.event_count} 条日程`);
    });
  };
  const changeSettings = (row, patch) => run(row.id, async () => {
    const result = await call(`/calendar/subscriptions/${row.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    await onChanged(result.layer);
    notify('日历设置已更新');
  });
  return <>
    <button className="paper-btn primary subscription-trigger" onClick={open}><CalendarClock size={15} />订阅日历{rows.length > 0 && <span className="subscription-count">{rows.length}</span>}</button>
    <dialog ref={dialog} className="modal-card subscription-dialog" aria-labelledby="subscription-title" onClick={(e) => { if (e.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.current.close(); } }}>
      <div className="subscription-heading"><h3 id="subscription-title">日历订阅</h3><button className="icon-btn" title="关闭" aria-label="关闭日历订阅" onClick={() => dialog.current.close()}><X size={19} /></button></div>
      <form onSubmit={add} className="subscription-form">
        <label>日历链接<input autoFocus type="text" inputMode="url" autoComplete="off" spellCheck={false} required value={url} onChange={(e) => { setUrl(e.target.value); try { setMode(new URL(e.target.value.replace(/^webcal:/i, 'https:')).hostname.endsWith('.instructure.com') ? 'deadlines' : 'schedule'); } catch {} }} placeholder="https://… 或 webcal://…" /></label>
        <div className="subscription-fields"><label>名称<input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="学校课表" /></label><label>显示时区<select value={timezone} onChange={(e) => setTimezone(e.target.value)}>{zones.map((zone) => <option key={zone}>{zone}</option>)}</select></label></div>
        <div className="subscription-fields"><label>图层<select aria-label="新订阅图层" value={layer} onChange={(e) => setLayer(e.target.value)}>{layers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>用途<select aria-label="新订阅用途" value={mode} onChange={(e) => setMode(e.target.value)}><option value="schedule">日程</option><option value="deadlines">作业 / 考试提醒</option></select></label></div>
        <button type="submit" className="paper-btn primary subscription-add" disabled={busy !== null}><Plus size={16} />{busy === 'add' ? '正在读取日历…' : '添加订阅'}</button>
      </form>
      {error && <p className="subscription-error" role="alert">{error}</p>}
      <div className="subscription-section-heading"><h4>已订阅 · {rows.length}</h4><span>自动同步 · 每 30 分钟</span></div>
      {!rows.length && <p className="subscription-empty">暂无订阅</p>}
      <div className="subscription-list">{rows.map((row) => <section className="subscription-item" key={row.id}>
        <div className="subscription-item-top"><div><strong>{row.name}</strong><span>{row.host}</span></div><div className="subscription-controls"><button className="icon-btn" title="立即同步" aria-label={`同步 ${row.name}`} disabled={busy !== null} onClick={() => run(row.id, async () => { await call(`/calendar/subscriptions/${row.id}/sync`, { method: 'POST' }); await onChanged(row.layer); notify('日历已同步'); })}><RefreshCw size={17} className={busy === row.id ? 'subscription-spinning' : ''} /></button><button className="icon-btn" title="取消订阅" aria-label={`取消订阅 ${row.name}`} disabled={busy !== null} onClick={() => { setRemoving(row.id); setRemoveEvents(false); }}><Trash2 size={17} /></button></div></div>
        <div className="subscription-fields subscription-settings"><label>图层<select aria-label={`${row.name} 图层`} value={row.layer} disabled={busy !== null} onChange={(e) => changeSettings(row, { layer: e.target.value })}>{layers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>用途<select aria-label={`${row.name} 用途`} value={row.mode} disabled={busy !== null} onChange={(e) => changeSettings(row, { mode: e.target.value })}><option value="schedule">日程</option><option value="deadlines">作业 / 考试提醒</option></select></label></div>
        <div className="subscription-meta"><span>{row.event_count} 条{row.mode === 'deadlines' ? '截止提醒' : '日程'}</span><span>{row.timezone}</span><span>上次同步：{row.last_synced ? new Date(row.last_synced).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'}</span></div>
        {row.last_error && <p className="subscription-error">{row.last_error}</p>}
        {removing === row.id && <div className="subscription-confirm"><strong>取消订阅“{row.name}”？</strong><label className="check-row"><input type="checkbox" checked={removeEvents} onChange={(e) => setRemoveEvents(e.target.checked)} />同时删除这份订阅的日程</label><div><button className="paper-btn" disabled={busy !== null} onClick={() => setRemoving(null)}>保留订阅</button><button className="paper-btn danger" disabled={busy !== null} onClick={() => run(row.id, async () => { await call(`/calendar/subscriptions/${row.id}?remove_events=${removeEvents}`, { method: 'DELETE' }); setRemoving(null); await onChanged(false); notify(removeEvents ? '已取消订阅并删除关联日程' : '已取消订阅，日程已保留'); })}>确认取消</button></div></div>}
      </section>)}</div>
    </dialog>
  </>;
}

export function SubscriptionEvent({ event, close }) {
  const time = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && close()}><div className="modal-card" role="dialog" aria-modal="true" aria-label="订阅日程详情"><h3>{event.title}</h3><p>{event.day} · {event.all_day ? '全天' : `${time(event.start_minute)} – ${time(event.end_minute)}`}</p><p className="subscription-detail">{event.description}</p><span className="subscription-readonly">订阅日程 · 由来源日历更新</span><div className="modal-actions"><button autoFocus className="paper-btn primary" onClick={close}>关闭</button></div></div></div>;
}
