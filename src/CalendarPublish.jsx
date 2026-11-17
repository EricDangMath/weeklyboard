import React, { useRef, useState } from 'react';
import { Link, Copy, X, Unplug, Check } from 'lucide-react';
import './calendar-publish.css';

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
const zones = [...new Set([localZone, 'America/New_York', 'America/Los_Angeles', 'Asia/Shanghai', 'Europe/London', 'UTC'])];
const defaults = () => ({ title: '我的周看板', timezone: localZone, layers: ['fixed', 'flex', 'once'], include_deadlines: true });

export default function CalendarPublish({ call, api, layers, notify }) {
  const dialog = useRef(null);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = saved?.enabled ? saved.url || new URL(`${api.replace(/\/$/, '')}${saved.path}`, window.location.href).href : '';
  const open = async () => {
    dialog.current.showModal(); setError(''); setBusy(true); setConfirmStop(false); setCopied(false); setSaved(null);
    try {
      const result = await call('/calendar/publish');
      setSaved(result); setDraft({ ...defaults(), ...result });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setCopied(false);
    try {
      const result = await call('/calendar/publish', { method: 'PUT', body: JSON.stringify(draft) });
      setSaved(result); setDraft(result); notify('日历订阅链接已更新');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true); setError('');
    try {
      await call('/calendar/publish', { method: 'DELETE' });
      setSaved({ ...saved, enabled: false, path: null, url: null }); setConfirmStop(false); setCopied(false);
      notify('订阅链接已停用，旧链接不再提供日程');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <>
    <button className="paper-btn calendar-publish-trigger" onClick={open}><Link size={15} />订阅链接</button>
    <dialog ref={dialog} className="modal-card calendar-publish-dialog" aria-labelledby="publish-title">
      <div className="publish-heading"><h3 id="publish-title">导出日历链接</h3><button className="icon-btn" title="关闭" aria-label="关闭导出日历链接" onClick={() => dialog.current.close()}><X size={19} /></button></div>
      <form onSubmit={save}>
        <fieldset disabled={busy || !saved} className="publish-fields">
          <label>日历名称<input required maxLength={100} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>日程时区<select value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>{[...new Set([...zones, draft.timezone])].map((zone) => <option key={zone}>{zone}</option>)}</select></label>
          <fieldset className="publish-layers"><legend>包含的图层</legend>{layers.map((layer) => <label key={layer.id}><input type="checkbox" checked={draft.layers.includes(layer.id)} onChange={(e) => setDraft({ ...draft, layers: e.target.checked ? [...draft.layers, layer.id] : draft.layers.filter((id) => id !== layer.id) })} /><i style={{ background: layer.color }} />{layer.label}</label>)}</fieldset>
          <label className="publish-check"><input type="checkbox" checked={draft.include_deadlines} onChange={(e) => setDraft({ ...draft, include_deadlines: e.target.checked })} />包含截止提醒</label>
          <p className="publish-privacy">持有链接的人可以读取所选日程，无法修改。停用后旧链接失效，已下载的内容无法远程删除。</p>
          <button className="paper-btn primary" disabled={!draft.layers.length} type="submit"><Link size={15} />{busy ? '正在保存…' : saved?.enabled ? '保存订阅设置' : '开启并生成链接'}</button>
        </fieldset>
      </form>
      {error && <p className="publish-error" role="alert">{error}</p>}
      {busy && !saved && <p role="status">正在读取…</p>}
      {link && <section className="publish-result">
        <label>只读订阅链接<div className="publish-link-row"><input aria-label="只读订阅链接" readOnly spellCheck={false} value={link} onFocus={(e) => e.target.select()} /><button className="icon-btn" type="button" title={copied ? '已复制' : '复制链接'} aria-label="复制订阅链接" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError('无法访问剪贴板，请选中链接复制'); } }}>{copied ? <Check size={18} /> : <Copy size={18} />}</button></div></label>
        <div role="status" className={saved.url ? 'publish-status' : 'publish-warning'}>{saved.url ? '已启用 · 外部日历刷新订阅时更新' : '本地链接 · 外部日历暂时无法访问。部署 HTTPS 后端并配置公开地址后才能跨设备订阅。'}</div>
        {confirmStop ? <div className="publish-confirm"><span>停用此链接？重新开启会生成新链接。</span><div><button className="paper-btn" disabled={busy} onClick={() => setConfirmStop(false)}>取消</button><button className="paper-btn danger" disabled={busy} onClick={stop}>确认停用</button></div></div> : <button className="text-btn publish-stop" onClick={() => setConfirmStop(true)}><Unplug size={15} />停用链接</button>}
      </section>}
    </dialog>
  </>;
}
