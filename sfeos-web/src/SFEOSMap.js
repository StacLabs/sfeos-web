// src/SFEOSMap.js

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Map as MapLibreMap } from 'react-map-gl/maplibre';
import LogoOverlay from './components/common/LogoOverlay';
import ThumbnailOverlay from './components/overlays/ThumbnailOverlay';
import ItemDetailsOverlay from './components/overlays/ItemDetailsOverlay';
import MapStyleSelector from './components/map/MapStyleSelector';
import DarkModeToggle from './components/common/DarkModeToggle';
import StacClient from './services/StacClient';
import UrlSearchBox from './services/UrlSearchBox';
import MapThumbnailOverlay from './components/map/MapThumbnailOverlay';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import * as turf from '@turf/turf';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import './SFEOSMap.css';

const getInitialStacApiUrl = () => {
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const paramUrl = urlParams.get('stacApiUrl');
    if (paramUrl) {
      return paramUrl;
    }
    const stored = window.localStorage.getItem('stacApiUrl');
    if (stored) {
      return stored;
    }
  }
  return process.env.REACT_APP_STAC_API_URL || 'http://localhost:8000';
};

const DEFAULT_VIEW_STATE = {
  longitude: 28.9784,
  latitude: 41.0151,
  zoom: 12
};

function SFEOSMap() {
  // State
  const [mapStyle, setMapStyle] = useState(
    `https://api.maptiler.com/maps/streets/style.json?key=${process.env.REACT_APP_MAPTILER_KEY}`
  );
  // Map is left uncontrolled; use MapLibre camera directly
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [thumbnail, setThumbnail] = useState({ url: null, title: '', type: null });
  const [itemDetails, setItemDetails] = useState(null);
  const [isDrawingBbox, setIsDrawingBbox] = useState(false);
  const [drawnPolygonArea, setDrawnPolygonArea] = useState(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [currentItemLimit, setCurrentItemLimit] = useState(10);
  const [stacApiUrl, setStacApiUrl] = useState(getInitialStacApiUrl);
  const [mapThumbnail, setMapThumbnail] = useState({ geometry: null, url: null, title: '', type: null });
  const [showPublicLinks, setShowPublicLinks] = useState(false);
  const [projection, setProjection] = useState('mercator'); // 'mercator' or 'globe'
  
  // Refs
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const drawRef = useRef(null); // MapboxDraw instance
  const bboxLayers = useRef(new Set()); // Track bounding box layer IDs
  const stacApiUrlRef = useRef(stacApiUrl);
  const appliedDatetimeFilterRef = useRef(''); // Track datetime filter from StacCollectionDetails
  const appliedCloudCoverFilterRef = useRef(''); // Track cloud cover filter from StacCollectionDetails
  const searchControllerRef = useRef(null); // AbortController for in-flight searches
  const latestSearchIdRef = useRef(0); // Monotonic ID to ignore stale results
  const isAnimatingRef = useRef(false); // Prevent overlapping map animations
  const pendingRafRef = useRef(null); // Track scheduled requestAnimationFrame
  const isChangingProjectionRef = useRef(false); // Track if projection change is in progress
  const lastSearchUrlRef = useRef(null); // Track the last search URL for download

  useEffect(() => {
    stacApiUrlRef.current = stacApiUrl;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('stacApiUrl', stacApiUrl);
    }
  }, [stacApiUrl]);

  // Abort any in-flight search on unmount
  useEffect(() => {
    return () => {
      try {
        if (searchControllerRef.current) {
          searchControllerRef.current.abort();
          searchControllerRef.current = null;
        }
      } catch (e) {
        // noop
      }
    };
  }, []);
  
  // Trigger search with drawn polygon
  const triggerPolygonSearch = useCallback(async (drawData) => {
    if (!drawData || drawData.features.length === 0) return;
    
    try {
      // Cancel any previous request and set up a new controller
      if (searchControllerRef.current) {
        try { searchControllerRef.current.abort(); } catch {}
      }
      const controller = new AbortController();
      searchControllerRef.current = controller;
      const mySearchId = ++latestSearchIdRef.current;

      // Get the first polygon feature
      const polygon = drawData.features[0];
      const geoJson = JSON.stringify(polygon.geometry);
      
      // Calculate area in square kilometers
      const areaInSquareMeters = turf.area(polygon);
      const areaInSquareKm = (areaInSquareMeters / 1000000).toFixed(2);
      setDrawnPolygonArea(areaInSquareKm);
      
      const baseUrl = stacApiUrlRef.current;
      let url;
      
      if (selectedCollectionId) {
        // Single collection polygon search using search endpoint with collections parameter
        console.log('🔎 Searching within drawn polygon for collection:', selectedCollectionId);
        url = `${baseUrl}/search?collections=${encodeURIComponent(selectedCollectionId)}&intersects=${encodeURIComponent(geoJson)}&limit=${encodeURIComponent(currentItemLimit)}&fields=id,collection,bbox,geometry,properties.title,properties.datetime`;
      } else {
        // All collections polygon search
        console.log('🔎 Searching all collections within drawn polygon');
        url = `${baseUrl}/search?intersects=${encodeURIComponent(geoJson)}&limit=${encodeURIComponent(currentItemLimit)}&fields=id,collection,bbox,geometry,properties.title,properties.datetime`;
      }
      
      // Add datetime filter if present
      if (appliedDatetimeFilterRef.current) {
        url += `&datetime=${encodeURIComponent(appliedDatetimeFilterRef.current)}`;
      }
      
      // Add cloud cover filter if present
      if (appliedCloudCoverFilterRef.current) {
        url += `&query=${encodeURIComponent(appliedCloudCoverFilterRef.current)}`;
      }
      
      console.log('%c🔗 POLYGON SEARCH:', 'color: blue; font-weight: bold; font-size: 14px;');
      console.log('%cGET ' + url, 'color: green; font-family: monospace; font-size: 12px;');
      lastSearchUrlRef.current = url;
      window.dispatchEvent(new CustomEvent('hideOverlays'));
      
      const resp = await fetch(url, { method: 'GET', signal: controller.signal });
      if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
      const data = await resp.json();
      
      if (latestSearchIdRef.current !== mySearchId || controller.signal.aborted) {
        console.log('Ignoring stale or aborted polygon search response');
        return;
      }
      
      const features = Array.isArray(data.features) ? data.features : [];
      
      // Process features to include properties and other metadata
      const processedFeatures = features.map(item => ({
        id: item.id,
        title: item.properties?.title || item.id,
        geometry: item.geometry || null,
        bbox: item.bbox || null,
        collection: item.collection || null,
        properties: item.properties || {},
        assetsCount: Object.keys(item.assets || {}).length,
        datetime: item.properties?.datetime || item.properties?.start_datetime || null
      }));
      
      // Only dispatch camera events after successful, non-aborted search
      if (latestSearchIdRef.current === mySearchId && !controller.signal.aborted) {
        window.dispatchEvent(new CustomEvent('showItemsOnMap', { detail: { items: processedFeatures, numberReturned: data.numberReturned, numberMatched: data.numberMatched, searchId: mySearchId } }));
        
        // Dispatch polygon search nextLink to update pagination
        const polygonNextLink = data.links?.find(l => l.rel === 'next')?.href;
        if (polygonNextLink) {
          window.dispatchEvent(new CustomEvent('updateNextLink', { detail: { nextLink: polygonNextLink } }));
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Polygon search failed:', err);
      }
    }
  }, [selectedCollectionId, currentItemLimit]);
  
  // Event Handlers
  const handleMapLoad = useCallback((e) => {
    console.log('Map loaded, map instance:', e.target);
    const map = e.target;
    
    // Initialize the map with a default view if needed
    if (!map.getCenter()) {
      map.jumpTo({
        center: [0, 20],
        zoom: 2
      });
    }
    
    // Initialize MapboxDraw control
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: false,
        trash: false
      },
      defaultMode: 'simple_select',
      styles: [
        // Polygon fill
        {
          id: 'gl-draw-polygon-fill',
          type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: {
            'fill-color': '#808080',
            'fill-outline-color': '#808080',
            'fill-opacity': 0.1
          }
        },
        // Polygon outline
        {
          id: 'gl-draw-polygon-stroke-active',
          type: 'line',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: {
            'line-color': '#ff9800',
            'line-width': 1,
            'line-dasharray': [2, 2]
          }
        },
        // Active polygon outline
        {
          id: 'gl-draw-polygon-stroke-active-active',
          type: 'line',
          filter: ['all', ['==', '$type', 'Polygon'], ['==', 'active', 'true']],
          paint: {
            'line-color': '#ff9800',
            'line-width': 1,
            'line-dasharray': [2, 2]
          }
        },
        // Active line while drawing (follows cursor)
        {
          id: 'gl-draw-line',
          type: 'line',
          filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
          paint: {
            'line-color': '#ff9800',
            'line-width': 1,
            'line-dasharray': [2, 2]
          }
        },
        // Active line while drawing (hover state)
        {
          id: 'gl-draw-line-active',
          type: 'line',
          filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],
          paint: {
            'line-color': '#ff9800',
            'line-width': 1,
            'line-dasharray': [2, 2]
          }
        },
        // Vertex point halos - for all modes including drawing
        {
          id: 'gl-draw-polygon-and-line-vertex-halo-active',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex']],
          paint: {
            'circle-radius': 5,
            'circle-color': '#FFFFFF'
          }
        },
        // Vertex points - for all modes including drawing
        {
          id: 'gl-draw-polygon-and-line-vertex-active',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex']],
          paint: {
            'circle-radius': 4,
            'circle-color': '#808080'
          }
        },
        // Midpoint vertices
        {
          id: 'gl-draw-polygon-midpoint',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'midpoint']],
          paint: {
            'circle-radius': 4,
            'circle-color': '#A0A0A0',
            'circle-opacity': 0.7
          }
        }
      ]
    });
    
    map.addControl(draw);
    drawRef.current = draw;
    
    console.log('Map center:', map.getCenter(), 'Zoom:', map.getZoom());
    setIsMapLoaded(true);
  }, []);
  
  // MapboxDraw event handlers
  const handleDrawCreate = useCallback((e) => {
    const data = drawRef.current?.getAll();
    if (data && data.features.length > 0) {
      const area = turf.area(data);
      setDrawnPolygonArea(Math.round(area * 100) / 100);
      
      // Trigger search with the drawn polygon
      triggerPolygonSearch(data);
    }
  }, [triggerPolygonSearch]);
  
  const handleDrawDelete = useCallback((e) => {
    setDrawnPolygonArea(null);
    // Clear everything when polygon is deleted via trash button
    window.dispatchEvent(new CustomEvent('clearSearchResults'));
    window.dispatchEvent(new CustomEvent('hideOverlays'));
    window.dispatchEvent(new CustomEvent('hideLoading'));
    console.log('🗑️ Trash button: Cleared polygon and all results');
  }, []);
  
  const handleDrawUpdate = useCallback((e) => {
    const data = drawRef.current?.getAll();
    if (data && data.features.length > 0) {
      const area = turf.area(data);
      setDrawnPolygonArea(Math.round(area * 100) / 100);
      
      // Trigger search with the updated polygon
      triggerPolygonSearch(data);
    } else {
      setDrawnPolygonArea(null);
      window.dispatchEvent(new CustomEvent('clearSearchResults'));
    }
  }, [triggerPolygonSearch]);
  
  // Set up draw event handlers after map loads
  useEffect(() => {
    if (!isMapLoaded) return;
    const map = mapRef.current?.getMap();
    if (!map || !drawRef.current) return;
    
    map.on('draw.create', handleDrawCreate);
    map.on('draw.delete', handleDrawDelete);
    map.on('draw.update', handleDrawUpdate);
    
    return () => {
      map.off('draw.create', handleDrawCreate);
      map.off('draw.delete', handleDrawDelete);
      map.off('draw.update', handleDrawUpdate);
    };
  }, [isMapLoaded, handleDrawCreate, handleDrawDelete, handleDrawUpdate]);
  
  // Update projection when it changes (defer until map is idle to avoid animation conflicts)
  useEffect(() => {
    if (!isMapLoaded) return;
    
    try {
      const map = mapRef.current?.getMap();
      if (!map) return;

      const applyProjection = () => {
        try {
          const currentProjection = map.getProjection?.()?.type || 'mercator';
          
          // Only proceed if projection is actually changing
          if (currentProjection === projection) {
            console.log('✅ Projection already set to:', projection);
            isChangingProjectionRef.current = false;
            return;
          }
          
          isChangingProjectionRef.current = true;
          console.log('🔄 Starting projection change from', currentProjection, 'to:', projection);
          
          // Safety timeout to ensure flag is always reset
          const resetTimeout = setTimeout(() => {
            if (isChangingProjectionRef.current) {
              console.warn('⚠️ Projection change timeout - forcing reset');
              isChangingProjectionRef.current = false;
            }
          }, 500);
          
          // Re-enable globe projection with additional safeguards
          if (projection === 'globe') {
            // Switch to globe projection and disable world copies for stability
            map.setProjection({ type: 'globe' });
            map.setRenderWorldCopies(false);
            
            // Chain the camera update to 'moveend' instead of setTimeout to avoid race conditions
            const moveendHandler = () => {
              try {
                clearTimeout(resetTimeout);
                const current = map.getCenter?.();
                map.jumpTo({
                  center: current ? [current.lng, current.lat] : [0, 20],
                  zoom: Math.max(2.5, map.getZoom())
                });
              } catch (e) {
                console.warn('Globe projection stabilization failed:', e);
              } finally {
                isChangingProjectionRef.current = false;
                console.log('✅ Globe projection change complete');
              }
            };
            map.once('moveend', moveendHandler);
          } else {
            map.setProjection({ type: 'mercator' });
            map.setRenderWorldCopies(true);
            
            // Immediately reset for mercator since no stabilization needed
            clearTimeout(resetTimeout);
            isChangingProjectionRef.current = false;
            console.log('✅ Mercator projection change complete');
          }
          console.log('Projection set to:', projection);
        } catch (err) {
          console.warn('Error setting projection:', err);
          isChangingProjectionRef.current = false;
        }
      };

      const scheduleApply = () => {
        // Wait for style to load
        const run = () => {
          // Defer until map is not easing/moving to reduce run() conflicts
          if ((map.isEasing && map.isEasing()) || (map.isMoving && map.isMoving()) || isAnimatingRef.current) {
            map.once('moveend', () => {
              // After movement, ensure style is loaded then apply
              if (map.isStyleLoaded()) applyProjection();
              else map.once('style.load', applyProjection);
            });
            return;
          }
          applyProjection();
        };

        if (map.isStyleLoaded()) run();
        else map.once('style.load', run);
      };

      scheduleApply();
    } catch (err) {
      console.warn('Error in projection effect:', err);
    }
  }, [projection, isMapLoaded]);

  // Wait until the map is idle (style loaded and not moving/easing)
  const waitForIdle = useCallback(async (map) => {
    try {
      if (!map) return;
      // Wait for style
      if (!map.isStyleLoaded()) {
        await new Promise((res) => map.once('style.load', res));
      }
      // If moving/easing, wait for moveend; also guard with a short timeout
      if ((map.isMoving && map.isMoving()) || (map.isEasing && map.isEasing()) || isAnimatingRef.current) {
        await new Promise((res) => {
          let done = false;
          const finish = () => { if (!done) { done = true; res(); } };
          map.once('moveend', finish);
          setTimeout(finish, 300); // safety
        });
      }
    } catch (e) {
      console.warn('waitForIdle error:', e);
    }
  }, []);

  const handleStyleChange = useCallback((newStyle) => {
    setMapStyle(newStyle);
  }, []);

  const handleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    const elem = containerRef.current;
    const isCurrentlyFullscreen = document.fullscreenElement === elem;

    if (isCurrentlyFullscreen) {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
      setIsFullscreen(false);
    } else {
      // Enter fullscreen
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      } else if (elem.mozRequestFullScreen) {
        elem.mozRequestFullScreen();
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      }
      setIsFullscreen(true);
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('msfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Listen for datetime filter changes from StacCollectionDetails
  useEffect(() => {
    const handleDatetimeFilterChanged = (event) => {
      const datetimeFilter = event?.detail?.datetimeFilter || '';
      appliedDatetimeFilterRef.current = datetimeFilter;
      console.log('📅 Datetime filter event received in SFEOSMap');
      console.log('   Filter value:', datetimeFilter);
      console.log('   Ref now contains:', appliedDatetimeFilterRef.current);
    };

    window.addEventListener('datetimeFilterChanged', handleDatetimeFilterChanged);
    return () => {
      window.removeEventListener('datetimeFilterChanged', handleDatetimeFilterChanged);
    };
  }, []);

  // Listen for cloud cover filter changes from StacCollectionDetails
  useEffect(() => {
    const handleCloudCoverFilterChanged = (event) => {
      const cloudCoverFilter = event?.detail?.cloudCoverFilter || '';
      appliedCloudCoverFilterRef.current = cloudCoverFilter;
      console.log('☁️ Cloud cover filter event received in SFEOSMap');
      console.log('   Filter value:', cloudCoverFilter);
      console.log('   Ref now contains:', appliedCloudCoverFilterRef.current);
    };

    window.addEventListener('cloudCoverFilterChanged', handleCloudCoverFilterChanged);
    return () => {
      window.removeEventListener('cloudCoverFilterChanged', handleCloudCoverFilterChanged);
    };
  }, []);

  
  // Function to add a geometry to the map
  const addGeometry = useCallback((map, id, geometry, color = '#FF0000', width = 2, itemData = null) => {
    // Guard: skip if projection change is in progress to avoid race condition
    if (isChangingProjectionRef.current) {
      console.warn(`⏳ Skipping addGeometry for ${id} - projection change in progress.`);
      return;
    }
    
    if (!map || !geometry) {
      console.warn('Invalid geometry in addGeometry:', geometry);
      return;
    }

    
    // Create a GeoJSON feature for the geometry
    const geometryFeature = {
      type: 'Feature',
      geometry: geometry,
      properties: { 
        id,
        itemData
      }
    };
    
    // Add the source if it doesn't exist
    if (!map.getSource(`geometry-${id}`)) {
      try {
        map.addSource(`geometry-${id}`, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [geometryFeature]
          }
        });
        
        // Add the layer
        map.addLayer({
          id: `geometry-${id}`,
          type: 'line',
          source: `geometry-${id}`,
          layout: {},
          paint: {
            'line-color': color,
            'line-width': width,
            'line-opacity': 0.8
          }
        });
        
        // Add fill layer for better visibility
        map.addLayer({
          id: `geometry-fill-${id}`,
          type: 'fill',
          source: `geometry-${id}`,
          layout: {},
          paint: {
            'fill-color': color,
            'fill-opacity': 0.1
          }
        });
      } catch (e) {
        console.error(`Failed to add source/layers for item ${id}:`, e);
        return;
      }
      
      // Add click handler for item details if itemData is provided
      if (itemData) {
        map.on('click', `geometry-fill-${id}`, (e) => {
          
          // Select the item in the list (this triggers handleItemClick in StacCollectionDetails)
          window.dispatchEvent(new CustomEvent('selectItem', {
            detail: { itemId: itemData.id }
          }));
          
          // Dispatch the showItemDetails event with the item data
          // This will be handled by the centralized showItemDetailsHandler
          window.dispatchEvent(new CustomEvent('showItemDetails', {
            detail: {
              id: itemData.id,
              title: itemData.title,
              datetime: itemData.datetime || null,
              assetsCount: itemData.assetsCount || 0,
              bbox: itemData.bbox || null,
              collection: itemData.collection || null,
              properties: itemData.properties || {}
            }
          }));

          // Prevent event bubbling
          e.originalEvent.stopPropagation();
        });
        
        // Change cursor on hover for visual feedback
        map.on('mouseenter', `geometry-fill-${id}`, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        
        map.on('mouseleave', `geometry-fill-${id}`, () => {
          map.getCanvas().style.cursor = '';
        });
      }
      
      // Track the layer IDs
      bboxLayers.current.add(`geometry-${id}`);
      bboxLayers.current.add(`geometry-fill-${id}`);
    } else {
      // Update existing source
      map.getSource(`geometry-${id}`).setData({
        type: 'FeatureCollection',
        features: [geometryFeature]
      });
    }
  }, []);

  // Function to clear all geometries
  const clearGeometries = useCallback((map) => {
    if (!map || !map.getStyle || !map.getStyle()) {
      console.warn('⚠️ clearGeometries: map is not ready');
      return;
    }
    
    // Skip if projection is changing to avoid MapLibre errors
    if (isChangingProjectionRef.current) {
      console.log('⏳ Skipping clearGeometries - projection change in progress');
      return;
    }
    
    try {
      // Remove all bbox layers
      bboxLayers.current.forEach(layerId => {
        try {
          if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
          }
        } catch (e) {
          console.warn('Failed to remove bbox layer:', layerId, e);
        }
      });
      
      // Remove all bbox sources (avoiding duplicates)
      const removedSources = new Set();
      bboxLayers.current.forEach(layerId => {
        try {
          const sourceId = layerId.replace('-fill', '').replace('-line', '');
          if (!removedSources.has(sourceId) && map.getSource(sourceId)) {
            map.removeSource(sourceId);
            removedSources.add(sourceId);
          }
        } catch (e) {
          console.warn('Failed to remove bbox source:', layerId, e);
        }
      });
      
      bboxLayers.current.clear();
      
      // Remove item geometries
      const layers = map.getStyle().layers || [];
      const itemLayers = layers.filter(layer => 
        layer.id.startsWith('item-geometry-') || 
        layer.id.startsWith('item-outline-') ||
        layer.id.startsWith('item-fill-')
      );
      
      itemLayers.forEach(layer => {
        try {
          if (map.getLayer(layer.id)) {
            map.removeLayer(layer.id);
          }
          const sourceId = layer.source;
          if (sourceId && map.getSource(sourceId)) {
            map.removeSource(sourceId);
          }
        } catch (e) {
          console.warn('Failed to remove item layer/source:', layer.id, e);
        }
      });
    } catch (e) {
      console.error('Error in clearGeometries:', e);
    }
  }, []);

  const resetToInitialState = useCallback(() => {
    console.log('🔄 Resetting map to initial state');
    setThumbnail({ url: null, title: '', type: null });
    setItemDetails(null);
    setIsDrawingBbox(false);
    setDrawnPolygonArea(null);
    setSelectedCollectionId(null);
    setCurrentItemLimit(10);

    try {
      window.dispatchEvent(new CustomEvent('hideOverlays'));
      window.dispatchEvent(new CustomEvent('resetStacCollectionDetails'));
    } catch (err) {
      console.warn('Failed to dispatch reset events:', err);
    }

    const map = mapRef.current?.getMap();
    if (map) {
      try {
        clearGeometries(map);
        
        // Guard: skip jumpTo if projection change is in progress
        if (!isChangingProjectionRef.current) {
          map.jumpTo({
            center: [DEFAULT_VIEW_STATE.longitude, DEFAULT_VIEW_STATE.latitude],
            zoom: DEFAULT_VIEW_STATE.zoom
          });
          console.log('✅ Map reset to initial view');
        } else {
          console.warn('⏳ Skipping reset map view - projection change in progress');
        }
      } catch (err) {
        console.warn('Failed to reset map view:', err);
      }
    }
  }, [clearGeometries]);

  // Switch the active STAC API and reset state
  const handleSwitchApi = useCallback((newUrl) => {
    try {
      let trimmed = (newUrl || '').trim();
      if (!trimmed) return;
      
      // Remove trailing slash if present for consistency
      trimmed = trimmed.replace(/\/+$/, '');
      
      stacApiUrlRef.current = trimmed;
      setStacApiUrl(trimmed);
      resetToInitialState();
      setShowPublicLinks(false);
      
      // Update URL in the browser's address bar
      const url = new URL(window.location);
      url.searchParams.set('stacApiUrl', trimmed);
      window.history.pushState({}, '', url);
      
    } catch (e) {
      console.warn('Failed to switch API URL:', e);
    }
  }, [resetToInitialState]);

  const handleShowItemsOnMap = useCallback(async (event) => {
    try {
      console.log('📍 showItemsOnMap event received with', event?.detail?.items?.length, 'items');
      
      const getMapInstance = () => {
        if (!mapRef.current) return null;
        try {
          const map = mapRef.current.getMap();
          return map.loaded() ? map : null;
        } catch (error) {
          console.error('Error getting map instance:', error);
          return null;
        }
      };
      
      const map = getMapInstance();
      if (!map) {
        console.error('Map not available');
        return;
      }

      // 1. Wait for any PREVIOUS animations to finish
      console.log('⏳ Waiting for map to be idle before processing new items...');
      await waitForIdle(map);
      console.log('✅ Map is idle, proceeding with item processing');

      const { items = [] } = event.detail || {};
      
      // 2. Clear old geometries
      console.log('🧹 Clearing existing geometries');
      clearGeometries(map);
      
      if (!Array.isArray(items) || items.length === 0) {
        console.log('❌ No valid items array provided or empty items array - geometries cleared');
        return;
      }
      
      const extractFiniteCoordinates = (geometry) => {
        if (!geometry || !geometry.type) return null;
        const coords = [];
        let invalid = false;
        const push = (lon, lat) => {
          if (Number.isFinite(lon) && Number.isFinite(lat)) {
            coords.push([lon, lat]);
          } else {
            invalid = true;
          }
        };

        switch (geometry.type) {
          case 'Point': {
            const [lon, lat] = geometry.coordinates || [];
            push(lon, lat);
            break;
          }
          case 'MultiPoint': {
            (geometry.coordinates || []).forEach(coord => push(coord?.[0], coord?.[1]));
            break;
          }
          case 'LineString': {
            (geometry.coordinates || []).forEach(coord => push(coord?.[0], coord?.[1]));
            break;
          }
          case 'MultiLineString': {
            (geometry.coordinates || []).forEach(line => {
              if (Array.isArray(line)) {
                line.forEach(coord => push(coord?.[0], coord?.[1]));
              }
            });
            break;
          }
          case 'Polygon': {
            (geometry.coordinates || []).forEach(ring => {
              if (Array.isArray(ring)) {
                ring.forEach(coord => push(coord?.[0], coord?.[1]));
              }
            });
            break;
          }
          case 'MultiPolygon': {
            (geometry.coordinates || []).forEach(polygon => {
              if (Array.isArray(polygon)) {
                polygon.forEach(ring => {
                  if (Array.isArray(ring)) {
                    ring.forEach(coord => push(coord?.[0], coord?.[1]));
                  }
                });
              }
            });
            break;
          }
          default:
            invalid = true;
        }

        if (invalid || coords.length === 0) {
          return null;
        }
        return coords;
      };

      // Process items and add their geometries
      const geometriesWithCoords = [];
      items.forEach(item => {
        if (!item?.geometry) return;
        const coords = extractFiniteCoordinates(item.geometry);
        if (!coords) {
          console.warn('Skipping item due to invalid geometry coordinates:', item?.id || item);
          return;
        }
        geometriesWithCoords.push({
          geometry: item.geometry,
          coords,
          id: item.id || `item-${Math.random().toString(36).substr(2, 9)}`,
          itemData: item
        });
      });

      if (geometriesWithCoords.length === 0) {
        console.error('❌ No valid geometries with finite coordinates found in items');
        return;
      }
      
      // Calculate combined bounds from all geometries
      let combinedBbox = [Infinity, Infinity, -Infinity, -Infinity];
      const allCoords = [];
      
      const updateBbox = (lon, lat) => {
        combinedBbox[0] = Math.min(combinedBbox[0], lon);
        combinedBbox[1] = Math.min(combinedBbox[1], lat);
        combinedBbox[2] = Math.max(combinedBbox[2], lon);
        combinedBbox[3] = Math.max(combinedBbox[3], lat);
        allCoords.push([lon, lat]);
      };
      
      geometriesWithCoords.forEach(({ coords }) => {
        coords.forEach(([lon, lat]) => updateBbox(lon, lat));
      });
      
      console.log('Combined bbox:', combinedBbox);
      
      // Compute center: globe uses circular mean; flat uses simple averages (previous behavior)
      let centerLon;
      let centerLat;
      if (projection === 'globe') {
        // Helpers for longitude normalization around the antimeridian
        const normalizeLon = (lon) => ((lon + 180) % 360 + 360) % 360 - 180;
        const toRad = (d) => d * Math.PI / 180;
        const toDeg = (r) => r * 180 / Math.PI;
        const circularMeanLon = (lons) => {
          if (!lons.length) return 0;
          const rad = lons.map(l => toRad(normalizeLon(l)));
          const s = rad.reduce((a, r) => a + Math.sin(r), 0);
          const c = rad.reduce((a, r) => a + Math.cos(r), 0);
          let mean = toDeg(Math.atan2(s, c));
          if (mean > 180) mean -= 360;
          if (mean <= -180) mean += 360;
          return mean;
        };
        centerLon = circularMeanLon(allCoords.map(([lon]) => lon));
        centerLat = allCoords.length > 0
          ? allCoords.reduce((sum, [, lat]) => sum + lat, 0) / allCoords.length
          : (combinedBbox[1] + combinedBbox[3]) / 2;
      } else {
        // Flat map: keep previous behavior
        centerLon = (combinedBbox[0] + combinedBbox[2]) / 2;
        centerLat = (combinedBbox[1] + combinedBbox[3]) / 2;
        if (allCoords.length > 0) {
          centerLon = allCoords.reduce((sum, [lon]) => sum + lon, 0) / allCoords.length;
          centerLat = allCoords.reduce((sum, [, lat]) => sum + lat, 0) / allCoords.length;
        }
      }
      
      // Validate center coordinates immediately
      if (!Number.isFinite(centerLon)) {
        console.warn('⚠️ centerLon is not finite:', centerLon, '- using bbox midpoint');
        centerLon = (combinedBbox[0] + combinedBbox[2]) / 2;
        if (!Number.isFinite(centerLon)) centerLon = 0;
      }
      if (!Number.isFinite(centerLat)) {
        console.warn('⚠️ centerLat is not finite:', centerLat, '- using bbox midpoint');
        centerLat = (combinedBbox[1] + combinedBbox[3]) / 2;
        if (!Number.isFinite(centerLat)) centerLat = 0;
      }
      
      console.log('✅ Center:', { centerLon, centerLat });
      console.log('📍 Bbox corners:', { minLon: combinedBbox[0], minLat: combinedBbox[1], maxLon: combinedBbox[2], maxLat: combinedBbox[3] });
      console.log('📊 Item count:', geometriesWithCoords.length, 'Coordinate count:', allCoords.length);
      
      const hasFiniteBounds = combinedBbox.every((value) => Number.isFinite(value));
      if (!hasFiniteBounds) {
        console.warn('⚠️ Combined bbox contains non-finite values, will use fallback zoom.', combinedBbox);
      }

      // Zoom to the combined bounds
      const [minLon, minLat, maxLon, maxLat] = combinedBbox;
      
      // Calculate zoom level based on bbox size with strict guards
      let lonDiff = maxLon - minLon;
      if (!Number.isFinite(lonDiff)) {
        console.warn('⚠️ lonDiff is not finite:', lonDiff, '- using default zoom');
        lonDiff = 1;
      }
      if (projection === 'globe' && lonDiff > 180) lonDiff = 360 - lonDiff; // AM-aware only on globe
      const latDiff = maxLat - minLat;
      if (!Number.isFinite(latDiff)) {
        console.warn('⚠️ latDiff is not finite:', latDiff, '- using default zoom');
      }
      const maxDiff = Math.max(lonDiff, latDiff, 0.001); // Ensure we don't get Infinity
      if (!Number.isFinite(maxDiff)) {
        console.warn('⚠️ maxDiff is not finite:', maxDiff, '- using default zoom');
      }
      let zoom = 13 - Math.log2(maxDiff / 0.08); // Calculate base zoom
      if (!Number.isFinite(zoom)) {
        console.warn('⚠️ Calculated zoom is not finite:', zoom, '- using default');
        zoom = 8;
      }
      zoom = Math.max(0, Math.min(13, zoom)); // Clamp to safe range
      
      // For globe projection, apply zoom adjustment to keep globe size consistent
      if (projection === 'globe') {
        const centerObj = (typeof map.getCenter === 'function') ? map.getCenter() : null;
        const currentLat = centerObj && typeof centerObj.lat === 'number' ? centerObj.lat : centerLat;
        const targetLat = centerLat;
        
        // Guard against invalid latitudes for cosine calculation
        if (Number.isFinite(currentLat) && Number.isFinite(targetLat)) {
          const cosTarget = Math.cos(targetLat / 180 * Math.PI);
          const cosCurrent = Math.cos(currentLat / 180 * Math.PI);
          
          if (cosCurrent !== 0 && Number.isFinite(cosTarget) && Number.isFinite(cosCurrent)) {
            // Calculate zoom adjustment: log2(cos(targetLat) / cos(currentLat))
            const zoomAdjustment = Math.log2(cosTarget / cosCurrent);
            if (Number.isFinite(zoomAdjustment)) {
              zoom = Math.max(2.5, Math.min(13, zoom + zoomAdjustment));
              console.log('🌍 Globe zoom adjustment:', { currentLat, targetLat, zoomAdjustment, adjustedZoom: zoom });
            } else {
              console.warn('⚠️ Globe zoom adjustment produced non-finite value:', zoomAdjustment);
            }
          } else {
            console.warn('⚠️ Invalid cosine values for globe adjustment:', { cosTarget, cosCurrent });
          }
        } else {
          console.warn('⚠️ Invalid latitudes for globe zoom adjustment:', { currentLat, targetLat });
        }
      }

      // Final validation: ensure zoom is safe before passing to MapLibre
      if (!Number.isFinite(zoom)) {
        console.error('❌ Final zoom validation failed - zoom is not finite:', zoom);
        zoom = 8; // Fallback to safe default
      }
      
      // 5. ADD NEW GEOMETRIES (BEFORE flying camera)
      if (!map.isStyleLoaded()) {
        console.log('⏳ Waiting for map style to load before adding geometries...');
        await new Promise((resolve) => map.once('style.load', resolve));
        console.log('✅ Map style loaded, proceeding with geometries');
      }
      
      console.log(`📍 Adding ${geometriesWithCoords.length} geometries to map`);
      geometriesWithCoords.forEach(({ geometry, id, itemData }, index) => {
        const hue = (index * 137.5) % 360;
        const color = `hsl(${hue}, 80%, 50%)`;
        if (index === 0 || index === geometriesWithCoords.length - 1) {
          console.log(`🎨 Adding geometry for item ${index} (${id}):`, geometry);
        }
        try {
          addGeometry(map, id, geometry, color, 2, itemData);
        } catch (e) {
          console.error(`Failed to add geometry for item ${id}:`, e);
        }
      });
      console.log('✅ Map updated with', geometriesWithCoords.length, 'geometries');

      // 6. SMALL DELAY TO ALLOW LAYERS TO RENDER
      console.log('⏳ Adding small delay for layers to render...');
      await new Promise(resolve => setTimeout(resolve, 50));
      console.log('✅ Proceeding to flyTo animation');

      // 7. FINALLY, FLY THE CAMERA
      console.log('🎯 Flying to:', { centerLon, centerLat, zoom, projection });
      console.log('📊 FlyTo conditions:', { hasFiniteBounds, centerLonFinite: Number.isFinite(centerLon), centerLatFinite: Number.isFinite(centerLat), zoomFinite: Number.isFinite(zoom) });

      // Always try to fly to center, even if bounds are invalid (use fallback zoom)
      const safeZoom = Number.isFinite(zoom) ? zoom : 8;
      const safeCenterLon = Number.isFinite(centerLon) ? centerLon : 0;
      const safeCenterLat = Number.isFinite(centerLat) ? centerLat : 0;
      
      console.log('✅ Attempting flyTo with:', { safeCenterLon, safeCenterLat, safeZoom, hasFiniteBounds });
      
      if (isChangingProjectionRef.current) {
        console.warn('⏳ Skipping flyTo - projection change in progress');
        return;
      }
      
      if (!map || !map.getCanvas || !map.getCanvas()) {
        console.error('❌ Map became invalid before flyTo');
        return;
      }
      
      console.log('✅ Map is valid, calling performFlyTo');
      performFlyTo();
      
      function performFlyTo() {
        try {
          if (map.isEasing && map.isEasing()) {
            map.stop();
          }
          
          // Use the safe values we calculated before calling this function
          let finalCenterLon = safeCenterLon;
          let finalCenterLat = safeCenterLat;
          
          // For globe, fly to center without changing zoom
          if (projection === 'globe') {
            console.log('🌍 Flying globe to center:', { lon: finalCenterLon, lat: finalCenterLat });
            const currentZoom = map.getZoom();
            map.flyTo({
              center: [finalCenterLon, finalCenterLat],
              zoom: currentZoom, // Keep current zoom
              duration: 1000,
              essential: true
            });
            return;
          }
          
          // For flat map, use flyTo with calculated zoom
          let finalZoom = safeZoom;
          finalZoom = Math.max(0, Math.min(28, finalZoom));
          
          try { isAnimatingRef.current = true; } catch {}
          map.once('moveend', () => { isAnimatingRef.current = false; });
          
          const safeCenter = [finalCenterLon, finalCenterLat];
          
          console.log('Using flyTo with center:', safeCenter, 'zoom:', finalZoom);
          map.flyTo({
            center: safeCenter,
            zoom: finalZoom,
            bearing: 0,
            pitch: 0,
            duration: 1000,
            essential: true
          });
        } catch (error) {
          console.error('Error in flyTo, using jumpTo fallback:', error);
          
          let fallbackCenterLon = centerLon;
          let fallbackCenterLat = centerLat;
          if (!Number.isFinite(fallbackCenterLon)) fallbackCenterLon = 0;
          if (!Number.isFinite(fallbackCenterLat)) fallbackCenterLat = 0;
          
          const safeCenterFallback = (projection === 'globe')
            ? [((fallbackCenterLon + 180) % 360 + 360) % 360 - 180, Math.max(-85, Math.min(85, fallbackCenterLat))]
            : [fallbackCenterLon, fallbackCenterLat];
          
          let safeZoomFallback = zoom;
          if (!Number.isFinite(safeZoomFallback)) safeZoomFallback = 8;
          safeZoomFallback = Math.max(0, Math.min(28, safeZoomFallback));
          
          map.jumpTo({
            center: safeCenterFallback,
            zoom: safeZoomFallback,
            bearing: 0,
            pitch: 0
          });
        }
      };
    } catch (error) {
      console.error('Error in handleShowItemsOnMap:', error);
    }
  }, [addGeometry, clearGeometries, projection, waitForIdle]);

  // Function to handle zooming to a bounding box
  const handleZoomToBbox = useCallback(async (event) => {
    console.log('handleZoomToBbox called with event:', event);
    const { bbox, options = {} } = event.detail || {};
    
    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
      console.error('Invalid bbox format:', bbox);
      return;
    }
    
    console.log('Processing bbox:', bbox);
    
    // Get the map instance with retry logic
    const getMapInstance = (attempt = 0) => {
      try {
        if (!mapRef.current) {
          console.log('mapRef.current is null');
          return null;
        }
        
        const map = mapRef.current.getMap();
        if (!map || typeof map.fitBounds !== 'function') {
          console.log('Map not properly initialized yet');
          return null;
        }
        
        console.log('Successfully got map instance');
        return map;
      } catch (error) {
        console.error('Error getting map instance:', error);
        return null;
      }
    };
    
    // Wait for map to be ready with retry logic
    let map = null;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (!map && attempts < maxAttempts) {
      map = getMapInstance();
      if (!map) {
        console.log(`Map not ready, attempt ${attempts + 1}/${maxAttempts}...`);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      attempts++;
    }
    
    if (!map) {
      console.error('Failed to get map instance after multiple attempts');
      return;
    }
    
    try {
      // Ensure coordinates are valid numbers
      const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
      
      if ([minLon, minLat, maxLon, maxLat].some(isNaN)) {
        throw new Error('Invalid bbox coordinates - non-numeric values detected');
      }
      
      console.log('Zooming to bbox:', { minLon, minLat, maxLon, maxLat });
      
      // Create bounds in the format expected by fitBounds
      const bounds = [
        [minLon, minLat],
        [maxLon, maxLat]
      ];
      
      // Add padding with safe defaults
      const padding = Math.min(Math.max(Number(options.padding) || 50, 20), 200);
      const maxZoom = Math.min(Math.max(Number(options.maxZoom) || 14, 1), 20);
      
      console.log('Using fitBounds with bounds:', bounds, 'padding:', padding, 'maxZoom:', maxZoom);
      
      // First ensure we have a valid map view
      if (!map.getCenter() || !map.getZoom()) {
        console.log('Initializing map view...');
        
        // Guard: skip jumpTo if projection change is in progress
        if (!isChangingProjectionRef.current) {
          map.jumpTo({
            center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
            zoom: Math.min(10, maxZoom)
          });
        } else {
          console.warn('⏳ Skipping map view initialization - projection change in progress');
        }
      }
      
      // Ensure map is ready/idle before scheduling fitBounds
      await waitForIdle(map);
      // Use requestAnimationFrame to ensure map is ready; cancel any previous scheduled frame
      if (pendingRafRef.current) {
        try { cancelAnimationFrame(pendingRafRef.current); } catch {}
        pendingRafRef.current = null;
      }
      pendingRafRef.current = requestAnimationFrame(() => {
        try {
          // For globe projection, we need to apply zoom adjustment to keep globe size consistent
          let adjustedMaxZoom = maxZoom;
          if (projection === 'globe') {
            const centerObj2 = (typeof map.getCenter === 'function') ? map.getCenter() : null;
            const currentLat = centerObj2 && typeof centerObj2.lat === 'number' ? centerObj2.lat : (minLat + maxLat) / 2;
            const targetLat = (minLat + maxLat) / 2;
            // Calculate zoom adjustment: log2(cos(targetLat) / cos(currentLat))
            const zoomAdjustment = Math.log2(Math.cos(targetLat / 180 * Math.PI) / Math.cos(currentLat / 180 * Math.PI));
            adjustedMaxZoom = Math.max(1, maxZoom + zoomAdjustment);
            console.log('Globe zoom adjustment:', zoomAdjustment, 'currentLat:', currentLat, 'targetLat:', targetLat, 'adjusted maxZoom:', adjustedMaxZoom);
          }
          
          // Stop any ongoing animation first
          if (map.isEasing && map.isEasing()) {
            map.stop();
          }
          
          // Mark animating and clear on moveend
          try { isAnimatingRef.current = true; } catch {}
          map.once('moveend', () => { isAnimatingRef.current = false; });
          
          const safeCenter = [((minLon + maxLon) / 2), ((minLat + maxLat) / 2)];
          
          console.log('Using fitBounds with center:', safeCenter, 'padding:', padding, 'maxZoom:', adjustedMaxZoom);
          map.fitBounds(bounds, {
            padding: padding,
            maxZoom: adjustedMaxZoom,
            minZoom: projection === 'globe' ? 2.5 : undefined,
            duration: 1000
          });
          
          console.log('Map view updated successfully');
          
        } catch (fitError) {
          console.error('Error in fitBounds:', fitError);
          
          // Fallback to center/zoom
          try {
            map.jumpTo({
              center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
              zoom: Math.min(10, maxZoom)
            });
          } catch (jumpError) {
            console.error('Fallback jumpTo also failed:', jumpError);
          }
        }
      });
      
    } catch (error) {
      console.error('Error in handleZoomToBbox:', error);
    }
  }, [projection, waitForIdle]);

  // The zoom to bbox functionality is handled by the handleZoomToBbox function

  // Set up event listeners for map interactions
  useEffect(() => {
    if (!isMapLoaded) {
      console.log('Waiting for map to load before setting up event listeners');
      return;
    }
    
    console.log('✅ Map is loaded, setting up event listeners');
    
    // Get the map instance
    const getMap = () => {
      try {
        return mapRef.current?.getMap();
      } catch (error) {
        console.error('Error getting map instance:', error);
        return null;
      }
    };
    
    const map = getMap();
    if (!map) {
      console.error('Failed to get map instance');
      return;
    }
    
    // Store the event handler functions so we can remove them later
    const zoomToBboxHandler = (event) => {
      console.log('zoomToBbox event received:', event);
      handleZoomToBbox(event).catch(error => {
        console.error('Error handling zoomToBbox:', error);
      });
    };
    
    const showItemsOnMapHandler = async (event) => {
      try {
        // Guard: skip if this is a stale search result
        const eventSearchId = event?.detail?.searchId;
        if (eventSearchId && eventSearchId !== latestSearchIdRef.current) {
          console.log(`🔄 Skipping stale showItemsOnMap event (ID: ${eventSearchId}, latest: ${latestSearchIdRef.current})`);
          return;
        }
        
        await handleShowItemsOnMap(event);
      } catch (error) {
        console.error('Error in showItemsOnMapHandler:', error);
      }
    };

    const showItemThumbnailHandler = (event) => {
      try {
        const { url, title, type } = event.detail || {};
        console.log('📸 showItemThumbnail event received:', { url, title, type });
        // Always show the overlay, even if url is missing (it will show an error message)
        setThumbnail({ url: url || null, title: title || '', type: type || null });
        // Hide details overlay when showing thumbnail
        setItemDetails(null);
      } catch (e) {
        console.error('Error handling showItemThumbnail:', e);
      }
    };

    const showMapThumbnailHandler = (event) => {
      try {
        const { geometry, url, title, type } = event.detail || {};
        if (url && geometry) {
          setMapThumbnail({ geometry, url, title: title || '', type: type || null });
        } else {
          console.warn('showMapThumbnail event missing url or geometry');
        }
      } catch (e) {
        console.error('Error handling showMapThumbnail:', e);
      }
    };

    const hideMapThumbnailHandler = () => {
      try {
        setMapThumbnail({ geometry: null, url: null, title: '', type: null });
        // Also clear popup thumbnail
        setThumbnail({ url: null, title: '', type: null });
      } catch (e) {
        console.error('Error handling hideMapThumbnail:', e);
      }
    };

    const showItemDetailsHandler = async (event) => {
      try {
        const basicItem = event.detail || null;
        if (!basicItem || !basicItem.id) {
          console.warn('showItemDetails event missing item data or ID');
          return;
        }

        // If we already have comprehensive item data (more than basic search fields)
        const hasFullProperties = basicItem.properties &&
          (Object.keys(basicItem.properties).length > 2 ||
           basicItem.assets ||
           basicItem.links);

        if (hasFullProperties) {
          // Already have full data, use it directly
          setItemDetails(basicItem);
          setThumbnail({ url: null, title: '', type: null });
          return;
        }

        // Only fetch full details when explicitly requested via info button
        // This preserves search performance while ensuring details are complete
        if (basicItem.collection) {
          console.log('📄 Fetching full item details for:', basicItem.id);
          const baseUrl = stacApiUrlRef.current || 'http://localhost:8080';
          const itemUrl = `${baseUrl}/collections/${encodeURIComponent(basicItem.collection)}/items/${encodeURIComponent(basicItem.id)}`;

          try {
            const resp = await fetch(itemUrl);
            if (resp.ok) {
              const fullItem = await resp.json();

              // Merge full API data with our processed item
              const fullItemDetails = {
                id: fullItem.id,
                title: fullItem.properties?.title || fullItem.id,
                datetime: fullItem.properties?.datetime || fullItem.properties?.start_datetime || null,
                assetsCount: Object.keys(fullItem.assets || {}).length,
                bbox: fullItem.bbox || null,
                collection: fullItem.collection || basicItem.collection,
                properties: fullItem.properties || {},
                geometry: fullItem.geometry || null,
                assets: fullItem.assets || {},
                links: fullItem.links || []
              };

              setItemDetails(fullItemDetails);
              console.log('📄 Full item details loaded');
              
              // Notify that loading is complete
              window.dispatchEvent(new CustomEvent('itemDetailsLoaded'));
            } else {
              // API failed, use basic data
              console.warn(`Failed to fetch full item details (${resp.status})`);
              setItemDetails(basicItem);
              
              // Still notify that loading is complete (with basic data)
              window.dispatchEvent(new CustomEvent('itemDetailsLoaded'));
            }
          } catch (fetchError) {
            console.warn('Error fetching full item details:', fetchError);
            setItemDetails(basicItem);
            
            // Still notify that loading is complete (with basic data)
            window.dispatchEvent(new CustomEvent('itemDetailsLoaded'));
          }
        } else {
          // No collection info, use basic data
          console.warn('Collection not provided for item details');
          setItemDetails(basicItem);
          
          // Still notify that loading is complete (with basic data)
          window.dispatchEvent(new CustomEvent('itemDetailsLoaded'));
        }

        // Always hide thumbnail when showing details
        setThumbnail({ url: null, title: '', type: null });
      } catch (e) {
        console.error('Error handling showItemDetails:', e);
        // Fallback
        const basicItem = event.detail || null;
        if (basicItem) {
          setItemDetails(basicItem);
          
          // Still notify that loading is complete (with basic data)
          window.dispatchEvent(new CustomEvent('itemDetailsLoaded'));
        }
      }
    };

    // Close all overlays
    const hideOverlaysHandler = () => {
      try {
        setThumbnail({ url: null, title: '', type: null });
        setItemDetails(null);
      } catch (e) {
        console.error('Error handling hideOverlays:', e);
      }
    };
    
    // Add event listeners
    window.addEventListener('zoomToBbox', zoomToBboxHandler);
    window.addEventListener('showItemsOnMap', showItemsOnMapHandler);
    window.addEventListener('showItemThumbnail', showItemThumbnailHandler);
    window.addEventListener('showMapThumbnail', showMapThumbnailHandler);
    window.addEventListener('hideMapThumbnail', hideMapThumbnailHandler);
    window.addEventListener('showItemDetails', showItemDetailsHandler);
    const toggleBboxSearchHandler = () => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const newState = !isDrawingBbox;
      if (newState) {
        // Enable drawing; clear previous drawings and search results
        setIsDrawingBbox(true);
        if (drawRef.current) {
          drawRef.current.deleteAll();
          // Change to drawing mode
          drawRef.current.changeMode('draw_polygon');
        }
        setDrawnPolygonArea(null);
        
        // Clear existing search results for fresh drawing
        clearGeometries(map);
        window.dispatchEvent(new CustomEvent('hideOverlays'));
        window.dispatchEvent(new CustomEvent('clearSearchResults'));
        
        console.log('🔲 Polygon drawing ON - cleared previous results');
        window.dispatchEvent(new CustomEvent('bboxModeChanged', { detail: { isOn: true } }));
      } else {
        // Turning off drawing
        setIsDrawingBbox(false);
        if (drawRef.current) {
          drawRef.current.deleteAll();
          // Change back to select mode
          drawRef.current.changeMode('simple_select');
        }
        setDrawnPolygonArea(null);
        console.log('🔲 Polygon drawing OFF');
        window.dispatchEvent(new CustomEvent('bboxModeChanged', { detail: { isOn: false } }));
      }
    };
    window.addEventListener('toggleBboxSearch', toggleBboxSearchHandler);
    window.addEventListener('hideOverlays', hideOverlaysHandler);
    const selectedCollectionChangedHandler = (e) => {
      try {
        const id = e?.detail?.collectionId || null;
        setSelectedCollectionId(id);
      } catch (err) {
        console.warn('Error in selectedCollectionChangedHandler:', err);
      }
    };
    window.addEventListener('selectedCollectionChanged', selectedCollectionChangedHandler);

    const itemLimitChangedHandler = (e) => {
      try {
        const lim = Number(e?.detail?.limit);
        if (Number.isFinite(lim) && lim > 0) {
          setCurrentItemLimit(lim);
        }
      } catch (err) {
        console.warn('Error in itemLimitChangedHandler:', err);
      }
    };
    window.addEventListener('itemLimitChanged', itemLimitChangedHandler);

    const runSearchHandler = async (e) => {
      try {
        console.log('🔎 runSearch triggered, detail:', e?.detail);
        
        // Guard: ensure we have a map instance and it's loaded
        const map = mapRef.current?.getMap();
        if (!map) {
          console.warn('⚠️ runSearch: No map instance available');
          return;
        }
        if (!isMapLoaded) {
          console.warn('⚠️ runSearch: Map not loaded yet');
          return;
        }
        
        // Cancel any previous request
        if (searchControllerRef.current) {
          try { searchControllerRef.current.abort(); } catch {}
        }
        const controller = new AbortController();
        searchControllerRef.current = controller;
        const mySearchId = ++latestSearchIdRef.current;
        
        const limFromEvent = Number(e?.detail?.limit);
        const lim = Number.isFinite(limFromEvent) && limFromEvent > 0 ? limFromEvent : 10;
        
        // Build URL - unified for all search types
        const drawData = drawRef.current?.getAll();
        console.log('🔍 runSearch: drawData =', drawData);
        console.log('🔍 runSearch: drawnPolygonArea =', drawnPolygonArea);
        const baseUrl = stacApiUrlRef.current;
        let url;
        
        // Use different endpoints for single collection vs all collections
        if (selectedCollectionId) {
          // Single collection search - use /search endpoint with collections parameter
          // This ensures polygon filtering works consistently
          url = `${baseUrl}/search?collections=${encodeURIComponent(selectedCollectionId)}&limit=${encodeURIComponent(lim)}&fields=id,collection,bbox,geometry,properties.title,properties.datetime`;
        } else {
          // All collections search endpoint
          url = `${baseUrl}/search?limit=${encodeURIComponent(lim)}&fields=id,collection,bbox,geometry,properties.title,properties.datetime`;
        }
        
        // Add polygon if present
        if (drawData && drawData.features.length > 0) {
          const polygon = drawData.features[0];
          const geoJson = JSON.stringify(polygon.geometry);
          url += `&intersects=${encodeURIComponent(geoJson)}`;
          console.log('🔎 Searching with drawn polygon');
          console.log('📐 Polygon GeoJSON:', polygon.geometry);
          console.log('🔗 Polygon intersects parameter:', geoJson);
          
          // Dispatch event to sync intersects filter with collection details
          window.dispatchEvent(new CustomEvent('intersectsFilterChanged', { 
            detail: { intersectsFilter: geoJson } 
          }));
        } else {
          console.log('🔎 Searching without polygon - no features found');
          
          // Clear intersects filter when no polygon
          window.dispatchEvent(new CustomEvent('intersectsFilterChanged', { 
            detail: { intersectsFilter: '' } 
          }));
        }
        
        // Add datetime filter if present
        if (appliedDatetimeFilterRef.current) {
          console.log('... with datetime:', appliedDatetimeFilterRef.current);
          url += `&datetime=${encodeURIComponent(appliedDatetimeFilterRef.current)}`;
        }
        
        // Add cloud cover filter if present
        if (appliedCloudCoverFilterRef.current) {
          console.log('... with cloud cover:', appliedCloudCoverFilterRef.current);
          url += `&query=${encodeURIComponent(appliedCloudCoverFilterRef.current)}`;
        }
        
        // Perform fetch
        console.log('%c🔗 INITIAL MAP LOAD:', 'color: blue; font-weight: bold; font-size: 14px;');
        console.log('%cGET ' + url, 'color: green; font-family: monospace; font-size: 12px;');
        console.log('%c📋 Using fields extension for fast map display', 'color: orange; font-weight: bold;');
        console.log('%c🔍 Complete API Request:', 'color: purple; font-weight: bold;');
        console.log('%c' + url, 'color: purple; font-family: monospace; font-size: 11px;');
        lastSearchUrlRef.current = url; // Store for download
        window.dispatchEvent(new CustomEvent('hideOverlays'));
        
        const resp = await fetch(url, { method: 'GET', signal: controller.signal });
        if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
        const data = await resp.json();
        
        // Check staleness AFTER fetch
        if (latestSearchIdRef.current !== mySearchId || controller.signal.aborted) {
          console.log(`🔄 Ignoring stale or aborted search response (ID: ${mySearchId})`);
          return;
        }
        
        const features = Array.isArray(data.features) ? data.features : [];
        console.log('%c📊 SEARCH RESULTS:', 'color: purple; font-weight: bold;');
        console.log('Features returned:', features.length);
        console.log('numberReturned:', data.numberReturned);
        console.log('numberMatched:', data.numberMatched);
        
        // Extract next link from API response
        const nextSearchLink = data.links?.find(l => l.rel === 'next')?.href;
        
        // Process features
        const processedFeatures = features.map(item => ({
          id: item.id,
          title: item.properties?.title || item.id,
          geometry: item.geometry || null,
          bbox: item.bbox || null,
          collection: item.collection || null,
          properties: item.properties || {},
          assetsCount: Object.keys(item.assets || {}).length,
          datetime: item.properties?.datetime || item.properties?.start_datetime || null
        }));
        
        // Dispatch showItemsOnMap event with count values
        window.dispatchEvent(new CustomEvent('showItemsOnMap', { 
          detail: { 
            items: processedFeatures, 
            numberReturned: data.numberReturned != null ? data.numberReturned : features.length,
            numberMatched: data.numberMatched != null ? data.numberMatched : null,
            searchId: mySearchId  
          } 
        }));
        
        if (nextSearchLink) {
          window.dispatchEvent(new CustomEvent('updateNextLink', { detail: { nextLink: nextSearchLink } }));
        }
        
      } catch (err) {
        if (err?.name === 'AbortError') {
          console.log('Search aborted');
        } else {
          console.error('runSearch error:', err);
        }
      } finally {
        // Clear controller if it's still ours
        if (searchControllerRef.current && searchControllerRef.current.signal.aborted) {
          searchControllerRef.current = null;
        }
      }
    };
    window.addEventListener('runSearch', runSearchHandler);
    
    const downloadFullResultsHandler = async () => {
      try {
        const lastUrl = lastSearchUrlRef.current;
        if (!lastUrl) {
          alert('No search has been performed yet. Please search for items first.');
          return;
        }
        
        // Remove the fields parameter from the URL
        const url = new URL(lastUrl);
        url.searchParams.delete('fields');
        const fullUrl = url.toString();
        
        console.log('%c🔗 DOWNLOADING FULL RESULTS:', 'color: green; font-weight: bold; font-size: 14px;');
        console.log('%cOriginal search URL:', lastUrl, 'color: green;');
        console.log('%cDownload URL (no fields):', fullUrl, 'color: green; font-family: monospace; font-size: 12px;');
        console.log('%c📋 Downloading complete feature collection with all metadata', 'color: red; font-weight: bold;');
        
        const resp = await fetch(fullUrl);
        if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
        const data = await resp.json();
        
        const features = Array.isArray(data.features) ? data.features : [];
        
        // Create filename
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `search_results_${timestamp}.geojson`;
        
        // Create and download the file
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' });
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
        console.error('Download error:', error);
        alert(`Failed to download results: ${error.message}`);
      }
    };
    window.addEventListener('downloadFullResults', downloadFullResultsHandler);
    
    const clearBboxHandler = () => {
      const map = mapRef.current?.getMap();
      if (map) {
        console.log('🧹 Clearing polygon drawings');
        if (drawRef.current) {
          drawRef.current.deleteAll();
        }
        setDrawnPolygonArea(null);
        
        // Clear intersects filter when polygons are cleared
        window.dispatchEvent(new CustomEvent('intersectsFilterChanged', { 
          detail: { intersectsFilter: '' } 
        }));
      }
    };
    window.addEventListener('clearBbox', clearBboxHandler);
    
    const clearItemGeometriesHandler = () => {
      const map = mapRef.current?.getMap();
      if (map) {
        console.log('🧹 Clearing item geometries');
        clearGeometries(map);
      }
    };
    window.addEventListener('clearItemGeometries', clearItemGeometriesHandler);
    
    const clearSearchResultsHandler = () => {
      const map = mapRef.current?.getMap();
      if (map) {
        console.log('🧹 Clearing search results');
        clearGeometries(map);
      }
    };
    window.addEventListener('clearSearchResults', clearSearchResultsHandler);
    
    const clearSearchCacheHandler = () => {
      console.log('🧹 Clearing search cache and aborting operations');
      try {
        // Abort any pending searches
        if (searchControllerRef.current) {
          try { searchControllerRef.current.abort(); } catch {}
        }
        const controller = new AbortController();
        searchControllerRef.current = controller;
        
        // Clear search state
        latestSearchIdRef.current = 0;
        
        // Clear map geometry and layers
        const map = mapRef.current?.getMap();
        if (map) {
          clearGeometries(map);
          if (drawRef.current) {
            drawRef.current.deleteAll();
          }
          setDrawnPolygonArea(null);
          
          // Clear intersects filter when polygons are cleared
          window.dispatchEvent(new CustomEvent('intersectsFilterChanged', { 
            detail: { intersectsFilter: '' } 
          }));
        }
        
        // Clear any pending animations
        if (pendingRafRef.current) {
          try { cancelAnimationFrame(pendingRafRef.current); } catch {}
          pendingRafRef.current = null;
        }
        isAnimatingRef.current = false;
        
        // Hide overlays
        window.dispatchEvent(new CustomEvent('hideOverlays'));
        
        console.log('✅ Search cache cleared');
      } catch (err) {
        console.warn('Error clearing search cache:', err);
      }
    };
    window.addEventListener('clearSearchCache', clearSearchCacheHandler);
    
    // Log the current map state
    if (map) {
      console.log('Current map state:', {
        center: map.getCenter(),
        zoom: map.getZoom(),
        loaded: map.loaded()
      });
    }
    
    // Clean up event listeners
    return () => {
      console.log('Cleaning up map event listeners');
      window.removeEventListener('zoomToBbox', zoomToBboxHandler);
      window.removeEventListener('showItemsOnMap', showItemsOnMapHandler);
      window.removeEventListener('showItemThumbnail', showItemThumbnailHandler);
      window.removeEventListener('showMapThumbnail', showMapThumbnailHandler);
      window.removeEventListener('hideMapThumbnail', hideMapThumbnailHandler);
      window.removeEventListener('showItemDetails', showItemDetailsHandler);
      window.removeEventListener('hideOverlays', hideOverlaysHandler);
      window.removeEventListener('toggleBboxSearch', toggleBboxSearchHandler);
      window.removeEventListener('selectedCollectionChanged', selectedCollectionChangedHandler);
      window.removeEventListener('itemLimitChanged', itemLimitChangedHandler);
      window.removeEventListener('runSearch', runSearchHandler);
      window.removeEventListener('downloadFullResults', downloadFullResultsHandler);
      window.removeEventListener('clearBbox', clearBboxHandler);
      window.removeEventListener('clearItemGeometries', clearItemGeometriesHandler);
      window.removeEventListener('clearSearchResults', clearSearchResultsHandler);
      window.removeEventListener('clearSearchCache', clearSearchCacheHandler);
    };
  }, [isMapLoaded, handleZoomToBbox, handleShowItemsOnMap, isDrawingBbox, clearGeometries, selectedCollectionId, currentItemLimit, drawnPolygonArea]);

  // handleShowItemsOnMap has been moved up in the file

  return (
    <div className="map-container" ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <MapLibreMap
        ref={mapRef}
        // Set the initial map state
        initialViewState={{
          longitude: 0,
          latitude: 20,
          zoom: 2,
          maxZoom: 20,
          minZoom: 1,
          pitch: projection === 'globe' ? 0 : undefined,  // Disable pitch on globe to prevent errors
          bearing: projection === 'globe' ? 0 : undefined  // Disable bearing on globe to prevent errors
        }}
        projection={projection}
        renderWorldCopies={projection === 'mercator'}
        maxPitch={projection === 'globe' ? 0 : 60}  // Prevent pitch on globe
        
        // Leave map uncontrolled to avoid animation conflicts
        
        // Handle map load
        onLoad={handleMapLoad}
        
        // This is the full-screen styling
        style={{ width: '100%', height: '100%' }}
        
        // Set the map style from state
        mapStyle={mapStyle}
        
        // Basic interaction settings
        interactive={true}
        touchZoomRotate={true}
        dragRotate={projection === 'mercator'}  // Disable drag rotation on globe
        dragPan={true}
        doubleClickZoom={true}
        scrollZoom={true}
        boxZoom={true}
        keyboard={true}
        cursor={isDrawingBbox ? 'crosshair' : undefined}
        
        // Performance optimizations
        reuseMaps={false}
        transformRequest={(url) => {
          return { url };
        }}
        
        // Attribution control - disable default attribution
        attributionControl={false}
      />
      {/* Custom attribution in bottom left */}
      <div className="map-attribution">
        <a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">MapLibre</a> | 
        © <a href="https://maptiler.com/" target="_blank" rel="noopener noreferrer">MapTiler</a> | 
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> | 
        © <a href="https://github.com/Healy-Hyperspatial" target="_blank" rel="noopener noreferrer">Healy-Hyperspatial</a>
      </div>
      {/* Polygon area display - bottom center */}
      {drawnPolygonArea !== null && (
        <div
          className="calculation-box"
          style={{
            position: 'absolute',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(255, 255, 255, 0.75)',
            padding: '8px 16px',
            textAlign: 'center',
            fontFamily: 'Open Sans',
            fontSize: 13,
            borderRadius: 4,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            zIndex: 1000
          }}
        >
          <p style={{ fontFamily: 'Open Sans', margin: 0, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <strong>{drawnPolygonArea}</strong>
            <span style={{ marginLeft: '4px', fontSize: 11, color: '#666', fontWeight: 'normal' }}>
              sq. km
            </span>
          </p>
        </div>
      )}
      {/* HH GH Logo in bottom right */}
      <div className="hh-gh-logo">
        <a href="https://github.com/Healy-Hyperspatial" target="_blank" rel="noopener noreferrer">
          <img src={`${process.env.PUBLIC_URL}/assets/hh-gh-logo-dl.png`} alt="HH GH Logo" />
        </a>
      </div>
      <div className="left-panels-wrapper">
        <LogoOverlay />
        <StacClient stacApiUrl={stacApiUrl} />
        {itemDetails && (
          <ItemDetailsOverlay 
            details={itemDetails}
            onClose={() => setItemDetails(null)}
          />
        )}
        {thumbnail.title && (
          <ThumbnailOverlay 
            url={thumbnail.url} 
            title={thumbnail.title}
            type={thumbnail.type}
            onClose={() => setThumbnail({ url: null, title: '', type: null })}
          />
        )}
      </div>
      <div className="map-controls">
        <div className="control-section">
          <div className="control-label">View</div>
          <button 
            className="fullscreen-btn"
            onClick={handleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            ⛶
          </button>
        </div>
        {/* Re-enable globe controls with safer implementation */}
        <div className="control-section">
          <div className="control-label">Globe</div>
          <button
            className="fullscreen-btn"
            onClick={() => setProjection(projection === 'mercator' ? 'globe' : 'mercator')}
            title={projection === 'globe' ? "Switch to flat map" : "Switch to globe"}
          >
            {projection === 'globe' ? '🌍' : '🗺️'}
          </button>
        </div>
        <div className="control-section">
          <div className="control-label">Map Style</div>
          <MapStyleSelector 
            value={mapStyle} 
            onChange={handleStyleChange} 
          />
        </div>
        <div className="control-section">
          <div className="control-label">Theme</div>
          <DarkModeToggle 
            currentStyle={mapStyle}
            onStyleChange={handleStyleChange}
          />
        </div>
        <div className="control-section">
          <div className="control-label">API Server</div>
          <button 
            className="url-toggle-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('toggleUrlBox'))}
            title="Toggle URL box"
          >
            🔗
          </button>
        </div>
        <div className="control-section">
          <div className="control-label">Public APIs</div>
          <button
            className="url-toggle-btn"
            onClick={() => setShowPublicLinks(v => !v)}
            title={showPublicLinks ? 'Hide public API links' : 'Show public API links'}
          >
            🌐
          </button>
        </div>
      </div>
      {mapThumbnail.url && (
        <MapThumbnailOverlay
          key={`${mapThumbnail.url}-${Date.now()}`}
          mapRef={mapRef}
          itemGeometry={mapThumbnail.geometry}
          thumbnailUrl={mapThumbnail.url}
          title={mapThumbnail.title}
          type={mapThumbnail.type}
        />
      )}
      {showPublicLinks && (
        <div className="public-links-box">
          <div className="public-links-header">
            <div className="public-links-title">Public API Links</div>
            <button className="public-links-close" onClick={() => setShowPublicLinks(false)} title="Close">✕</button>
          </div>
          <div className="public-links-content">
            <ul>
              <li><a href={`${stacApiUrl}`} target="_blank" rel="noreferrer">Base: {stacApiUrl}</a></li>
              <li><a href={`${stacApiUrl}/conformance`} target="_blank" rel="noreferrer">/conformance</a></li>
              <li><a href={`${stacApiUrl}/collections`} target="_blank" rel="noreferrer">/collections</a></li>
              {selectedCollectionId && (
                <li><a href={`${stacApiUrl}/search?collections=${encodeURIComponent(selectedCollectionId)}&limit=${encodeURIComponent(currentItemLimit)}`} target="_blank" rel="noreferrer">/search?collections={selectedCollectionId}&limit={currentItemLimit}</a></li>
              )}
              <li><a href={`${stacApiUrl}/search?limit=${encodeURIComponent(currentItemLimit)}`} target="_blank" rel="noreferrer">/search?limit={currentItemLimit}</a></li>
            </ul>
            <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', margin: '8px 0' }} />
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Quick Switch APIs</div>
            <ul>
              <li>
                <button type="button" className="public-link-button" onClick={() => handleSwitchApi('https://api.stac.worldpop.org')} title="Use WorldPop STAC API">
                  <span className="public-link-icon">🌍</span>
                  <span className="public-link-text">https://api.stac.worldpop.org</span>
                </button>
              </li>
              <li>
                <button type="button" className="public-link-button" onClick={() => handleSwitchApi('https://landsatlook.usgs.gov/stac-server')} title="Use USGS LandsatLook STAC API">
                  <span className="public-link-icon">🛰️</span>
                  <span className="public-link-text">https://landsatlook.usgs.gov/stac-server</span>
                </button>
              </li>
              <li>
                <button type="button" className="public-link-button" onClick={() => handleSwitchApi('https://stac.dataspace.copernicus.eu/v1')} title="Use Copernicus Dataspace STAC API">
                  <span className="public-link-icon">🇪🇺</span>
                  <span className="public-link-text">https://stac.dataspace.copernicus.eu/v1</span>
                </button>
              </li>
              <li>
                <button type="button" className="public-link-button" onClick={() => handleSwitchApi('https://stac.terrascope.be')} title="Use Terrascope STAC API">
                  <span className="public-link-icon">🌍</span>
                  <span className="public-link-text">https://stac.terrascope.be</span>
                </button>
              </li>
              <li>
                <button type="button" className="public-link-button" onClick={() => handleSwitchApi('https://explorer.digitalearth.africa/stac')} title="Use Digital Earth Africa STAC API">
                  <span className="public-link-icon">🌍</span>
                  <span className="public-link-text">https://explorer.digitalearth.africa/stac</span>
                </button>
              </li>
              <li>
                <button type="button" className="public-link-button" onClick={() => handleSwitchApi('https://earth-search.aws.element84.com/v1')} title="Use Earth Search by Element 84 STAC API">
                  <span className="public-link-icon">☁️</span>
                  <span className="public-link-text">https://earth-search.aws.element84.com/v1</span>
                </button>
              </li>
              <li>
                <button type="button" className="public-link-button" onClick={() => handleSwitchApi('https://stac.openeo.vito.be')} title="Use OpenEO VITO STAC API">
                  <span className="public-link-icon">🛰️</span>
                  <span className="public-link-text">https://stac.openeo.vito.be</span>
                </button>
              </li>
            </ul>
          </div>
        </div>
      )}
      <UrlSearchBox
        key={stacApiUrl}
        initialUrl={stacApiUrl}
        onUpdate={(newUrl) => {
          let trimmed = (newUrl || '').trim();
          if (!trimmed) {
            console.warn('Empty URL provided');
            return;
          }
          
          // Remove trailing slash if present for consistency
          trimmed = trimmed.replace(/\/+$/, '');
          
          // Update URL in the browser's address bar
          const url = new URL(window.location);
          url.searchParams.set('stacApiUrl', trimmed);
          window.history.pushState({}, '', url);
          
          stacApiUrlRef.current = trimmed;
          setStacApiUrl(trimmed);
          resetToInitialState();
        }}
      />
    </div>
  );
}

export default SFEOSMap;