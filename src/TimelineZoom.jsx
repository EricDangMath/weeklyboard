import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { ZOOM_KEY, MIN_ZOOM, MAX_ZOOM, MIN_TIMELINE_WIDTH, clampZoom, readZoomPreference, fitTimelineScale } from './timeline-zoom.mjs';
import './timeline-zoom.css';

export default function TimelineZoom({ children }) {
  const viewport = useRef(null), canvas = useRef(null);
  const [preference, setPreference] = useState(() => readZoomPreference(typeof window === 'undefined' ? null : window.localStorage));
  const [size, setSize] = useState({ width: 0, height: 0, contentHeight: 0 });
  const minimumWidth = preference.fit && size.width < 760 ? 640 : MIN_TIMELINE_WIDTH;
  const scale = preference.fit ? fitTimelineScale(size.width, size.height, size.contentHeight, minimumWidth) : preference.percent / 100;
  const canvasWidth = Math.max(minimumWidth, (size.width - 8) / scale);

  useLayoutEffect(() => {
    const measure = () => {
      const next = { width: viewport.current.clientWidth, height: viewport.current.clientHeight, contentHeight: canvas.current.offsetHeight };
      setSize((old) => Object.keys(next).every((key) => next[key] === old[key]) ? old : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current); observer.observe(canvas.current);
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(ZOOM_KEY, JSON.stringify(preference)); } catch {}
    if (preference.fit) {
      viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0;
      window.scrollTo({ top: 0 });
    }
  }, [preference, scale]);
  const setPercent = (percent) => setPreference({ percent: clampZoom(percent), fit: false });
  const displayedPercent = Math.round(scale * 100);
  return <section className={`week-zoom ${preference.fit ? 'is-fit' : ''}`} aria-label="周看板缩放">
    <div className="week-zoom-toolbar" role="group" aria-label="缩放控制">
      <button className="icon-btn" title="缩小" aria-label="缩小周看板" disabled={displayedPercent <= MIN_ZOOM} onClick={() => setPercent(displayedPercent - 10)}><ZoomOut size={17} /></button>
      <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={5} aria-label="周看板缩放比例" aria-valuetext={`${displayedPercent}%`} value={Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, displayedPercent))} onChange={(e) => setPercent(e.target.value)} />
      <button className="icon-btn" title="放大" aria-label="放大周看板" disabled={displayedPercent >= MAX_ZOOM} onClick={() => setPercent(displayedPercent + 10)}><ZoomIn size={17} /></button>
      <output className="week-zoom-percent" aria-label="当前缩放比例">{displayedPercent}%</output>
      <button className={`paper-btn week-zoom-fit ${preference.fit ? 'primary' : ''}`} aria-pressed={preference.fit} onClick={() => setPreference((current) => ({ ...current, fit: !current.fit }))}>{preference.fit ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{preference.fit ? '退出预览' : '一屏预览'}</button>
      <button className="icon-btn" title="恢复 100%" aria-label="恢复默认缩放" onClick={() => setPercent(100)}><RotateCcw size={16} /></button>
    </div>
    <div ref={viewport} className="week-zoom-viewport">
      <div className="week-zoom-spacer" style={{ width: canvasWidth * scale, height: size.contentHeight * scale }}>
        <div ref={canvas} className="week-zoom-canvas" data-scale={scale} style={{ width: canvasWidth, transform: `scale(${scale})` }}>{children}</div>
      </div>
    </div>
  </section>;
}
