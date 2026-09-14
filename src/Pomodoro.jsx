import React, { useCallback, useEffect, useRef, useState } from 'react';
import './pomodoro.css';

export function usePomodoro({ call, weekKey, revision, refresh, notify, active }) {
  const [data, setData] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  useEffect(() => {
    if (!active) return;
    let live = true;
    call(`/pomodoro?week_key=${encodeURIComponent(weekKey)}`).then((result) => {
      if (live) { setData({ ...result, owner: call }); setError(''); }
    }).catch((error) => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [call, weekKey, revision, active]);
  const mutate = useCallback(async (action, payload) => {
    if (locked.current) return false;
    locked.current = true;
    setPending(true);
    try {
      const result = await call(`/pomodoro/${action}`, { method: 'PUT', body: JSON.stringify({ week_key: weekKey, ...payload }) });
      if (action === 'settings') setData((current) => current ? { ...current, enabled: result.enabled } : current);
      else setData({ ...result, owner: call });
      setError('');
      if (action !== 'settings') await refresh();
      return true;
    } catch (error) {
      notify(error.message);
      setError(error.message);
      return false;
    } finally { locked.current = false; setPending(false); }
  }, [call, weekKey, refresh, notify]);
  const current = data?.week_key === weekKey && data?.owner === call ? data : null;
  return {
    data: current, enabled: data?.owner === call ? data.enabled !== false : true, pending, error, warn: notify,
    toggle: () => mutate('settings', { enabled: !data?.enabled }),
    plan: (row, units) => mutate('plan', { group_key: row.key, units }),
    check: (row, day, index) => mutate('check', { group_key: row.key, day: day.day, expected_minutes: day.actual_minutes, target_minutes: day.actual_minutes > index * 30 ? index * 30 : (index + 1) * 30 }),
    complete: (task, day) => {
      const row = current?.rows.find((row) => row.task_id === task.id);
      return row ? mutate('complete', { group_key: row.key, day, completed: !row.complete }) : Promise.resolve(false);
    },
  };
}

export function PomodoroSwitch({ controller }) {
  return <label className="pomo-switch">
    <input type="checkbox" role="switch" aria-label="番茄钟统计" checked={controller.enabled} disabled={controller.pending || !controller.data} onChange={controller.toggle} />
    <span className="pomo-switch-track" aria-hidden="true" /><span>番茄钟</span>
  </label>;
}

export function Progress({ percent, label }) {
  const colors = ['#5A8A8E', '#DBB355', '#3D7695', '#A585A8', '#C85E3D'];
  const level = percent > 0 ? Math.ceil(percent / 100) - 1 : 0;
  const width = percent > 0 ? ((percent - 1) % 100) + 1 : 0;
  return <span className="pomo-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(100, percent)} aria-valuenow={percent} aria-valuetext={`${percent}%`} style={{ background: level > 0 ? colors[(level - 1) % colors.length] : undefined }}><i style={{ width: `${width}%`, background: colors[level % colors.length] }} /></span>;
}

function PlanInput({ row, controller }) {
  const [value, setValue] = useState(String(row.plan_units));
  const cancel = useRef(false);
  useEffect(() => setValue(String(row.plan_units)), [row.plan_units]);
  const save = async () => {
    if (cancel.current) { cancel.current = false; return; }
    const amount = Number(value);
    if (value === '' || !Number.isInteger(amount) || amount < row.minimum_units || amount > 336) {
      controller.warn(amount < row.minimum_units ? `计划不能少于已安排的 ${row.minimum_units} 个番茄钟` : '番茄钟计划必须是 0 到 336 之间的整数');
      setValue(String(row.plan_units));
      return;
    }
    if (amount !== row.plan_units && !(await controller.plan(row, amount))) setValue(String(row.plan_units));
  };
  return <input className="pomo-plan-input" type="number" min={row.minimum_units} max="336" step="1" aria-label={`${row.title} 计划番茄钟`} title={`计划不能少于已安排的 ${row.minimum_units} 个番茄钟`} value={value} disabled={controller.pending} onChange={(event) => setValue(event.target.value)} onBlur={save} onKeyDown={(event) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') { cancel.current = true; setValue(String(row.plan_units)); event.currentTarget.blur(); }
  }} />;
}

export function PomodoroPanel({ controller, categories }) {
  if (!controller.enabled) return null;
  const data = controller.data;
  const totals = data?.total;
  return <section className="pomo-panel" aria-label="本周番茄钟统计">
    <div className="pomo-heading"><h2>番茄钟统计 <em>Pomodoro</em></h2><span className="pomo-unit">1 番茄钟 = 30 分钟</span></div>
    {controller.error && <p className="pomo-error" role="alert">{controller.error}</p>}
    {!data ? <p className="pomo-empty" role="status">正在读取统计…</p> : <>
      <div className="pomo-overview">
        <span>计划 <strong>{totals.plan_units}</strong></span>
        <span>实际 <strong>{totals.actual_units}</strong></span>
        <span>待安排 <strong>{totals.pending_units}</strong></span>
        <div className="pomo-overall-progress"><Progress percent={totals.percent} label="本周番茄钟进度" /><strong>{totals.percent}%</strong></div>
      </div>
      {!data.rows.length ? <p className="pomo-empty">本周暂无任务</p> : <div className="pomo-table-scroll" tabIndex={0} aria-label="每日番茄钟明细">
        <table className="pomo-table">
          <colgroup><col className="pomo-title-col" /><col className="pomo-number-col" /><col className="pomo-number-col" /><col span="7" /></colgroup>
          <thead><tr><th scope="col">任务</th><th scope="col">计划</th><th scope="col">实际</th>{data.daily.map((day) => <th scope="col" key={day.day}>{day.day}</th>)}</tr></thead>
          <tbody>{data.rows.map((row) => <tr key={row.key}>
            <th scope="row"><div className="pomo-row-title"><i style={{ background: categories.find((cat) => cat.id === row.category)?.color || '#9A948A' }} /><strong title={row.project ? `${row.project} · ${row.title}` : row.title}>{row.title}</strong></div><div className="pomo-row-progress"><Progress percent={row.percent} label={`${row.title} 完成率`} /><span>{row.percent}%</span></div></th>
            <td><PlanInput row={row} controller={controller} /></td>
            <td className={row.complete ? 'pomo-complete' : ''}>{row.actual_units > 0 ? <strong>{row.actual_units}</strong> : null}</td>
            {row.daily.map((day) => <td key={day.day}><div className="pomo-checks">{Array.from({ length: day.boxes }, (_, index) => {
              const progress = Math.max(0, Math.min(1, (day.actual_minutes - index * 30) / 30));
              return <button type="button" key={index} className={`pomo-check ${progress === 1 ? 'checked' : ''} ${progress > 0 && progress < 1 ? 'partial' : ''}`} role="checkbox" aria-checked={progress === 1 ? true : progress > 0 ? 'mixed' : false} aria-label={`${row.title} ${day.day} 第 ${index + 1} 个番茄钟`} title={progress > 0 ? '取消从这一格开始的记录' : '记录到这一格，每格 30 分钟'} style={{ '--pomo-fill': `${progress * 100}%` }} disabled={controller.pending} onClick={() => controller.check(row, day, index)} />;
            })}</div></td>)}
          </tr>)}</tbody>
        </table>
      </div>}
    </>}
  </section>;
}

export function PomodoroBreakdown({ data, categories }) {
  if (!data) return null;
  return <div className="pomo-breakdown">
    <h3>每日进度</h3>
    {data.daily.filter((day) => day.plan_units || day.actual_units).map((day) => <div className="pomo-breakdown-row" key={day.day}><span>{day.day}</span><Progress percent={day.percent} label={`${day.day} 番茄钟进度`} /><span>{day.actual_units} / {day.plan_units}</span></div>)}
    <h3>分类番茄钟</h3>
    {categories.map((cat) => {
      const rows = data.rows.filter((row) => row.category === cat.id);
      const plan = rows.reduce((sum, row) => sum + row.plan_units, 0);
      const minutes = rows.reduce((sum, row) => sum + row.actual_minutes, 0);
      if (!plan && !minutes) return null;
      return <div className="pomo-breakdown-row" key={cat.id}><span>{cat.label}</span><Progress percent={plan ? Math.round(minutes / (plan * 30) * 100) : 0} label={`${cat.label} 番茄钟进度`} /><span>{Math.floor(minutes / 30)} / {plan}</span></div>;
    })}
  </div>;
}
