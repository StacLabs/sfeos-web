import React, { useState, useEffect } from 'react';
import StacCollectionSelector from './StacCollectionSelector';

const getDefaultStacApiUrl = () =>
  process.env.REACT_APP_STAC_API_URL || 'http://localhost:8000';

function StacClient({ stacApiUrl, onShowItemsOnMap: propOnShowItemsOnMap }) {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [rootCatalog, setRootCatalog] = useState(null);
  const [isCatalogDescriptionExpanded, setIsCatalogDescriptionExpanded] = useState(false);

  useEffect(() => {
    const fetchCollections = async () => {
      try {
        setLoading(true);
        setError(null);

        const baseUrl = stacApiUrl || getDefaultStacApiUrl();
        
        // Fetch root catalog
        try {
          const catalogResponse = await fetch(`${baseUrl}/`);
          if (catalogResponse.ok) {
            const catalogData = await catalogResponse.json();
            setRootCatalog(catalogData);
            console.log('Fetched root catalog:', catalogData);
          }
        } catch (catalogErr) {
          console.warn('Could not fetch root catalog:', catalogErr);
          setRootCatalog(null);
        }

        const response = await fetch(`${baseUrl}/collections`);
        if (!response.ok) {
          throw new Error(`Failed to fetch collections: ${response.status}`);
        }

        const data = await response.json();
        const collectionsList = Array.isArray(data.collections) ? data.collections : [];
        setCollections(collectionsList);
        console.log('Fetched collections:', collectionsList);
        
        if (collectionsList.length === 0) {
          setError('No collections found');
        }
      } catch (err) {
        console.error('Error fetching STAC collections:', err);
        setError(`Error: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchCollections();
  }, [stacApiUrl]);

  const handleCollectionChange = (collection) => {
    setSelectedCollection(collection);
  };

  const handleZoomToBbox = (bbox) => {
    // bbox format: [minLon, minLat, maxLon, maxLat]
    // Dispatch event or callback to parent component to handle map zoom
    window.dispatchEvent(new CustomEvent('zoomToBbox', { detail: { bbox } }));
  };

  const handleShowItemsOnMap = (items) => {
    if (!items || !items.length) {
      console.warn('No items provided to show on map');
      return;
    }
    
    console.log('Dispatching showItemsOnMap event with items:', items);
    
    // Dispatch event to show items on map
    window.dispatchEvent(new CustomEvent('showItemsOnMap', { 
      detail: { 
        items
      } 
    }));
    
    // If a prop callback is provided, use that as well (for testing or alternative implementations)
    if (propOnShowItemsOnMap) {
      propOnShowItemsOnMap(items);
    }
  };

  return (
    <div className="stac-client-container">
      {rootCatalog && (
        <div className="stac-catalog-header">
          <button className="stac-expand-btn">
            <div className="catalog-button-content">
              <span className="expand-label">STAC Catalog</span>
              {rootCatalog.title && rootCatalog.title !== 'STAC Catalog' && (
                <div className="catalog-title-display">
                  {rootCatalog.title}
                </div>
              )}
              {rootCatalog.description && (
                <div 
                  className="catalog-description-header"
                  onClick={() => setIsCatalogDescriptionExpanded(!isCatalogDescriptionExpanded)}
                >
                  <span className="expand-arrow">{isCatalogDescriptionExpanded ? '▼' : '▶'}</span>
                  <span className="catalog-section-title">Description</span>
                </div>
              )}
              {isCatalogDescriptionExpanded && rootCatalog.description && (
                <div className="catalog-description-text">
                  {rootCatalog.description}
                </div>
              )}
            </div>
          </button>
        </div>
      )}

      <StacCollectionSelector 
        collections={collections}
        loading={loading}
        error={error}
        selectedCollection={selectedCollection}
        onCollectionChange={handleCollectionChange}
        onZoomToBbox={handleZoomToBbox}
        onShowItemsOnMap={handleShowItemsOnMap}
        stacApiUrl={stacApiUrl}
      />
    </div>
  );
}

export default StacClient;
