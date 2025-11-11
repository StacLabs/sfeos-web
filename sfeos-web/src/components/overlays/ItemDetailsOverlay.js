import React, { useState } from 'react';
import './ItemDetailsOverlay.css';

function ItemDetailsOverlay({ details, onClose }) {
  const [showProperties, setShowProperties] = useState(false);
  if (!details) return null;
  const { id, title, assetsCount, bbox, collection, properties = {} } = details;
  
  console.log('ItemDetailsOverlay received details:', details);
  console.log('Properties object:', properties);
  console.log('Properties keys:', Object.keys(properties));
  console.log('Properties length:', Object.keys(properties).length);
  console.log('Properties sample:', Object.keys(properties).slice(0, 5));
  console.log('Full properties:', JSON.stringify(properties, null, 2));

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
          {properties.datetime && (
            <div className="details-row"><span className="label">Datetime:</span><span className="value">{new Date(properties.datetime).toISOString()}</span></div>
          )}
          {properties.start_datetime && (
            <div className="details-row"><span className="label">Start:</span><span className="value">{new Date(properties.start_datetime).toISOString()}</span></div>
          )}
          {properties.end_datetime && (
            <div className="details-row"><span className="label">End:</span><span className="value">{new Date(properties.end_datetime).toISOString()}</span></div>
          )}
          <div className="details-row"><span className="label">Assets:</span><span className="value">{assetsCount ?? 0}</span></div>
          {Array.isArray(bbox) && bbox.length === 4 && (
            <div className="details-row bbox"><span className="label">BBox:</span><span className="value">[{bbox.map(n => Number(n).toFixed(4)).join(', ')}]</span></div>
          )}
          
          <div className="details-row">
            <span className="label">Properties:</span>
            <span className="value">
              <button 
                className="properties-toggle" 
                onClick={() => setShowProperties(!showProperties)}
                style={{
                  background: 'none',
                  border: '1px solid #ccc',
                  borderRadius: '3px',
                  padding: '2px 6px',
                  fontSize: '0.7rem',
                  cursor: 'pointer'
                }}
              >
                {showProperties ? 'Hide' : 'Show'} Properties ({Object.keys(properties).length})
              </button>
            </span>
          </div>
          
          {showProperties && Object.keys(properties).length > 0 && (
            <div className="properties-expanded" style={{
              marginTop: '8px',
              padding: '8px',
              background: 'rgba(0, 0, 0, 0.05)',
              borderRadius: '4px',
              fontSize: '0.6rem',
              maxHeight: '200px',
              overflowY: 'auto'
            }}>
              {Object.entries(properties).map(([key, value]) => (
                <div key={key} className="property-row" style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '2px',
                  wordBreak: 'break-word'
                }}>
                  <span className="property-key" style={{ fontWeight: 'bold', marginRight: '8px' }}>
                    {key}:
                  </span>
                  <span className="property-value" style={{ textAlign: 'right', flex: 1 }}>
                    {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                      ? String(value) 
                      : Array.isArray(value)
                        ? `[${value.join(', ')}]`
                        : typeof value === 'object' && value !== null
                          ? JSON.stringify(value, null, 1).replace(/[{}"]/g, '').replace(/,/g, ', ')
                          : String(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ItemDetailsOverlay;
