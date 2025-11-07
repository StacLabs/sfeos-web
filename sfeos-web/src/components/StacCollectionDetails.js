import React, { useState, useEffect, useRef } from 'react';
import './StacCollectionDetails.css';
import './QueryItems.css';

function StacCollectionDetails({ collection, onZoomToBbox, onShowItemsOnMap, stacApiUrl }) {
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isBoundingBoxVisible, setIsBoundingBoxVisible] = useState(false);
  const [isTemporalExtentVisible, setIsTemporalExtentVisible] = useState(false);
  const [isQueryItemsVisible, setIsQueryItemsVisible] = useState(false);
  const [queryItems, setQueryItems] = useState([]);
  const [nextLink, setNextLink] = useState(null);
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [itemLimit, setItemLimit] = useState(10);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [isBboxModeOn, setIsBboxModeOn] = useState(false);
  const [numberReturned, setNumberReturned] = useState(null);
  const [numberMatched, setNumberMatched] = useState(null);
  const [visibleThumbnailItemId, setVisibleThumbnailItemId] = useState(null);
  const [itemLimitDisplay, setItemLimitDisplay] = useState(itemLimit.toString());
  const [isDatetimePickerOpen, setIsDatetimePickerOpen] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [appliedDatetimeFilter, setAppliedDatetimeFilter] = useState('');
  const prevCollectionId = useRef(null);
  const stacApiUrlRef = useRef(stacApiUrl);
  const itemLimitRef = useRef(itemLimit);
  const appliedDatetimeFilterRef = useRef('');

  useEffect(() => {
    stacApiUrlRef.current = stacApiUrl;
  }, [stacApiUrl]);

  useEffect(() => {
    itemLimitRef.current = itemLimit;
    setItemLimitDisplay(itemLimit.toString());
  }, [itemLimit]);

  useEffect(() => {
    appliedDatetimeFilterRef.current = appliedDatetimeFilter;
  }, [appliedDatetimeFilter]);



  // Detect collection changes and reset state
  useEffect(() => {
    if (collection && collection.id && prevCollectionId.current !== collection.id) {
      console.log(`Collection changed to: ${collection.id}`);
      prevCollectionId.current = collection.id;
      // Reset state when collection changes
      setIsQueryItemsVisible(false);
      setItemLimit(10);
      setItemLimitDisplay('10');
      setQueryItems([]);
      setSelectedItemId(null);
      setIsDescriptionExpanded(false);
      setIsBoundingBoxVisible(false);
    }
  }, [collection, stacApiUrl]);

  // Fetch query items when the component mounts or collection changes
  useEffect(() => {
    if (collection && collection.id) {
      console.log(`Fetching items for collection: ${collection.id}`);
      // Fetch items from the collection using STAC API
      const fetchItems = async () => {
        try {
          const baseUrl = stacApiUrlRef.current || process.env.REACT_APP_STAC_API_BASE_URL || 'http://localhost:8080';
          const currentLimit = itemLimitRef.current;
          const datetimeFilter = appliedDatetimeFilterRef.current;
          const url = buildItemsUrl(baseUrl, collection.id, currentLimit, datetimeFilter);
          console.log(`Fetching items from: ${url}`);
          
          const response = await fetch(url);
          if (response.ok) {
            const data = await response.json();
            console.log('Received items data:', data);
            
            // Capture search result counts
            const nr = data?.numberReturned;
            const nm = data?.numberMatched;
            setNumberReturned(nr != null ? nr : (Array.isArray(data.features) ? data.features.length : null));
            setNumberMatched(nm != null ? nm : null);
            try {
              const next = Array.isArray(data.links) ? data.links.find(l => l.rel === 'next' && l.href) : null;
              setNextLink(next?.href || null);
            } catch {}
            
            if (data.features && data.features.length > 0) {
              const items = processItems(data.features);
              
              console.log('Setting query items:', items);
              setQueryItems(items);
            } else {
              console.log('No features found in the response');
              setQueryItems([]);
              setNextLink(null);
            }
          } else {
            const errorText = await response.text();
            console.error(`Failed to fetch items (${response.status}):`, errorText);
            setQueryItems([]);
            setNextLink(null);
          }
        } catch (error) {
          console.error('Error fetching items:', error);
          setQueryItems([]);
          setNextLink(null);
        }
      };
      fetchItems();
    } else {
      console.log('No collection ID available to fetch items');
    }
  }, [collection]);

  const handleLoadNext = async (e) => {
    try {
      e?.stopPropagation?.();
      if (!nextLink || isLoadingNext) return;
      setIsLoadingNext(true);
      const resp = await fetch(nextLink, { method: 'GET' });
      if (!resp.ok) throw new Error(`Next page failed: ${resp.status}`);
      const data = await resp.json();
      const newItems = processItems(Array.isArray(data.features) ? data.features : []);
      setQueryItems(prev => {
        const merged = [...prev, ...newItems];
        try {
          window.dispatchEvent(new CustomEvent('showItemsOnMap', { detail: { items: merged } }));
        } catch {}
        return merged;
      });
      if (data.numberReturned != null) setNumberReturned(prev => prev + (data.numberReturned || 0));
      if (data.numberMatched != null) setNumberMatched(data.numberMatched);
      try {
        const next = Array.isArray(data.links) ? data.links.find(l => l.rel === 'next' && l.href) : null;
        setNextLink(next?.href || null);
      } catch {}
      setIsLoadingNext(false);
    } catch (err) {
      console.error('Error loading next page:', err);
      setIsLoadingNext(false);
    }
  };
  

  // Listen for bboxModeChanged event to update button state
  useEffect(() => {
    const handler = (event) => {
      const isOn = event?.detail?.isOn || false;
      setIsBboxModeOn(isOn);
    };
    window.addEventListener('bboxModeChanged', handler);
    return () => window.removeEventListener('bboxModeChanged', handler);
  }, []);

  // Listen for resetStacCollectionDetails event to reset state
  useEffect(() => {
    const handler = () => {
      console.log('🔄 Resetting StacCollectionDetails');
      setIsQueryItemsVisible(false);
      setQueryItems([]);
      setSelectedItemId(null);
      setNumberReturned(null);
      setNumberMatched(null);
      setItemLimit(10);
      setItemLimitDisplay('10');
    };
    window.addEventListener('resetStacCollectionDetails', handler);
    return () => window.removeEventListener('resetStacCollectionDetails', handler);
  }, []);

  // Listen for refetchQueryItems event to re-fetch with new limit
  useEffect(() => {
    const handler = async (event) => {
      try {
        const lim = Number(event?.detail?.limit);
        if (!Number.isFinite(lim) || lim <= 0) return;
        if (!collection || !collection.id) return;
        
        console.log('🔎 refetchQueryItems triggered with limit:', lim);
        const baseUrl = stacApiUrlRef.current || process.env.REACT_APP_STAC_API_BASE_URL || 'http://localhost:8080';
        const datetimeFilter = appliedDatetimeFilterRef.current;
        const url = buildItemsUrl(baseUrl, collection.id, lim, datetimeFilter);
        console.log('Fetching from:', url);
        
        const response = await fetch(url);
        console.log('Response status:', response.status, 'ok:', response.ok);
        if (response.ok) {
          const data = await response.json();
          console.log('Response data features count:', data.features?.length);
          
          // Capture search result counts (null-safe)
          const rr = data?.numberReturned;
          const rm = data?.numberMatched;
          setNumberReturned(rr != null ? rr : (Array.isArray(data.features) ? data.features.length : null));
          setNumberMatched(rm != null ? rm : null);
          try {
            const next = Array.isArray(data.links) ? data.links.find(l => l.rel === 'next' && l.href) : null;
            setNextLink(next?.href || null);
          } catch {}
          
          if (data.features && data.features.length > 0) {
            console.log('Processing', data.features.length, 'features');
            const items = processItems(data.features);
            console.log('🔎 Fetched', items.length, 'items');
            setQueryItems(items);
            setSelectedItemId(null);
            console.log('✅ Query items updated, now showing:', items.length);
            // Also update the map with the new items
            window.dispatchEvent(new CustomEvent('showItemsOnMap', { detail: { items } }));
          } else {
            console.warn('No features in response');
            setNextLink(null);
          }
        } else {
          console.error('Response not ok:', response.status);
          setNextLink(null);
        }
      } catch (err) {
        console.error('refetchQueryItems error:', err);
      }
    };
    window.addEventListener('refetchQueryItems', handler);
    return () => window.removeEventListener('refetchQueryItems', handler);
  }, [collection]);

  // Listen for showItemsOnMap event to capture search result counts and update items list
  useEffect(() => {
    const handler = (event) => {
      const numberReturned = event?.detail?.numberReturned;
      const numberMatched = event?.detail?.numberMatched;
      const items = event?.detail?.items;
      
      if (numberReturned !== undefined) {
        setNumberReturned(numberReturned);
      }
      if (numberMatched !== undefined) {
        setNumberMatched(numberMatched);
      }
      
      // Update query items list when bbox search returns results
      if (Array.isArray(items)) {
        const processedItems = processItems(items);
        setQueryItems(processedItems);
        console.log('Query items updated from showItemsOnMap event:', processedItems.length, 'items');
      }
    };
    window.addEventListener('showItemsOnMap', handler);
    return () => window.removeEventListener('showItemsOnMap', handler);
  }, []);

  // Listen for selectItem event from map clicks
  useEffect(() => {
    const handler = (event) => {
      const itemId = event?.detail?.itemId;
      if (itemId) {
        console.log('Selecting item from map click:', itemId);
        setSelectedItemId(itemId);
        setVisibleThumbnailItemId(null);
        
        // Scroll the selected item into view
        setTimeout(() => {
          const selectedElement = document.querySelector(`[data-item-id="${itemId}"]`);
          if (selectedElement) {
            selectedElement.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'nearest',
              inline: 'nearest' 
            });
          }
        }, 100); // Small delay to ensure DOM updates
      }
    };
    window.addEventListener('selectItem', handler);
    return () => window.removeEventListener('selectItem', handler);
  }, []);

  // Listen for updateNextLink event from bbox searches
  useEffect(() => {
    const handler = (event) => {
      const newNextLink = event?.detail?.nextLink;
      if (newNextLink) {
        setNextLink(newNextLink);
      }
    };
    window.addEventListener('updateNextLink', handler);
    return () => window.removeEventListener('updateNextLink', handler);
  }, []);
  const buildItemsUrl = (baseUrl, collectionId, limit, datetimeFilter) => {
    let url = `${baseUrl}/collections/${collectionId}/items?limit=${limit}`;
    if (datetimeFilter) {
      url += `&datetime=${encodeURIComponent(datetimeFilter)}`;
    }
    return url;
  };

  // Helper function to process items from API response
  const processItems = (features) => {
    return features.map(item => {
      let thumbnailUrl = null;
      let thumbnailType = null;
      console.log('🔍 Processing item:', item.id);
      console.log('   Assets:', Object.keys(item.assets || {}));
      try {
        const assets = item.assets || {};
        const assetsArr = Object.values(assets);
        
        // Step 1: Check for assets.thumbnail
        console.log('   Step 1 - Check assets.thumbnail:', !!assets.thumbnail);
        if (assets.thumbnail) {
          console.log('   assets.thumbnail object:', assets.thumbnail);
          console.log('   assets.thumbnail.href:', assets.thumbnail.href);
        }
        if (assets.thumbnail && assets.thumbnail.href) {
          thumbnailUrl = assets.thumbnail.href;
          thumbnailType = assets.thumbnail.type || null;
          console.log('   ✅ Found thumbnail in assets.thumbnail:', thumbnailUrl);
        }
        
        // Step 2: Search for asset with role 'thumbnail' and image type
        if (!thumbnailUrl) {
          console.log('   Step 2 - Search for thumbnail role with image type');
          const thumbAssetWeb = assetsArr.find(a => {
            const roles = Array.isArray(a.roles) ? a.roles : [];
            const type = (a.type || '').toLowerCase();
            return roles.includes('thumbnail') && (type.startsWith('image/jpeg') || type.startsWith('image/png'));
          });
          if (thumbAssetWeb) {
            thumbnailUrl = thumbAssetWeb.href;
            thumbnailType = thumbAssetWeb.type || null;
            console.log('   ✅ Found thumbnail with role and image type:', thumbnailUrl);
          }
        }
        
        // Step 3: Search for any asset with role 'thumbnail'
        if (!thumbnailUrl) {
          console.log('   Step 3 - Search for any thumbnail role');
          const thumbAny = assetsArr.find(a => {
            const roles = Array.isArray(a.roles) ? a.roles : [];
            return roles.includes('thumbnail') && a.href;
          });
          if (thumbAny) {
            thumbnailUrl = thumbAny.href;
            thumbnailType = thumbAny.type || null;
            console.log('   ✅ Found thumbnail with role:', thumbnailUrl);
          }
        }
        
        // Step 4: Check links for thumbnail
        if (!thumbnailUrl && Array.isArray(item.links)) {
          console.log('   Step 4 - Search links for thumbnail');
          const link = item.links.find(l => l.rel === 'thumbnail' || l.rel === 'preview');
          if (link && link.href) {
            thumbnailUrl = link.href;
            thumbnailType = link.type || null;
            console.log('   ✅ Found thumbnail in links:', thumbnailUrl);
          }
        }
        
        if (!thumbnailUrl) {
          console.log('   ❌ No thumbnail found after all steps');
        }
      } catch (e) {
        console.warn('Error extracting thumbnail:', e);
      }
      return {
        id: item.id,
        title: item.properties?.title || item.id,
        geometry: item.geometry || null,
        bbox: item.bbox || null,
        thumbnailUrl,
        thumbnailType,
        datetime: item.properties?.datetime || item.properties?.start_datetime || null,
        assetsCount: Object.keys(item.assets || {}).length,
        assets: item.assets || {} // Keep raw assets for fallback
      };
    });
  };

  if (!collection) return null;

  const bbox = collection.extent?.spatial?.bbox?.[0];
  const hasValidBbox = bbox && bbox.length === 4;

  // Extract temporal extent
  const temporalExtent = collection.extent?.temporal?.interval?.[0];
  const hasValidTemporalExtent = temporalExtent && temporalExtent.length === 2;
  const startTime = temporalExtent?.[0];
  const endTime = temporalExtent?.[1];

  const handleZoomToBbox = () => {
    if (hasValidBbox && onZoomToBbox) {
      onZoomToBbox(bbox);
    }
  };

  const handleDescriptionClick = () => {
    setIsDescriptionExpanded(!isDescriptionExpanded);
    if (isBoundingBoxVisible) {
      setIsBoundingBoxVisible(false);
    }
    if (isTemporalExtentVisible) {
      setIsTemporalExtentVisible(false);
    }
    if (isQueryItemsVisible) {
      setIsQueryItemsVisible(false);
    }
  };

  const handleBoundingBoxClick = () => {
    setIsBoundingBoxVisible(!isBoundingBoxVisible);
    if (isDescriptionExpanded) {
      setIsDescriptionExpanded(false);
    }
    if (isTemporalExtentVisible) {
      setIsTemporalExtentVisible(false);
    }
    if (isQueryItemsVisible) {
      setIsQueryItemsVisible(false);
    }
  };

  const handleTemporalExtentClick = () => {
    setIsTemporalExtentVisible(!isTemporalExtentVisible);
    if (isDescriptionExpanded) {
      setIsDescriptionExpanded(false);
    }
    if (isBoundingBoxVisible) {
      setIsBoundingBoxVisible(false);
    }
    if (isQueryItemsVisible) {
      setIsQueryItemsVisible(false);
    }
  };

  const handleQueryItemsClick = () => {
    const newIsExpanded = !isQueryItemsVisible;
    console.log('handleQueryItemsClick called, newIsExpanded:', newIsExpanded);
    
    // Update the expanded state
    setIsQueryItemsVisible(newIsExpanded);
    
    // Collapse other sections
    if (isDescriptionExpanded) setIsDescriptionExpanded(false);
    if (isBoundingBoxVisible) setIsBoundingBoxVisible(false);
    
    // Only proceed if we're expanding and have items
    if (newIsExpanded && queryItems.length > 0) {
      console.log('Query items expanded, items:', queryItems);
      
      // Calculate bounding box that encompasses all items
      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      let hasBbox = false;
      
      queryItems.forEach(item => {
        if (item.bbox && item.bbox.length === 4) {
          hasBbox = true;
          minLon = Math.min(minLon, item.bbox[0]);
          minLat = Math.min(minLat, item.bbox[1]);
          maxLon = Math.max(maxLon, item.bbox[2]);
          maxLat = Math.max(maxLat, item.bbox[3]);
        }
      });
      
      if (hasBbox) {
        const combinedBbox = [minLon, minLat, maxLon, maxLat];
        console.log('Zooming to combined bbox:', combinedBbox);
        
        // Create and dispatch the zoom event
        const zoomEvent = new CustomEvent('zoomToBbox', { 
          detail: { 
            bbox: combinedBbox,
            options: {
              padding: 50,
              maxZoom: 14,
              essential: true  // Make this animation essential
            }
          } 
        });
        
        // Log before dispatching
        console.log('Dispatching zoomToBbox event:', zoomEvent);
        window.dispatchEvent(zoomEvent);
      }
      
      // Always call onShowItemsOnMap when there are items
      if (onShowItemsOnMap) {
        console.log('Calling onShowItemsOnMap with items');
        onShowItemsOnMap(queryItems);
      }
    }
  };

  const handleItemClick = (item) => {
    console.log('Item clicked:', item);
    // Close any open overlays when selecting an item
    try {
      window.dispatchEvent(new CustomEvent('hideOverlays'));
      window.dispatchEvent(new CustomEvent('hideMapThumbnail'));
    } catch (err) {
      console.warn('Failed to dispatch hideOverlays on item click:', err);
    }
    setSelectedItemId(item.id);
    setVisibleThumbnailItemId(null);
    
    // Show only this item on the map
    if (onShowItemsOnMap) {
      console.log('Showing single item on map:', item);
      onShowItemsOnMap([item]);
    }
    
    // Zoom to the item's bbox if available with better zoom level
    if (item.bbox) {
      const zoomEvent = new CustomEvent('zoomToBbox', { 
        detail: { 
          bbox: item.bbox,
          options: {
            padding: 50,
            maxZoom: 18,
            essential: true
          }
        } 
      });
      console.log('Zooming to item bbox:', item.bbox);
      window.dispatchEvent(zoomEvent);
    }
  };

  const handleEyeButtonClick = (e, item) => {
    e.stopPropagation();
    
    console.log('👁 Eye button clicked for item:', item.id);
    
    // Toggle thumbnail visibility for this item
    if (visibleThumbnailItemId === item.id) {
      // Hide thumbnail
      setVisibleThumbnailItemId(null);
      window.dispatchEvent(new CustomEvent('hideOverlays'));
      window.dispatchEvent(new CustomEvent('hideMapThumbnail'));
      // Show all items again
      if (onShowItemsOnMap) {
        console.log('Showing all query items on map');
        onShowItemsOnMap(queryItems);
      }
    } else {
      // Show thumbnail
      setVisibleThumbnailItemId(item.id);
      
      // Extract thumbnail URL - try multiple sources
      let thumbnailUrl = null;
      let thumbnailType = null;
      
      // Try 1: Check assets.thumbnail
      if (item.assets && item.assets.thumbnail && item.assets.thumbnail.href) {
        thumbnailUrl = item.assets.thumbnail.href;
        thumbnailType = item.assets.thumbnail.type;
        console.log('✅ Found thumbnail in assets.thumbnail:', thumbnailUrl);
      }
      
      // Try 2: Search for any asset with role 'thumbnail'
      if (!thumbnailUrl && item.assets) {
        const thumbAsset = Object.values(item.assets).find(a => 
          Array.isArray(a.roles) && a.roles.includes('thumbnail') && a.href
        );
        if (thumbAsset) {
          thumbnailUrl = thumbAsset.href;
          thumbnailType = thumbAsset.type;
          console.log('✅ Found thumbnail in assets with role:', thumbnailUrl);
        }
      }
      
      // Try 3: Check links for thumbnail
      if (!thumbnailUrl && item.links) {
        const thumbLink = item.links.find(l => 
          (l.rel === 'thumbnail' || l.rel === 'preview') && l.href
        );
        if (thumbLink) {
          thumbnailUrl = thumbLink.href;
          thumbnailType = thumbLink.type;
          console.log('✅ Found thumbnail in links:', thumbnailUrl);
        }
      }
      
      console.log('🖼️ Thumbnail URL for item', item.id, ':', thumbnailUrl);
      
      // Clear the item geometries from the map to hide the red square
      window.dispatchEvent(new CustomEvent('clearItemGeometries'));
      
      // Dispatch the thumbnail event - this will show the overlay
      const thumbEvent = new CustomEvent('showItemThumbnail', {
        detail: {
          url: thumbnailUrl || null,
          title: item.title || item.id,
          type: thumbnailType || null
        }
      });
      console.log('Dispatching showItemThumbnail event');
      window.dispatchEvent(thumbEvent);

      // Show thumbnail on map if available and has geometry
      if (item.thumbnailUrl && item.geometry) {
        const mapThumbEvent = new CustomEvent('showMapThumbnail', {
          detail: {
            geometry: item.geometry,
            url: item.thumbnailUrl,
            title: item.title || item.id,
            type: item.thumbnailType || null
          }
        });
        console.log('Dispatching showMapThumbnail with geometry:', item.geometry);
        window.dispatchEvent(mapThumbEvent);
      }
    }
  };

  const handleDownloadFeatureCollection = async () => {
    try {
      console.log('Starting download of feature collection...');

      // Check if we have items to download
      if (!queryItems || queryItems.length === 0) {
        alert('No data to download. Please query some items first.');
        return;
      }

      console.log('Reconstructing GeoJSON from', queryItems.length, 'processed items');

      // Reconstruct GeoJSON FeatureCollection from processed items
      const features = queryItems.map(item => ({
        type: 'Feature',
        id: item.id,
        geometry: item.geometry,
        bbox: item.bbox,
        properties: {
          datetime: item.datetime,
          title: item.title
        },
        assets: item.assets || {},
        links: item.links || []
      }));

      const geojsonData = {
        type: 'FeatureCollection',
        features: features,
        numberReturned: features.length,
        numberMatched: numberMatched || features.length
      };

      // Create filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const collectionName = collection.id.replace(/[^a-zA-Z0-9-_]/g, '_');
      const filename = `${collectionName}_items_${timestamp}.geojson`;

      // Create and download the file
      const blob = new Blob([JSON.stringify(geojsonData, null, 2)], { type: 'application/geo+json' });
      const url_blob = URL.createObjectURL(blob);

      console.log('Created blob URL:', url_blob);
      console.log('Filename:', filename);

      const link = document.createElement('a');
      link.href = url_blob;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url_blob);
      console.log('Download completed:', filename);

      alert(`Downloaded ${features.length} items to ${filename}`);

    } catch (error) {
      console.error('Error downloading feature collection:', error);
      alert(`Failed to download feature collection: ${error.message}`);
    }
  };

  return (
    <>
      {hasValidTemporalExtent && (
        <div className="temporal-extent" onClick={handleTemporalExtentClick}>
          <button 
            className="stac-expand-btn"
            title={isTemporalExtentVisible ? "Hide temporal extent" : "Show temporal extent"}
          >
            <span className="expand-arrow">{isTemporalExtentVisible ? '◀' : '▶'}</span>
            <span className="expand-label">
              Temporal Range
              {startTime && endTime && (
                <span className="temporal-range-bracket">
                  ({new Date(startTime).toLocaleDateString()} / {new Date(endTime).toLocaleDateString()})
                </span>
              )}
            </span>
          </button>
          {isTemporalExtentVisible && (
            <div className="stac-details-expanded">
              <div className="temporal-extent-content">
                <div className="temporal-extent-item">
                  <span className="temporal-extent-key">Start:</span>
                  <span className="temporal-extent-value">{new Date(startTime).toLocaleString()}</span>
                </div>
                <div className="temporal-extent-item">
                  <span className="temporal-extent-key">End:</span>
                  <span className="temporal-extent-value">{new Date(endTime).toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      <div className="description" onClick={handleDescriptionClick}>
        <button 
          className="stac-expand-btn"
          title={isDescriptionExpanded ? "Hide details" : "Show details"}
        >
          <span className="expand-arrow">{isDescriptionExpanded ? '◀' : '▶'}</span>
          <span className="expand-label">Description</span>
        </button>
        {isDescriptionExpanded && (
          <div className="stac-details-expanded">
            <h4>{collection.title || collection.id}</h4>
            <p>{collection.description}</p>
          </div>
        )}
      </div>

      <div className="bounding-box" onClick={handleBoundingBoxClick}>
        <button 
          className="stac-expand-btn"
          title={isBoundingBoxVisible ? "Hide spatial extent" : "Show spatial extent"}
        >
          <span className="expand-arrow">{isBoundingBoxVisible ? '◀' : '▶'}</span>
          <span className="expand-label">Spatial Extent</span>
        </button>
        {isBoundingBoxVisible && hasValidBbox && (
          <div className="stac-details-expanded">
            <h4>Bounding Box</h4>
            <p>
              <strong>W:</strong> {bbox[0].toFixed(4)}°
              <strong> S:</strong> {bbox[1].toFixed(4)}°
              <strong> E:</strong> {bbox[2].toFixed(4)}°
              <strong> N:</strong> {bbox[3].toFixed(4)}°
            </p>
            <button 
              className="stac-zoom-btn"
              onClick={handleZoomToBbox}
            >
              Zoom to Area
            </button>
          </div>
        )}
      </div>

      
      <div className="query-items">
        <button 
          className="stac-expand-btn"
          title={isQueryItemsVisible ? "Hide query items" : "Show query items"}
          onClick={handleQueryItemsClick}
        >
          <span className="expand-arrow">{isQueryItemsVisible ? '◀' : '▶'}</span>
          <span className="expand-label">
            Query Items
            {(numberReturned !== null || numberMatched !== null) && (
              <span className="query-items-count">
                ({numberReturned !== null ? numberReturned : '?'}/{numberMatched !== null ? numberMatched : 'Not provided'})
              </span>
            )}
          </span>
        </button>
        {isQueryItemsVisible && (
          <div className="stac-details-expanded">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div>
                <h4 style={{ margin: '0 0 5px 0' }}>Query Items</h4>
                {(numberReturned !== null || numberMatched !== null) && (
                  <p className="query-items-results">
                    {numberReturned !== null && numberMatched !== null
                      ? `Returned: ${numberReturned} / Matched: ${numberMatched}`
                      : numberReturned !== null
                      ? `Returned: ${numberReturned} / Matched: Not provided`
                      : numberMatched !== null
                      ? `Matched: ${numberMatched}`
                      : ''}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="search-btn"
                  title="Search (bbox if drawn, else query items)"
                  aria-label="Search"
                  onClick={(e) => {
                    e.stopPropagation();
                    try {
                      window.dispatchEvent(new CustomEvent('runSearch', { detail: { limit: itemLimit } }));
                    } catch (err) {
                      console.warn('Failed to dispatch runSearch:', err);
                    }
                  }}
                >
                  🔎
                </button>
                <button
                  type="button"
                  className="download-btn"
                  title="Download feature collection as GeoJSON"
                  aria-label="Download feature collection"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownloadFeatureCollection();
                  }}
                >
                  ⬇️
                </button>
                <button
                  type="button"
                  className="bbox-btn"
                  disabled={!nextLink || isLoadingNext}
                  title={nextLink ? 'Load next page' : 'No more pages'}
                  aria-label="Load next page"
                  onClick={handleLoadNext}
                >
                  Next ▶
                </button>
              </div>
            </div>
            <div className="limit-input-container">
              <label htmlFor="item-limit">Limit:</label>
              <input 
                id="item-limit"
                className="limit-input"
                type="text" 
                inputMode="numeric"
                pattern="[0-9]*"
                value={itemLimitDisplay} 
                onChange={(e) => {
                  const value = e.target.value;
                  // Allow empty string or valid digit sequences
                  if (value === '' || /^\d+$/.test(value)) {
                    setItemLimitDisplay(value);
                  }
                }}
                onBlur={() => {
                  // On blur, validate and commit the value
                  if (itemLimitDisplay === '' || !/^\d+$/.test(itemLimitDisplay)) {
                    // Reset to current valid value
                    setItemLimitDisplay(itemLimit.toString());
                  } else {
                    // Commit valid number, clamped to range
                    const numValue = Math.min(200, Math.max(1, parseInt(itemLimitDisplay, 10)));
                    setItemLimit(numValue);
                    setItemLimitDisplay(numValue.toString());
                    try {
                      window.dispatchEvent(new CustomEvent('itemLimitChanged', { detail: { limit: numValue } }));
                    } catch (err) {
                      console.warn('Failed to dispatch itemLimitChanged:', err);
                    }
                  }
                }}
              />
              <button
                type="button"
                className={`bbox-btn ${isBboxModeOn ? 'bbox-on' : 'bbox-off'}`}
                title="Toggle BBox draw mode"
                aria-label="Toggle BBox draw mode"
                onClick={(e) => {
                  e.stopPropagation();
                  try {
                    window.dispatchEvent(new CustomEvent('toggleBboxSearch'));
                  } catch (err) {
                    console.warn('Failed to dispatch toggleBboxSearch:', err);
                  }
                }}
              >
                BBOX
              </button>
              <button
                type="button"
                className={`datetime-btn ${appliedDatetimeFilter ? 'datetime-active' : 'datetime-inactive'}`}
                title={appliedDatetimeFilter ? `Filter active: ${appliedDatetimeFilter}` : "Filter by datetime"}
                aria-label={appliedDatetimeFilter ? `Filter active: ${appliedDatetimeFilter}` : "Filter by datetime"}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDatetimePickerOpen(!isDatetimePickerOpen);
                }}
              >
                📅
              </button>
            </div>
            {queryItems.length > 0 ? (
              <ul>
                {queryItems.map(item => (
                  <li 
                    key={item.id}
                    data-item-id={item.id}
                    className={`item-list-item ${selectedItemId === item.id ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleItemClick(item);
                    }}
                  >
                    <span className="item-title">{item.title}</span>
                    <button
                      className={`preview-btn ${visibleThumbnailItemId === item.id ? 'active' : ''}`}
                      title={visibleThumbnailItemId === item.id ? 'Hide thumbnail' : 'Show thumbnail'}
                      aria-label={visibleThumbnailItemId === item.id ? 'Hide thumbnail' : 'Show thumbnail'}
                      onClick={(e) => handleEyeButtonClick(e, item)}
                    >
                      👁
                    </button>
                    <button
                      className="details-btn"
                      title="Show item details"
                      aria-label="Show item details"
                      onClick={(e) => {
                        e.stopPropagation();
                        const detailsEvent = new CustomEvent('showItemDetails', {
                          detail: {
                            id: item.id,
                            title: item.title,
                            datetime: item.datetime || null,
                            assetsCount: item.assetsCount || 0,
                            bbox: item.bbox || null
                          }
                        });
                        window.dispatchEvent(detailsEvent);
                      }}
                    >
                      📄
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No items found for this collection.</p>
            )}
          </div>
        )}
      </div>
      {isDatetimePickerOpen && (
        <div className="datetime-filter-box">
          <div className="datetime-filter-header">
            <h3>Filter by Date</h3>
            <button 
              className="datetime-filter-close"
              onClick={() => setIsDatetimePickerOpen(false)}
              aria-label="Close datetime filter"
            >
              ✕
            </button>
          </div>
          <div className="datetime-filter-content">
            <div className="datetime-filter-group">
              <label htmlFor="start-date">Start Date:</label>
              <input
                id="start-date"
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="datetime-filter-group">
              <label htmlFor="end-date">End Date:</label>
              <input
                id="end-date"
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="datetime-filter-buttons">
              <button
                type="button"
                className="datetime-apply-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  // Build datetime filter string in STAC format: start/end
                  // Convert datetime-local format to ISO 8601 with Z suffix
                  const formatDatetime = (dt) => {
                    if (!dt) return null;
                    // datetime-local format: "2025-01-15T10:30" -> ISO 8601: "2025-01-15T10:30:00Z"
                    return dt.includes('T') ? `${dt}:00Z` : `${dt}T00:00:00Z`;
                  };
                  
                  let datetimeFilter = '';
                  const formattedStart = formatDatetime(startDate);
                  const formattedEnd = formatDatetime(endDate);
                  
                  if (formattedStart && formattedEnd) {
                    datetimeFilter = `${formattedStart}/${formattedEnd}`;
                  } else if (formattedStart) {
                    // Open-ended range: from start date to year 2200
                    datetimeFilter = `${formattedStart}/2200-12-31T23:59:59Z`;
                  } else if (formattedEnd) {
                    // Open-ended range: from year 1800 to end date
                    datetimeFilter = `1800-01-01T00:00:00Z/${formattedEnd}`;
                  } else {
                    // If neither start nor end date is selected, don't apply any filter
                    datetimeFilter = '';
                  }
                  
                  console.log('Datetime filter applied:', { startDate, endDate, formattedStart, formattedEnd, datetimeFilter });
                  setAppliedDatetimeFilter(datetimeFilter);
                  setIsDatetimePickerOpen(false);
                  // Dispatch event so SFEOSMap can use the datetime filter in bbox searches
                  window.dispatchEvent(new CustomEvent('datetimeFilterChanged', { detail: { datetimeFilter } }));
                  // Trigger refetch with the new datetime filter
                  window.dispatchEvent(new CustomEvent('refetchQueryItems', { detail: { limit: itemLimitRef.current } }));
                }}
              >
                Apply
              </button>
              <button
                type="button"
                className="datetime-clear-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setStartDate('');
                  setEndDate('');
                  setAppliedDatetimeFilter('');
                  // Dispatch event so SFEOSMap knows the datetime filter was cleared
                  window.dispatchEvent(new CustomEvent('datetimeFilterChanged', { detail: { datetimeFilter: '' } }));
                  // Trigger refetch without datetime filter
                  window.dispatchEvent(new CustomEvent('refetchQueryItems', { detail: { limit: itemLimitRef.current } }));
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default StacCollectionDetails;
