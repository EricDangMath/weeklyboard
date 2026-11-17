import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, RotateCcw } from 'lucide-react';
import { DeadlineList } from './Deadlines.jsx';
import { MoodFace, MoodPalette, useCalendarMoods, useMoodDrag } from './CalendarMoods.jsx';
import { localDateKey, MOOD_BY_ID, moodTrend, validMoodDate } from './mood-data.mjs';
import './calendar-moods.css';

const startOfWeek = (value) => { const date = new Date(value); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (date.getDay() + 6) % 7); return date; };
function Widget({ title, english, children }) {
  return <section className="caw-card"><div className="caw-head"><span className="caw-name">{title}</span><em>{english}</em></div><div className="caw-body">{children}</div></section>;
}

export default function CalendarView({ month, setMonth, weekStart, setWeekStart, close, nights, deadlines, review, onOpenDeadline, onToggleDeadline, call, notify }) {
  const [today, setToday] = useState(() => localDateKey(new Date()));
  const [selectedDate, setSelectedDate] = useState(today);
  const moods = useCalendarMoods({ call, month, today, notify });
  const drag = useMoodDrag({ disabled: moods.disabled, onDrop: async (date, mood, fromDate) => {
    if (await moods.change(date, mood, fromDate)) setSelectedDate(date);
  } });
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDateKey(new Date())), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const byDate = new Map(moods.records.map((record) => [record.date, record.mood]));
  const currentMood = MOOD_BY_ID[byDate.get(selectedDate)];
  const trend = moodTrend(moods.records, today);
  const monthPrefix = localDateKey(new Date(month.getFullYear(), month.getMonth(), 1)).slice(0, 7);
  const monthDeadlines = deadlines.filter((item) => item.date?.startsWith(monthPrefix));
  const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day < 1 || day > daysInMonth ? null : new Date(month.getFullYear(), month.getMonth(), day);
  });
  const jump = (date) => { setWeekStart(startOfWeek(date)); close(); };
  const selectDate = (date) => {
    setSelectedDate(date);
    document.getElementById('calendarMoodCheckin')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  return <div className="cal-view mood-calendar" aria-label="日历与心情" onClickCapture={drag.clickCapture} onPointerDownCapture={drag.resetClick}>
    <header className="cal-topbar">
      <button className="paper-btn" onClick={close}><ArrowLeft size={16} />周看板</button>
      <h2 className="cal-title">日历<em>Calendar</em></h2>
      <span className="cal-spacer" />
      <nav className="mood-month-nav" aria-label="日历月份">
        <button className="icon-btn" title="上一个月" aria-label="上一个月" disabled={moods.busy} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={20} /></button>
        <button className="paper-btn" disabled={moods.busy} onClick={() => { setMonth(new Date()); setSelectedDate(today); }}>本月</button>
        <button className="icon-btn" title="下一个月" aria-label="下一个月" disabled={moods.busy} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={20} /></button>
      </nav>
    </header>
    <div className="cal-body">
      <aside className="cal-widgets" id="calWidgetsL">
        <div id="calendarMoodCheckin"><Widget title={selectedDate === today ? '今日心情' : '当日心情'} english="Mood Check-in">
          <div className="mood-date-row">
            <input type="date" aria-label="心情记录日期" value={selectedDate} disabled={moods.busy} onChange={(event) => {
              if (!validMoodDate(event.target.value)) return;
              setSelectedDate(event.target.value);
              setMonth(new Date(`${event.target.value}T12:00:00`));
            }} />
            <button className="icon-btn" title="回到今天" aria-label="回到今天" disabled={moods.busy} onClick={() => { setSelectedDate(today); setMonth(new Date()); }}><RotateCcw size={16} /></button>
          </div>
          <div className="caw-today-face">
            {moods.loading ? <span className="caw-today-none">正在读取…</span> : currentMood ? <><MoodFace id={currentMood.id} size={44} /><span className="caw-today-mood-name">{currentMood.label}</span></> : <span className="caw-today-none">尚未记录</span>}
          </div>
          <MoodPalette active={currentMood?.id} disabled={moods.disabled} onChoose={(id) => moods.change(selectedDate, currentMood?.id === id ? null : id)} onPointerDown={drag.start} />
          <div className="mood-save-status" role="status">{moods.status}</div>
          {moods.error && <div className="mood-error" role="alert">{moods.error}<button className="text-btn" disabled={moods.busy || moods.loading} onClick={moods.reload}>重新读取</button></div>}
        </Widget></div>
        <Widget title="今日专注" english="Today Focus"><div className="focus-empty">{review ? `本周完成率 ${Math.round((review.tasks?.completion_rate || 0) * 100)}%` : '还没有复盘数据'}</div></Widget>
        <Widget title="截止雷达" english="Deadline Radar"><DeadlineList items={monthDeadlines} onOpen={onOpenDeadline} onToggle={onToggleDeadline} empty="本月暂无截止提醒" /></Widget>
        <Widget title="天气" english="Weather"><div className="wwweather-today"><span className="wwetter-ico">☀️</span><div><b>24° <i>晴</i></b><span>今天适合专注工作</span></div></div></Widget>
      </aside>
      <div className="cal-scroll"><div className="cal-months"><section className="month-card">
        <div className="month-tape" /><div className="month-head"><span className="month-title">{month.getFullYear()}年{month.getMonth() + 1}月</span><span className="month-en">{month.toLocaleString('en-US', { month: 'long' })}</span></div>
        <div className="cal-week-head">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span className="cal-dow" key={day}>{day}</span>)}</div>
        <div className="month-grid">{Array.from({ length: cells.length / 7 }, (_, row) => {
          const dates = cells.slice(row * 7, row * 7 + 7);
          return <div className={`week-row ${dates.some((date) => date && startOfWeek(date).getTime() === weekStart.getTime()) ? 'cur-week' : ''}`} key={row}>
            {dates.map((date, index) => {
              if (!date) return <div className="cal-day blank" key={`blank-${index}`} />;
              const key = localDateKey(date), mood = MOOD_BY_ID[byDate.get(key)];
              return <div className={`cal-day${index > 4 ? ' weekend' : ''}${key === today ? ' today' : ''}${key === selectedDate ? ' mood-selected' : ''}${key === drag.target ? ' drop-ok' : ''}`} key={key} data-date={key}>
                <button className="mood-day-open" aria-label={`进入 ${key} 所在周`} onClick={() => jump(date)}><span className="cal-num">{date.getDate()}</span></button>
                <span className="cal-badges">
                  {nights.some((item) => item.date === key) && <span className="cal-moon" title="熬夜记录">🌙</span>}
                  {deadlines.some((item) => item.date === key) && <span className="cal-moon" title="截止提醒">⚠️</span>}
                  {mood ? <button className={`cal-mood${drag.preview?.fromDate === key ? ' dragging' : ''}`} disabled={moods.disabled}
                    title={`${key} ${mood.label} · 点击取消 · 拖动移至其他日期`} aria-label={`取消 ${key} 的${mood.label}记录`}
                    draggable={false} onPointerDown={(event) => drag.start(event, mood.id, key)} onClick={() => moods.change(key, null)}><MoodFace id={mood.id} size={25} /></button>
                    : <button className="mood-add-day" title="记录心情" aria-label={`记录 ${key} 的心情`} disabled={moods.disabled} onClick={() => selectDate(key)}><Plus size={15} /></button>}
                </span>
              </div>;
            })}
          </div>;
        })}</div>
      </section></div></div>
      <aside className="cal-widgets" id="calWidgetsR">
        <Widget title="心情趋势" english="Last 28 Days">
          <div className="mood-trend-summary"><b>{trend.recorded}</b><span>/ 28 天已记录</span></div>
          <div className="caw-strip" aria-label="近28天心情记录">
            {trend.days.map(({ date, mood }) => <button key={date} className={`caw-cell${mood ? '' : ' empty'}`} title={`${date} · ${mood?.label || '未记录'}`}
              aria-label={`${date} ${mood?.label || '未记录'}`} disabled={moods.busy} onClick={() => { setSelectedDate(date); setMonth(new Date(`${date}T12:00:00`)); selectDate(date); }}>
              {mood && <MoodFace id={mood.id} size={20} />}
            </button>)}
          </div>
          <ul className="caw-top">{trend.top.length ? trend.top.map((mood) => <li key={mood.id}><MoodFace id={mood.id} size={22} /><span>{mood.label}</span><b>{mood.count}天</b></li>) : <li className="caw-empty">最近 28 天还没有心情记录</li>}</ul>
        </Widget>
        <Widget title="明天速览" english="Tomorrow"><ul className="wtmr"><li><span className="wtmr-time">09:00</span><span className="wtmr-title">整理本周计划</span></li><li><span className="wtmr-time">14:00</span><span className="wtmr-title">留出一段深度工作</span></li></ul></Widget>
        <Widget title="快速记录" english="Quick Capture"><textarea rows="3" placeholder="想到什么就写下来…" /></Widget>
        <Widget title="熬夜档案" english="Night Owl Archive"><p className="caw-sub">本周 {nights.length} 次熬夜记录</p><div className="night-archive">{nights.map((item) => <span key={item.id}>🌙 {item.text}</span>)}</div></Widget>
      </aside>
    </div>
    {drag.preview && <div className="mood-drag-preview" aria-hidden="true" style={{ left: drag.preview.x, top: drag.preview.y }}><MoodFace id={drag.preview.mood} size={32} /><span>{MOOD_BY_ID[drag.preview.mood].label}</span></div>}
  </div>;
}
