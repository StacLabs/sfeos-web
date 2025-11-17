import React, { useState, useEffect, useRef, useCallback } from 'react';
import './StacCollectionDetails.css';
import './QueryItems.css';
import LoadingIndicator from '../common/LoadingIndicator';

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
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [appliedDatetimeFilter, setAppliedDatetimeFilter] = useState('');
  const [cloudCoverMax, setCloudCoverMax] = useState(100);
  const [appliedCloudCoverFilter, setAppliedCloudCoverFilter] = useState('');
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [hasPerformedSearch, setHasPerformedSearch] = useState(false);
  const prevCollectionId = useRef(null);
  const stacApiUrlRef = useRef(stacApiUrl);
  const itemLimitRef = useRef(itemLimit);
  const appliedDatetimeFilterRef = useRef('');
  const appliedCloudCoverFilterRef = useRef('');

  // Helper function to extract thumbnail from item
  const extractThumbnail = (item) => {
    let thumbnailUrl = null;
    let thumbnailType = null;
    try {
      const assets = item.assets || {};
      const assetsArr = Object.values(assets);
      
      // Step 1: Check for assets.thumbnail
      if (assets.thumbnail && assets.thumbnail.href) {
        thumbnailUrl = assets.thumbnail.href;
        thumbnailType = assets.thumbnail.type || null;
      }
      
      // Step 2: Search for asset with role 'thumbnail' and image type
      if (!thumbnailUrl) {
        const thumbAssetWeb = assetsArr.find(a => {
          const roles = Array.isArray(a.roles) ? a.roles : [];
          const type = (a.type || '').toLowerCase();
          return roles.includes('thumbnail') && (type.startsWith('image/jpeg') || type.startsWith('image/png'));
        });
        if (thumbAssetWeb) {
          thumbnailUrl = thumbAssetWeb.href;
          thumbnailType = thumbAssetWeb.type || null;
        }
      }
      
      // Step 3: Search for any asset with role 'thumbnail'
      if (!thumbnailUrl) {
        const thumbAny = assetsArr.find(a => {
          const roles = Array.isArray(a.roles) ? a.roles : [];
          return roles.includes('thumbnail') && a.href;
        });
        if (thumbAny) {
          thumbnailUrl = thumbAny.href;
          thumbnailType = thumbAny.type || null;
        }
      }
      
      // Step 4: Check links for thumbnail
      if (!thumbnailUrl && Array.isArray(item.links)) {
        const link = item.links.find(l => l.rel === 'thumbnail' || l.rel === 'preview');
        if (link && link.href) {
          thumbnailUrl = link.href;
          thumbnailType = link.type || null;
        }
      }
    } catch (e) {
      // Silently fail if thumbnail extraction fails
    }
    return { thumbnailUrl, thumbnailType };
  };

  // Helper function to process items from API response
  const processItems = useCallback((features) => {
    return features.map(item => {
      const { thumbnailUrl, thumbnailType } = extractThumbnail(item);
      return {
        id: item.id,
        title: item.properties?.title || item.id,
        geometry: item.geometry || null,
        bbox: item.bbox || null,
        thumbnailUrl,
        thumbnailType,
        datetime: item.properties?.datetime || item.properties?.start_datetime || null,
        assetsCount: Object.keys(item.assets || {}).length,
        assets: item.assets || {},
        collection: item.collection || null,
        properties: item.properties || {}
      };
    });
  }, []);

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
    const currentCollectionId = collection?.id || null;
    if (prevCollectionId.current !== currentCollectionId) {
      prevCollectionId.current = currentCollectionId;

      // Reset state when collection changes or when switching to "All Collections"
      setIsQueryItemsVisible(false);
      setItemLimit(10);
      setItemLimitDisplay('10');
      setQueryItems([]);
      setSelectedItemId(null);
      setIsDescriptionExpanded(false);
      setIsBoundingBoxVisible(false);
      setNumberReturned(null);
      setNumberMatched(null);
      setHasPerformedSearch(false);

      // Clear any map overlays/geometries related to the previous collection
      try {
        window.dispatchEvent(new CustomEvent('clearItemGeometries'));
      } catch (err) {
        console.warn('Failed to dispatch clearItemGeometries on collection change:', err);
      }
      // Abort pending searches and clear cached results on the map
      try {
        window.dispatchEvent(new CustomEvent('clearSearchCache'));
      } catch (err) {
        console.warn('Failed to dispatch clearSearchCache on collection change:', err);
      }
    }
  }, [collection, stacApiUrl]);

  // Removed automatic fetching on collection change; items load only via explicit query

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
        // Filter out duplicates by ID
        const existingIds = new Set(prev.map(item => item.id));
        const uniqueNewItems = newItems.filter(item => !existingIds.has(item.id));
        const merged = [...prev, ...uniqueNewItems];
        try {
          window.dispatchEvent(new CustomEvent('showItemsOnMap', { detail: { items: merged } }));
        } catch {}
        return merged;
      });
      // Update numberReturned to reflect total items loaded so far
      setNumberReturned(prev => prev + (data.numberReturned || newItems.length));
      if (data.numberMatched != null) setNumberMatched(data.numberMatched);
      try {
        const next = Array.isArray(data.links) ? data.links.find(l => l.rel === 'next' && l.href) : null;
        setNextLink(next?.href || null);
      } catch {}
      setIsLoadingNext(false);
    } catch (err) {
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
      setIsQueryItemsVisible(false);
      setQueryItems([]);
      setSelectedItemId(null);
      setNumberReturned(null);
      setNumberMatched(null);
      setItemLimit(10);
      setItemLimitDisplay('10');
      setHasPerformedSearch(false);
    };
    window.addEventListener('resetStacCollectionDetails', handler);
    return () => window.removeEventListener('resetStacCollectionDetails', handler);
  }, []);

  // Listen for refetchQueryItems event to re-fetch with new limit
  useEffect(() => {
    const handler = async (event) => {
      try {
        const lim = Number(event?.detail?.limit || itemLimitRef.current);
        if (!Number.isFinite(lim) || lim <= 0) return;
        
        setIsLoadingItems(true);
        
        const baseUrl = stacApiUrlRef.current || process.env.REACT_APP_STAC_API_BASE_URL || 'http://localhost:8080';
        const datetimeFilter = appliedDatetimeFilterRef.current;
        const cloudCoverFilter = appliedCloudCoverFilterRef.current;
        
        let url;
        if (collection && collection.id) {
          // Regular collection-specific search
          url = buildItemsUrl(baseUrl, collection.id, lim, datetimeFilter, cloudCoverFilter);
        } else {
          // All Collections search
          url = `${baseUrl}/search?limit=${lim}`;
          if (datetimeFilter) {
            url += `&datetime=${encodeURIComponent(datetimeFilter)}`;
          }
          if (cloudCoverFilter) {
            url += `&query=${encodeURIComponent(cloudCoverFilter)}`;
          }
        }
        
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          
          captureSearchCounts(data);
          extractNextLink(data);
          
          if (data.features && data.features.length > 0) {
            const items = processItems(data.features);
            setQueryItems(items);
            setSelectedItemId(null);
            // Also update the map with the new items
            window.dispatchEvent(new CustomEvent('showItemsOnMap', { detail: { items } }));
          }
        } else {
          handleFetchError(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (err) {
        handleFetchError(err.message || 'Unknown error');
      } finally {
        setIsLoadingItems(false);
      }
    };
    window.addEventListener('refetchQueryItems', handler);
    return () => window.removeEventListener('refetchQueryItems', handler);
  }, [collection, processItems]);

  // Listen for runSearch event to show loading indicator
  useEffect(() => {
    const handler = () => {
      setIsLoadingItems(true);
    };
    window.addEventListener('runSearch', handler);
    return () => window.removeEventListener('runSearch', handler);
  }, []);

  // Listen for datetimeFilterChanged event to show loading indicator
  useEffect(() => {
    const handler = () => {
      setIsLoadingItems(true);
    };
    window.addEventListener('datetimeFilterChanged', handler);
    return () => window.removeEventListener('datetimeFilterChanged', handler);
  }, []);

  // Listen for cloudCoverFilterChanged event to show loading indicator
  useEffect(() => {
    const handler = () => {
      setIsLoadingItems(true);
    };
    window.addEventListener('cloudCoverFilterChanged', handler);
    return () => window.removeEventListener('cloudCoverFilterChanged', handler);
  }, []);

  // Listen for showItemsOnMap event to update the items list and hide loading indicator
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
      
      // Update query items list when items are received
      if (Array.isArray(items)) {
        // Always use the items as-is since they should already be processed
        const processedItems = items;
        setQueryItems(processedItems);
        setHasPerformedSearch(true);
      }
      
      // Always hide loading indicator when we get results
      setIsLoadingItems(false);
    };
    window.addEventListener('showItemsOnMap', handler);
    return () => window.removeEventListener('showItemsOnMap', handler);
  }, []);

  // Listen for selectItem event from map clicks
  useEffect(() => {
    const handler = (event) => {
      const itemId = event?.detail?.itemId;
      if (itemId) {
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

  const handleDownloadFeatureCollection = async () => {
    try {
      // Check if we have items to download
      if (!queryItems || queryItems.length === 0) {
        alert('No data to download. Please query some items first.');
        return;
      }

      // Include complete STAC item data without filtering
      const features = queryItems.map(item => ({
        type: 'Feature',
        id: item.id,
        geometry: item.geometry,
        bbox: item.bbox,
        properties: item.properties || {},
        assets: item.assets || {},
        links: item.links || [],
        collection: item.collection,
        stac_version: item.stac_version,
        stac_extensions: item.stac_extensions
      }));

      const geojsonData = {
        type: 'FeatureCollection',
        features: features,
        numberReturned: features.length,
        numberMatched: numberMatched || features.length
      };

      // Create filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const collectionName = collection ? collection.id.replace(/[^a-zA-Z0-9-_]/g, '_') : 'all_collections';
      const filename = `${collectionName}_items_${timestamp}.geojson`;

      // Create and download the file
      const blob = new Blob([JSON.stringify(geojsonData, null, 2)], { type: 'application/geo+json' });
      const url_blob = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url_blob;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url_blob);

      alert(`Downloaded ${features.length} items to ${filename}`);

    } catch (error) {
      alert(`Failed to download feature collection: ${error.message}`);
    }
  };

  const buildItemsUrl = (baseUrl, collectionId, limit, datetimeFilter, cloudCoverFilter) => {
    let url = `${baseUrl}/collections/${collectionId}/items?limit=${limit}`;
    if (datetimeFilter) {
      url += `&datetime=${encodeURIComponent(datetimeFilter)}`;
    }
    if (cloudCoverFilter) {
      url += `&query=${encodeURIComponent(cloudCoverFilter)}`;
    }
    return url;
  };

  // Helper function to format datetime for STAC API
  const formatDatetime = (dt) => {
    if (!dt) return null;
    // datetime-local format: "2025-01-15T10:30" -> ISO 8601: "2025-01-15T10:30:00Z"
    return dt.includes('T') ? `${dt}:00Z` : `${dt}T00:00:00Z`;
  };

  // Helper function to build datetime filter string
  const buildDatetimeFilter = (startDate, endDate) => {
    const formattedStart = formatDatetime(startDate);
    const formattedEnd = formatDatetime(endDate);
    
    if (formattedStart && formattedEnd) {
      return `${formattedStart}/${formattedEnd}`;
    } else if (formattedStart) {
      return `${formattedStart}/2200-12-31T23:59:59Z`;
    } else if (formattedEnd) {
      return `1800-01-01T00:00:00Z/${formattedEnd}`;
    }
    return '';
  };

  // Helper function to build cloud cover filter query string
  const buildCloudCoverFilter = (maxCloudCover) => {
    if (maxCloudCover === null || maxCloudCover === undefined || maxCloudCover === 100) {
      return '';
    }
    // Return STAC query format for cloud cover - direct property filter
    return JSON.stringify({ 'eo:cloud_cover': { 'lte': maxCloudCover } });
  };

  // Helper function to extract and set search result counts from API response
  const captureSearchCounts = (data) => {
    const nr = data?.numberReturned;
    const nm = data?.numberMatched;
    setNumberReturned(nr != null ? nr : (Array.isArray(data.features) ? data.features.length : null));
    setNumberMatched(nm != null ? nm : null);
  };

  // Helper function to extract next link from API response
  const extractNextLink = (data) => {
    try {
      const next = Array.isArray(data.links) ? data.links.find(l => l.rel === 'next' && l.href) : null;
      setNextLink(next?.href || null);
    } catch {}
  };

  // Helper function to handle fetch errors
  const handleFetchError = (errorMessage = '') => {
    console.error('Error fetching items:', errorMessage || 'Unknown error');
    setQueryItems([]);
    setNextLink(null);
    setNumberReturned(0);
    setNumberMatched(0);
    setIsLoadingItems(false);
    setIsLoadingNext(false);
  };

  // Handler for All Collections mode query items expand/collapse
  const handleAllCollectionsQueryItemsClick = () => {
    const newIsExpanded = !isQueryItemsVisible;
    
    setIsQueryItemsVisible(newIsExpanded);
    
    // Only proceed if we're expanding and have items
    if (newIsExpanded && queryItems.length > 0) {
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
        
        window.dispatchEvent(zoomEvent);
      }
      
      // Always call onShowItemsOnMap when there are items
      if (onShowItemsOnMap) {
        onShowItemsOnMap(queryItems);
      }
    }
  };

  if (!collection) {
    // "All Collections" mode - show simplified interface focused on query items
    return (
      <>
      {isLoadingItems && <LoadingIndicator message="Loading items..." />}
      {isLoadingNext && <LoadingIndicator message="Loading next page..." />}
      <div className="query-items">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              className="stac-expand-btn"
              onClick={handleAllCollectionsQueryItemsClick}
              disabled={isLoadingItems}
            >
              <span className="expand-label">
                All Collections Query
                {(numberReturned !== null || numberMatched !== null) && (
                  <span className="query-items-count">
                    ({numberReturned !== null ? numberReturned : '?'}/{numberMatched !== null ? numberMatched : 'Not provided'})
                  </span>
                )}
              </span>
              <span className="expand-arrow">{isQueryItemsVisible ? '▼' : '▶'}</span>
            </button>
          </div>
          {isQueryItemsVisible && (
            <div className="stac-details-expanded">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div>
                  <h4 style={{ margin: '0 0 5px 0' }}>Query All Collections</h4>
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
                      window.dispatchEvent(new CustomEvent('downloadFullResults'));
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
                      const numValue = Math.min(1000, Math.max(1, parseInt(itemLimitDisplay, 10)));
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
                  className={`datetime-btn ${appliedDatetimeFilter || appliedCloudCoverFilter ? 'datetime-active' : 'datetime-inactive'}`}
                  title="Open filters (datetime & cloud cover)"
                  aria-label="Open filters"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsFilterOpen(!isFilterOpen);
                  }}
                >
                  Filter
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
                              bbox: item.bbox || null,
                              collection: item.collection || null,
                              properties: item.properties || {}
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
                hasPerformedSearch ? (
                  <p>No items found across all collections.</p>
                ) : (
                  <p style={{ fontStyle: 'italic', color: '#888', margin: '10px 0' }}>
                    Click the 🔎 search button to find items across all collections.
                  </p>
                )
              )}
            {isFilterOpen && (
              <div className="datetime-filter-box">
                <div className="datetime-filter-header">
                  <h3>Filters</h3>
                  <button 
                    className="datetime-filter-close"
                    onClick={() => setIsFilterOpen(false)}
                    aria-label="Close filters"
                  >
                    ✕
                  </button>
                </div>
                <div className="datetime-filter-content">
                  {/* Datetime Filter Section */}
                  <div style={{ marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid #ddd' }}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.65rem', fontWeight: '400', color: '#666', textAlign: 'left' }}>Date Range</h4>
                    <div className="datetime-filter-group">
                      <label htmlFor="start-date">Start Date:</label>
                      <input
                        id="start-date"
                        type="datetime-local"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        style={{ maxWidth: '200px' }}
                      />
                    </div>
                    <div className="datetime-filter-group" style={{ marginTop: '8px' }}>
                      <label htmlFor="end-date">End Date:</label>
                      <input
                        id="end-date"
                        type="datetime-local"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        style={{ maxWidth: '200px' }}
                      />
                    </div>
                  </div>

                  {/* Cloud Cover Filter Section */}
                  <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ margin: '0 0 2px 0', fontSize: '0.65rem', fontWeight: '400', color: '#666', textAlign: 'left' }}>Cloud Cover</h4>
                    <div className="datetime-filter-group">
                      <label htmlFor="cloud-cover-slider">Max Cloud Cover: {cloudCoverMax}%</label>
                      <input
                        id="cloud-cover-slider"
                        type="range"
                        min="0"
                        max="100"
                        value={cloudCoverMax}
                        onChange={(e) => setCloudCoverMax(Number(e.target.value))}
                        style={{ width: '200px' }}
                      />
                    </div>
                  </div>

                  {/* Buttons */}
                  <div className="datetime-filter-buttons">
                    <button
                      type="button"
                      className="datetime-apply-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        const datetimeFilter = buildDatetimeFilter(startDate, endDate);
                        const cloudCoverFilter = buildCloudCoverFilter(cloudCoverMax);
                        console.log('Filters applied:', { datetimeFilter, cloudCoverFilter });
                        setAppliedDatetimeFilter(datetimeFilter);
                        setAppliedCloudCoverFilter(cloudCoverFilter);
                        appliedCloudCoverFilterRef.current = cloudCoverFilter;
                        setIsFilterOpen(false);
                        window.dispatchEvent(new CustomEvent('datetimeFilterChanged', { detail: { datetimeFilter } }));
                        window.dispatchEvent(new CustomEvent('cloudCoverFilterChanged', { detail: { cloudCoverFilter } }));
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
                        setCloudCoverMax(100);
                        setAppliedDatetimeFilter('');
                        setAppliedCloudCoverFilter('');
                        appliedCloudCoverFilterRef.current = '';
                        window.dispatchEvent(new CustomEvent('datetimeFilterChanged', { detail: { datetimeFilter: '' } }));
                        window.dispatchEvent(new CustomEvent('cloudCoverFilterChanged', { detail: { cloudCoverFilter: '' } }));
                        window.dispatchEvent(new CustomEvent('refetchQueryItems', { detail: { limit: itemLimitRef.current } }));
                      }}
                    >
                      Clear All
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
  }

  // Check if this is a STAC Catalog instead of a Collection
  if (collection && collection.type === "Catalog") {
    // Extract child collections from links
    const childCollections = collection.links ? collection.links.filter(link => link.rel === 'child') : [];
    // Find the self link for the URL
    const selfLink = collection.links ? collection.links.find(link => link.rel === 'self') : null;
    
    return (
      <>
        <div className="catalog-info" onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}>
          <button 
            className="stac-expand-btn"
            title={isDescriptionExpanded ? "Hide catalog info" : "Show catalog info"}
          >
            <span className="expand-label">Catalog Info</span>
          </button>
          {isDescriptionExpanded && (
            <div className="stac-details-expanded">
              <h4>{collection.title || collection.id}</h4>
              <div className="catalog-details">
                <div className="catalog-detail-item">
                  <span className="catalog-detail-key">Type:</span>
                  <span className="catalog-detail-value">{collection.type}</span>
                </div>
                <div className="catalog-detail-item">
                  <span className="catalog-detail-key">STAC Version:</span>
                  <span className="catalog-detail-value">{collection.stac_version}</span>
                </div>
                <div className="catalog-detail-item">
                  <span className="catalog-detail-key">ID:</span>
                  <span className="catalog-detail-value">{collection.id}</span>
                </div>
                {selfLink && (
                  <div className="catalog-detail-item">
                    <span className="catalog-detail-key">URL:</span>
                    <span className="catalog-detail-value">
                      <a href={selfLink.href} target="_blank" rel="noopener noreferrer" className="catalog-url-link">
                        {selfLink.href}
                      </a>
                    </span>
                  </div>
                )}
                {collection.description && (
                  <div className="catalog-description">
                    <p>{collection.description}</p>
                  </div>
                )}
                {collection.conformsTo && collection.conformsTo.length > 0 && (
                  <div className="catalog-conformance">
                    <h5>Conformance</h5>
                    <ul>
                      {collection.conformsTo.slice(0, 5).map((spec, index) => (
                        <li key={index} className="conformance-item">
                          {spec.split('/').pop()}
                        </li>
                      ))}
                      {collection.conformsTo.length > 5 && (
                        <li className="conformance-item">...and {collection.conformsTo.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {childCollections.length > 0 && (
          <div className="child-collections" onClick={() => setIsQueryItemsVisible(!isQueryItemsVisible)}>
            <button 
              className="stac-expand-btn"
              title={isQueryItemsVisible ? "Hide child collections" : "Show child collections"}
            >
              <span className="expand-label">
                Child Collections ({childCollections.length})
              </span>
            </button>
            {isQueryItemsVisible && (
              <div className="stac-details-expanded">
                <h4>Available Collections</h4>
                <ul className="collections-list">
                  {childCollections.map((link, index) => (
                    <li key={index} className="collection-item">
                      <a 
                        href={link.href} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="collection-link"
                      >
                        {link.title || link.href.split('/').pop() || `Collection ${index + 1}`}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

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

  function handleItemClick(item) {
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
  }

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
      const { thumbnailUrl, thumbnailType } = extractThumbnail(item);
      
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
        window.dispatchEvent(mapThumbEvent);
      }
    }
  };

  return (
    <>
      {isLoadingItems && <LoadingIndicator message="Loading items..." />}
      {isLoadingNext && <LoadingIndicator message="Loading next page..." />}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      {hasValidTemporalExtent && (
        <div className="temporal-extent" onClick={handleTemporalExtentClick}>
          <button 
            className="stac-expand-btn"
            title={isTemporalExtentVisible ? "Hide temporal extent" : "Show temporal extent"}
          >
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            className="stac-expand-btn"
            onClick={() => {
              const newIsVisible = !isQueryItemsVisible;
              setIsQueryItemsVisible(newIsVisible);
            }}
            disabled={isLoadingItems}
          >
            <span className="expand-label">
              Query Items
              {(numberReturned !== null || numberMatched !== null) && (
                <span className="query-items-count">
                  ({numberReturned !== null ? numberReturned : '?'}/{numberMatched !== null ? numberMatched : 'Not provided'})
                </span>
              )}
            </span>
            <span className="expand-arrow">{isQueryItemsVisible ? '▼' : '▶'}</span>
          </button>
        </div>
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
                  disabled={isLoadingItems}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isLoadingItems) return;
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
                    window.dispatchEvent(new CustomEvent('downloadFullResults'));
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
                    const numValue = Math.min(1000, Math.max(1, parseInt(itemLimitDisplay, 10)));
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
                className={`datetime-btn ${appliedDatetimeFilter || appliedCloudCoverFilter ? 'datetime-active' : 'datetime-inactive'}`}
                title="Open filters (datetime & cloud cover)"
                aria-label="Open filters"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsFilterOpen(!isFilterOpen);
                }}
              >
                Filter
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
                            bbox: item.bbox || null,
                            collection: item.collection || collection?.id || null,
                            properties: item.properties || {}
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
              hasPerformedSearch ? (
                <p>No items found for this collection.</p>
              ) : (
                <p style={{ fontStyle: 'italic', color: '#888', margin: '10px 0' }}>
                  Click the 🔎 search button to find items in this collection.
                </p>
              )
            )}
          </div>
        )}
        {isFilterOpen && (
          <div className="datetime-filter-box">
            <div className="datetime-filter-header">
              <h3>Filters</h3>
              <button 
                className="datetime-filter-close"
                onClick={() => setIsFilterOpen(false)}
                aria-label="Close filters"
              >
                ✕
              </button>
            </div>
            <div className="datetime-filter-content">
              {/* Datetime Filter Section */}
              <div style={{ marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid #ddd' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '0.65rem', fontWeight: '400', color: '#666', textAlign: 'left' }}>Date Range</h4>
                <div className="datetime-filter-group">
                  <label htmlFor="start-date">Start Date:</label>
                  <input
                    id="start-date"
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={{ maxWidth: '200px' }}
                  />
                </div>
                <div className="datetime-filter-group" style={{ marginTop: '8px' }}>
                  <label htmlFor="end-date">End Date:</label>
                  <input
                    id="end-date"
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={{ maxWidth: '200px' }}
                  />
                </div>
              </div>

              {/* Cloud Cover Filter Section */}
              <div style={{ marginBottom: '10px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.65rem', fontWeight: '400', color: '#666', textAlign: 'left' }}>Cloud Cover</h4>
                <div className="datetime-filter-group">
                  <label htmlFor="cloud-cover-slider">Max Cloud Cover: {cloudCoverMax}%</label>
                  <input
                    id="cloud-cover-slider"
                    type="range"
                    min="0"
                    max="100"
                    value={cloudCoverMax}
                    onChange={(e) => setCloudCoverMax(Number(e.target.value))}
                    style={{ width: '200px' }}
                  />
                </div>
              </div>

              {/* Buttons */}
              <div className="datetime-filter-buttons">
                <button
                  type="button"
                  className="datetime-apply-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    const datetimeFilter = buildDatetimeFilter(startDate, endDate);
                    const cloudCoverFilter = buildCloudCoverFilter(cloudCoverMax);
                    console.log('Filters applied:', { datetimeFilter, cloudCoverFilter });
                    setAppliedDatetimeFilter(datetimeFilter);
                    setAppliedCloudCoverFilter(cloudCoverFilter);
                    appliedCloudCoverFilterRef.current = cloudCoverFilter;
                    setIsFilterOpen(false);
                    window.dispatchEvent(new CustomEvent('datetimeFilterChanged', { detail: { datetimeFilter } }));
                    window.dispatchEvent(new CustomEvent('cloudCoverFilterChanged', { detail: { cloudCoverFilter } }));
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
                    setCloudCoverMax(100);
                    setAppliedDatetimeFilter('');
                    setAppliedCloudCoverFilter('');
                    appliedCloudCoverFilterRef.current = '';
                    window.dispatchEvent(new CustomEvent('datetimeFilterChanged', { detail: { datetimeFilter: '' } }));
                    window.dispatchEvent(new CustomEvent('cloudCoverFilterChanged', { detail: { cloudCoverFilter: '' } }));
                    window.dispatchEvent(new CustomEvent('refetchQueryItems', { detail: { limit: itemLimitRef.current } }));
                  }}
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default StacCollectionDetails;
