import React from 'react';
import './layers.css';

export default function LayerControls({ layers, visibleLayers, activeLayer, onToggle, onSelect, compact = false }) {
  return <div className={`layer-controls ${compact ? 'is-compact' : ''}`}>
    <fieldset className="layer-visibility"><legend>显示图层</legend><div className="layer-checkboxes">
      {layers.map((layer) => <label key={layer.id} className={`layer-checkbox ${visibleLayers.includes(layer.id) ? 'is-visible' : ''}`} style={{ '--layer-color': layer.color }}>
        <input type="checkbox" checked={visibleLayers.includes(layer.id)} onChange={() => onToggle(layer.id)} />
        <i aria-hidden="true" style={{ background: layer.color }} /><span>{layer.label}</span>
      </label>)}
    </div></fieldset>
    {!compact && <label className="layer-target">新增到<select className="paper-select" aria-label="新增日程图层" disabled={!visibleLayers.length} value={visibleLayers.length ? activeLayer : ''} onChange={(event) => onSelect(event.target.value)}>
      {!visibleLayers.length && <option value="">未显示图层</option>}
      {layers.filter((layer) => visibleLayers.includes(layer.id)).map((layer) => <option key={layer.id} value={layer.id}>{layer.label}</option>)}
    </select></label>}
  </div>;
}
