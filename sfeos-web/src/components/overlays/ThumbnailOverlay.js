import React, { useState } from 'react';
import './ThumbnailOverlay.css';

function ThumbnailOverlay({ url, title, type, onClose }) {
  const [imageError, setImageError] = useState(false);

  const lowerType = (type || '').toLowerCase();
  const isWebImage = url && (lowerType.startsWith('image/jpeg') || lowerType.startsWith('image/png') || /\.(jpg|jpeg|png)(\?|$)/i.test(url));

  return (
    <div className="thumbnail-overlay" role="dialog" aria-label="Item thumbnail">
      <div className="thumbnail-card">
        <div className="thumbnail-header">
          <div className="thumbnail-title" title={title}>{title}</div>
          <button className="thumbnail-close" onClick={onClose} aria-label="Close thumbnail">✕</button>
        </div>
        <div className="thumbnail-body">
          {isWebImage ? (
            imageError ? (
              <div className="thumbnail-error">
                <div className="thumbnail-note">Unable to load image. The image may require authentication or be unavailable.</div>
                <a href={url} target="_blank" rel="noreferrer" className="thumbnail-download-btn">Try Opening/Downloading</a>
              </div>
            ) : (
              <img 
                src={url} 
                alt={title || 'Item thumbnail'} 
                className="thumbnail-image"
                onError={() => setImageError(true)}
              />
            )
          ) : !url ? (
            <div className="thumbnail-error">
              <div className="thumbnail-note">No thumbnail URL available for this item.</div>
            </div>
          ) : (
            <div>
              <div className="thumbnail-note">This app doesn't support inline preview for this image type yet{type ? ` (${type})` : ''}.</div>
              <a href={url} target="_blank" rel="noreferrer" className="thumbnail-download-btn">Open/Download</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ThumbnailOverlay;
