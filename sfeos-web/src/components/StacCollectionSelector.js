import React from 'react';
import './StacCollectionSelector.css';
import StacCollectionDetails from './StacCollectionDetails';

function StacCollectionSelector({ 
  collections, 
  loading, 
  error, 
  selectedCollection,
  onCollectionChange,
  onZoomToBbox,
  onShowItemsOnMap,
  stacApiUrl
}) {
  const handleChange = (e) => {
    const collectionId = e.target.value;
    if (collectionId === 'all-collections' || collectionId === '') {
      // Special case for "All Collections" or placeholder selection - pass null collection
      try {
        window.dispatchEvent(new CustomEvent('hideOverlays'));
        window.dispatchEvent(new CustomEvent('selectedCollectionChanged', { detail: { collectionId: null } }));
      } catch (err) {
        console.warn('Failed to dispatch hideOverlays on all-collections change:', err);
      }
      onCollectionChange(null);
    } else {
      // Regular collection selection
      const collection = collections.find(c => c.id === collectionId);
      if (collection) {
        // Close any open overlays when changing collections
        try {
          window.dispatchEvent(new CustomEvent('hideOverlays'));
          window.dispatchEvent(new CustomEvent('selectedCollectionChanged', { detail: { collectionId: collection.id } }));
        } catch (err) {
          console.warn('Failed to dispatch hideOverlays on collection change:', err);
        }
        onCollectionChange(collection);
      }
    }
  };

  return (
    <div className="stac-collection-selector">
      <div className="stac-header">
        <h3>STAC Collections</h3>
      </div>

      {loading && <div className="stac-status">Loading collections...</div>}
      
      {error && <div className="stac-error">{error}</div>}
      
      {!loading && collections.length > 0 && (
        <div className="stac-selector">
          <select 
            onChange={handleChange}
            defaultValue={selectedCollection ? selectedCollection.id : ''}
            className="stac-select"
          >
            <option value="">Select a collection...</option>
            <option value="all-collections">All Collections</option>
            {collections.map(collection => (
              <option key={collection.id} value={collection.id}>
                {collection.id}
              </option>
            ))}
          </select>
        </div>
      )}

      {(
        <StacCollectionDetails 
          collection={selectedCollection}
          onZoomToBbox={onZoomToBbox}
          onShowItemsOnMap={onShowItemsOnMap}
          stacApiUrl={stacApiUrl}
        />
      )}
    </div>
  );
}

export default StacCollectionSelector;
