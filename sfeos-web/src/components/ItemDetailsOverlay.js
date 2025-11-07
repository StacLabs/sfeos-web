import React from 'react';
import './ItemDetailsOverlay.css';

function ItemDetailsOverlay({ details, onClose }) {
  if (!details) return null;
  const { id, title, datetime, assetsCount, bbox, collection } = details;

  return (
    <div className="item-details-overlay" role="dialog" aria-label="STAC item details">
      <div className="details-card">
        <div className="details-header">
          <div className="details-title" title={title || id}>{title || id}</div>
          <button className="details-close" onClick={onClose} aria-label="Close details">✕</button>
        </div>
        <div className="details-body">
          <div className="details-row"><span className="label">ID:</span><span className="value" title={id}>{id}</span></div>
          {collection && (
            <div className="details-row"><span className="label">Collection:</span><span className="value" title={collection}>{collection}</span></div>
          )}
          {datetime && (
            <div className="details-row"><span className="label">Datetime:</span><span className="value">{new Date(datetime).toISOString()}</span></div>
          )}
          <div className="details-row"><span className="label">Assets:</span><span className="value">{assetsCount ?? 0}</span></div>
          {Array.isArray(bbox) && bbox.length === 4 && (
            <div className="details-row bbox"><span className="label">BBox:</span><span className="value">[{bbox.map(n => Number(n).toFixed(4)).join(', ')}]</span></div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ItemDetailsOverlay;
