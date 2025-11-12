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
  const [dragStartLngLat, setDragStartLngLat] = useState(null); // {lng, lat}
  const [currentBbox, setCurrentBbox] = useState(null); // [minLon, minLat, maxLon, maxLat]
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [currentItemLimit, setCurrentItemLimit] = useState(10);
  const [stacApiUrl, setStacApiUrl] = useState(getInitialStacApiUrl);
  const [mapThumbnail, setMapThumbnail] = useState({ geometry: null, url: null, title: '', type: null });
  const [showPublicLinks, setShowPublicLinks] = useState(false);
  const [projection, setProjection] = useState('mercator'); // 'mercator' or 'globe'
  
  // Refs
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const bboxLayers = useRef(new Set()); // Track bounding box layer IDs
  const stacApiUrlRef = useRef(stacApiUrl);
  const appliedDatetimeFilterRef = useRef(''); // Track datetime filter from StacCollectionDetails
  const searchControllerRef = useRef(null); // AbortController for in-flight searches
  const latestSearchIdRef = useRef(0); // Monotonic ID to ignore stale results
  const isAnimatingRef = useRef(false); // Prevent overlapping map animations

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
    
    console.log('Map center:', map.getCenter(), 'Zoom:', map.getZoom());
    setIsMapLoaded(true);
  }, []);

  // Update projection when it changes
  useEffect(() => {
    if (!isMapLoaded) return;
    
    try {
      const map = mapRef.current?.getMap();
      if (!map) return;
      
      // Set projection after style loads
      const setProjectionAfterStyleLoad = () => {
        try {
          map.setProjection({
            type: projection,
          });
          console.log('Projection set to:', projection);
        } catch (err) {
          console.warn('Error setting projection:', err);
        }
      };
      
      // If style is already loaded, set projection immediately
      if (map.isStyleLoaded()) {
        setProjectionAfterStyleLoad();
      } else {
        // Otherwise wait for style.load event
        map.once('style.load', setProjectionAfterStyleLoad);
      }
    } catch (err) {
      console.warn('Error in projection effect:', err);
    }
  }, [projection, isMapLoaded]);

  // Helpers for bbox drawing layer
  const addOrUpdateBboxLayer = useCallback((map, bbox) => {
    if (!bbox || bbox.length !== 4) return;
    const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
    const polygon = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat]
        ]]
      }
    };
    const sourceId = 'bbox-draw-source';
    const fillLayerId = 'bbox-draw-fill';
    const lineLayerId = 'bbox-draw-line';
    if (map.getSource(sourceId)) {
      map.getSource(sourceId).setData({ type: 'FeatureCollection', features: [polygon] });
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [polygon] }
      });
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#4a90e2',
          'fill-opacity': 0.15
        }
      });
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#4a90e2',
          'line-width': 2
        }
      });
    }
  }, []);

  const clearBboxLayer = useCallback((map) => {
    const sourceId = 'bbox-draw-source';
    const fillLayerId = 'bbox-draw-fill';
    const lineLayerId = 'bbox-draw-line';
    try {
      if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
      if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch (e) {
      console.warn('Error clearing bbox draw layer:', e);
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

  
  // Function to add a geometry to the map
  const addGeometry = useCallback((map, id, geometry, color = '#FF0000', width = 2, itemData = null) => {
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
      
      // Add click handler for item details if itemData is provided
      if (itemData) {
        map.on('click', `geometry-fill-${id}`, (e) => {
          console.log('🖱️ Clicked on geometry:', id, itemData);
          
          // Select the item in the list
          window.dispatchEvent(new CustomEvent('selectItem', {
            detail: { itemId: itemData.id }
          }));
          
          // Show item details overlay
          window.dispatchEvent(new CustomEvent('showItemDetails', {
            detail: {
              id: itemData.id,
              title: itemData.title || itemData.id,
              datetime: itemData.datetime || null,
              assetsCount: itemData.assetsCount || 0,
              bbox: itemData.bbox || null,
              collection: itemData.collection || null,
              properties: itemData.properties || {}
            }
          }));
          
          // Zoom to the item's bbox if available with better zoom level
          if (itemData.bbox) {
            const zoomEvent = new CustomEvent('zoomToBbox', { 
              detail: { 
                bbox: itemData.bbox,
                options: {
                  padding: 50,
                  maxZoom: 18,
                  essential: true
                }
              }
            });
            console.log('Zooming to item bbox:', itemData.bbox);
            window.dispatchEvent(zoomEvent);
          }
          
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
    if (!map) return;
    
    // Remove all bbox layers
    bboxLayers.current.forEach(layerId => {
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
    });
    
    // Remove all bbox sources (avoiding duplicates)
    const removedSources = new Set();
    bboxLayers.current.forEach(layerId => {
      const sourceId = layerId.replace('-fill', '').replace('-line', '');
      if (!removedSources.has(sourceId) && map.getSource(sourceId)) {
        map.removeSource(sourceId);
        removedSources.add(sourceId);
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
      if (map.getLayer(layer.id)) {
        map.removeLayer(layer.id);
      }
      const sourceId = layer.source;
      if (sourceId && map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    });
  }, []);

  const resetToInitialState = useCallback(() => {
    console.log('🔄 Resetting map to initial state');
    setThumbnail({ url: null, title: '', type: null });
    setItemDetails(null);
    setIsDrawingBbox(false);
    setDragStartLngLat(null);
    setCurrentBbox(null);
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
        clearBboxLayer(map);
        map.jumpTo({
          center: [DEFAULT_VIEW_STATE.longitude, DEFAULT_VIEW_STATE.latitude],
          zoom: DEFAULT_VIEW_STATE.zoom
        });
        console.log('✅ Map reset to initial view');
      } catch (err) {
        console.warn('Failed to reset map view:', err);
      }
    }
  }, [clearGeometries, clearBboxLayer]);

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
      
      // Get the map instance
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
      
      const { items = [] } = event.detail || {};
      
      // Clear any existing geometries
      console.log('🧹 Clearing existing geometries');
      clearGeometries(map);
      
      if (!Array.isArray(items) || items.length === 0) {
        console.log('❌ No valid items array provided or empty items array - geometries cleared');
        return;
      }
      
      // Process items and add their geometries
      const validGeometries = items
        .filter(item => item?.geometry)
        .map(item => ({
          geometry: item.geometry,
          id: item.id || `item-${Math.random().toString(36).substr(2, 9)}`,
          itemData: item // Store full item data for interactivity
        }));
        
      if (validGeometries.length === 0) {
        console.error('❌ No valid geometries found in items');
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
      
      validGeometries.forEach(({ geometry }) => {
        if (!geometry) return;
        
        if (geometry.type === 'Point' && geometry.coordinates) {
          const [lon, lat] = geometry.coordinates;
          updateBbox(lon, lat);
        } else if (geometry.type === 'LineString' && geometry.coordinates) {
          geometry.coordinates.forEach(([lon, lat]) => updateBbox(lon, lat));
        } else if (geometry.type === 'Polygon' && geometry.coordinates) {
          geometry.coordinates[0].forEach(([lon, lat]) => updateBbox(lon, lat));
        } else if (geometry.type === 'MultiPoint' && geometry.coordinates) {
          geometry.coordinates.forEach(([lon, lat]) => updateBbox(lon, lat));
        } else if (geometry.type === 'MultiLineString' && geometry.coordinates) {
          geometry.coordinates.forEach(line => {
            line.forEach(([lon, lat]) => updateBbox(lon, lat));
          });
        } else if (geometry.type === 'MultiPolygon' && geometry.coordinates) {
          geometry.coordinates.forEach(polygon => {
            polygon[0].forEach(([lon, lat]) => updateBbox(lon, lat));
          });
        }
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
      
      console.log('✅ Center:', { centerLon, centerLat });
      console.log('📍 Bbox corners:', { minLon: combinedBbox[0], minLat: combinedBbox[1], maxLon: combinedBbox[2], maxLat: combinedBbox[3] });
      console.log('📊 Item count:', validGeometries.length, 'Coordinate count:', allCoords.length);
      
      // Zoom to the combined bounds
      const [minLon, minLat, maxLon, maxLat] = combinedBbox;
      
      // Calculate zoom level based on bbox size
      let lonDiff = maxLon - minLon;
      if (projection === 'globe' && lonDiff > 180) lonDiff = 360 - lonDiff; // AM-aware only on globe
      const latDiff = maxLat - minLat;
      const maxDiff = Math.max(lonDiff, latDiff, 0.001); // Ensure we don't get Infinity
      let zoom = Math.max(0, Math.min(13, 13 - Math.log2(maxDiff / 0.08))); // Reduced divisor from 0.12 to 0.08 for higher zoom
      
      // For globe projection, apply zoom adjustment to keep globe size consistent
      if (projection === 'globe') {
        const currentLat = map.getCenter().lat;
        const targetLat = centerLat;
        // Calculate zoom adjustment: log2(cos(targetLat) / cos(currentLat))
        const zoomAdjustment = Math.log2(Math.cos(targetLat / 180 * Math.PI) / Math.cos(currentLat / 180 * Math.PI));
        zoom = Math.max(2.8, Math.min(13, zoom + zoomAdjustment)); // Clamp between 2.8 and 13 for globe
        console.log('🌍 Globe zoom adjustment:', { currentLat, targetLat, zoomAdjustment, adjustedZoom: zoom });
      }
      
      console.log('🎯 Flying to:', { centerLon, centerLat, zoom, projection });
      
      // Ensure map is ready before flying
      if (!map.isStyleLoaded()) {
        console.log('Map style not loaded yet, waiting...');
        map.once('styledata', () => {
          performFlyTo();
        });
      } else {
        performFlyTo();
      }
      
      function performFlyTo() {
        // Use flyTo for smooth animation - don't set viewState manually as it conflicts
        try {
          // Stop any ongoing animation first
          if (map.isEasing && map.isEasing()) {
            map.stop();
          }
          // Mark animating and clear on moveend
          try { isAnimatingRef.current = true; } catch {}
          map.once('moveend', () => { isAnimatingRef.current = false; });
          map.flyTo({
            center: [centerLon, centerLat],
            zoom: zoom,
            bearing: 0, // Reset bearing to face north
            pitch: 0,   // Reset pitch to top-down view
            duration: 1000,
            essential: true,
            minZoom: 2.8  // Prevent globe from shrinking too much
          });
        } catch (error) {
          console.error('Error in flyTo, using jumpTo fallback:', error);
          // Fallback to jumpTo if flyTo fails
          map.jumpTo({
            center: [centerLon, centerLat],
            zoom: zoom,
            bearing: 0,
            pitch: 0
          });
        }
      }
      
      
      // Add geometry for each valid item
      validGeometries.forEach(({ geometry, id, itemData }, index) => {
        const hue = (index * 137.5) % 360; // Golden angle for distinct colors
        const color = `hsl(${hue}, 80%, 50%)`;
        // Only log first and last items to reduce console spam
        if (index === 0 || index === validGeometries.length - 1) {
          console.log(`🎨 Adding geometry for item ${index} (${id}):`, geometry);
        }
        addGeometry(map, id, geometry, color, 2, itemData);
      });
      
      console.log('✅ Map updated with', validGeometries.length, 'geometries');
    } catch (error) {
      console.error('Error in handleShowItemsOnMap:', error);
    }
  }, [addGeometry, clearGeometries, projection]);

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
        map.jumpTo({
          center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
          zoom: Math.min(10, maxZoom)
        });
      }
      
      // Use requestAnimationFrame to ensure map is ready
      requestAnimationFrame(() => {
        try {
          // For globe projection, we need to apply zoom adjustment to keep globe size consistent
          let adjustedMaxZoom = maxZoom;
          if (projection === 'globe') {
            const currentLat = map.getCenter().lat;
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
          // Fit bounds with padding and max zoom
          map.fitBounds(bounds, {
            padding: padding,
            maxZoom: adjustedMaxZoom,
            minZoom: 2.8,  // Prevent globe from shrinking too much
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
  }, [projection]);

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
      } catch (e) {
        console.error('Error handling hideMapThumbnail:', e);
      }
    };

    const showItemDetailsHandler = (event) => {
      try {
        const d = event.detail || null;
        if (d) {
          setItemDetails(d);
          // Hide thumbnail overlay when showing details
          setThumbnail({ url: null, title: '', type: null });
        } else {
          console.warn('showItemDetails event missing detail');
        }
      } catch (e) {
        console.error('Error handling showItemDetails:', e);
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
        // Enable drawing; clear previous box
        setIsDrawingBbox(true);
        clearBboxLayer(map);
        setCurrentBbox(null);
        console.log('🔲 BBox drawing ON');
        window.dispatchEvent(new CustomEvent('bboxModeChanged', { detail: { isOn: true } }));
      } else {
        // Turning off drawing
        setIsDrawingBbox(false);
        setDragStartLngLat(null);
        console.log('🔲 BBox drawing OFF');
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
        // Cancel any previous request
        if (searchControllerRef.current) {
          try { searchControllerRef.current.abort(); } catch {}
        }
        const controller = new AbortController();
        searchControllerRef.current = controller;
        const mySearchId = ++latestSearchIdRef.current;
        const limFromEvent = Number(e?.detail?.limit);
        const lim = Number.isFinite(limFromEvent) && limFromEvent > 0 ? limFromEvent : 10;
        
        // If a bbox is drawn, search within it
        const bbox = currentBbox;
        if (bbox && bbox.length === 4 && selectedCollectionId) {
          console.log('🔎 Searching within drawn bbox');
          const bboxParam = bbox.map(n => Number(n)).join(',');
          console.log('Search params - bbox:', bboxParam, 'limit:', lim, 'collection:', selectedCollectionId);
          const baseUrl = stacApiUrlRef.current;
          let url = `${baseUrl}/search?collections=${encodeURIComponent(selectedCollectionId)}&bbox=${encodeURIComponent(bboxParam)}&limit=${encodeURIComponent(lim)}`;
          console.log('📅 Datetime filter ref value:', appliedDatetimeFilterRef.current);
          if (appliedDatetimeFilterRef.current) {
            url += `&datetime=${encodeURIComponent(appliedDatetimeFilterRef.current)}`;
            console.log('✅ Datetime filter ADDED to URL');
          } else {
            console.log('⚠️ Datetime filter is EMPTY');
          }
          console.log('%c🔗 FULL API CALL:', 'color: blue; font-weight: bold; font-size: 14px;');
          console.log('%cGET ' + url, 'color: green; font-family: monospace; font-size: 12px;');
          window.dispatchEvent(new CustomEvent('hideOverlays'));
          const resp = await fetch(url, { method: 'GET', signal: controller.signal });
          if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
          const data = await resp.json();
          // Ignore stale responses
          if (latestSearchIdRef.current !== mySearchId || controller.signal.aborted) {
            console.log('Ignoring stale or aborted search response');
            return;
          }
          const features = Array.isArray(data.features) ? data.features : [];
          console.log('%c📊 SEARCH RESULTS:', 'color: purple; font-weight: bold;');
          console.log('Features returned:', features.length);
          console.log('numberReturned:', data.numberReturned);
          console.log('numberMatched:', data.numberMatched);
          
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
          
          window.dispatchEvent(new CustomEvent('showItemsOnMap', { detail: { items: processedFeatures, numberReturned: data.numberReturned, numberMatched: data.numberMatched } }));
          window.dispatchEvent(new CustomEvent('zoomToBbox', { detail: { bbox } }));
        } else if (bbox && bbox.length === 4 && selectedCollectionId === null) {
          // All Collections bbox search
          console.log('🔎 Searching all collections within drawn bbox');
          const bboxParam = bbox.map(n => Number(n)).join(',');
          console.log('Search params - bbox:', bboxParam, 'limit:', lim, 'all collections');
          const baseUrl = stacApiUrlRef.current;
          let url = `${baseUrl}/search?bbox=${encodeURIComponent(bboxParam)}&limit=${encodeURIComponent(lim)}`;
          console.log('📅 Datetime filter ref value:', appliedDatetimeFilterRef.current);
          if (appliedDatetimeFilterRef.current) {
            url += `&datetime=${encodeURIComponent(appliedDatetimeFilterRef.current)}`;
            console.log('✅ Datetime filter ADDED to URL');
          } else {
            console.log('⚠️ Datetime filter is EMPTY');
          }
          console.log('%c🔗 FULL API CALL (All Collections):', 'color: blue; font-weight: bold; font-size: 14px;');
          console.log('%cGET ' + url, 'color: green; font-family: monospace; font-size: 12px;');
          window.dispatchEvent(new CustomEvent('hideOverlays'));
          const resp = await fetch(url, { method: 'GET' });
          if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
          const data = await resp.json();
          const features = Array.isArray(data.features) ? data.features : [];
          console.log('%c📊 ALL COLLECTIONS SEARCH RESULTS:', 'color: purple; font-weight: bold;');
          console.log('Features returned:', features.length);
          console.log('numberReturned:', data.numberReturned);
          console.log('numberMatched:', data.numberMatched);
          
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
          
          window.dispatchEvent(new CustomEvent('showItemsOnMap', { detail: { items: processedFeatures, numberReturned: data.numberReturned, numberMatched: data.numberMatched } }));
          window.dispatchEvent(new CustomEvent('zoomToBbox', { detail: { bbox } }));
        } else {
          // No bbox drawn, trigger re-fetch of query items with current limit
          console.log('🔎 No bbox, re-fetching query items with limit:', lim);
          window.dispatchEvent(new CustomEvent('refetchQueryItems', { detail: { limit: lim } }));
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
    
    const clearBboxHandler = () => {
      const map = mapRef.current?.getMap();
      if (map) {
        console.log('🧹 Clearing bbox layer');
        clearBboxLayer(map);
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
      window.removeEventListener('clearBbox', clearBboxHandler);
      window.removeEventListener('clearItemGeometries', clearItemGeometriesHandler);
    };
  }, [isMapLoaded, handleZoomToBbox, handleShowItemsOnMap, isDrawingBbox, clearBboxLayer, clearGeometries, currentBbox, selectedCollectionId, currentItemLimit]);

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
          minZoom: 1
        }}
        projection="mercator"
        renderWorldCopies={true}
        
        // Leave map uncontrolled to avoid animation conflicts
        
        // Handle map load
        onLoad={handleMapLoad}
        onMouseDown={(e) => {
          if (!isDrawingBbox) return;
          if (!e.lngLat) return;
          if (e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
          }
          setDragStartLngLat({ lng: e.lngLat.lng, lat: e.lngLat.lat });
        }}
        onMouseMove={(e) => {
          if (!isDrawingBbox || !dragStartLngLat) return;
          if (!e.lngLat) return;
          if (e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
          }
          const cur = { lng: e.lngLat.lng, lat: e.lngLat.lat };
          const bbox = [
            Math.min(dragStartLngLat.lng, cur.lng),
            Math.min(dragStartLngLat.lat, cur.lat),
            Math.max(dragStartLngLat.lng, cur.lng),
            Math.max(dragStartLngLat.lat, cur.lat)
          ];
          setCurrentBbox(bbox);
          const map = mapRef.current?.getMap();
          if (map) addOrUpdateBboxLayer(map, bbox);
        }}
        onMouseUp={async (e) => {
          if (!isDrawingBbox) return;
          if (e && e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
          }
          setDragStartLngLat(null);
          // Trigger GET /search?collections={id}&bbox=minLon,minLat,maxLon,maxLat or /search?bbox=... for all collections
          try {
            const bbox = currentBbox;
            if (!bbox || bbox.length !== 4) return;
            
            // Cancel any previous request and set up a new controller
            if (searchControllerRef.current) {
              try { searchControllerRef.current.abort(); } catch {}
            }
            const controller = new AbortController();
            searchControllerRef.current = controller;
            const mySearchId = ++latestSearchIdRef.current;

            if (selectedCollectionId) {
              // Single collection bbox search
              console.log('🔎 Searching within drawn bbox for collection:', selectedCollectionId);
              const bboxParam = bbox.map(n => Number(n)).join(',');
              const limitParam = currentItemLimit;
              const baseUrl = stacApiUrlRef.current;
              let url = `${baseUrl}/search?collections=${encodeURIComponent(selectedCollectionId)}&bbox=${encodeURIComponent(bboxParam)}&limit=${encodeURIComponent(limitParam)}`;
              console.log('📅 Datetime filter ref value (onMouseUp):', appliedDatetimeFilterRef.current);
              if (appliedDatetimeFilterRef.current) {
                url += `&datetime=${encodeURIComponent(appliedDatetimeFilterRef.current)}`;
                console.log('✅ Datetime filter ADDED to URL');
              } else {
                console.log('⚠️ Datetime filter is EMPTY');
              }
              console.log('%c🔗 FULL API CALL (onMouseUp):', 'color: blue; font-weight: bold; font-size: 14px;');
              console.log('%cGET ' + url, 'color: green; font-family: monospace; font-size: 12px;');
              window.dispatchEvent(new CustomEvent('hideOverlays'));
              const resp = await fetch(url, { method: 'GET', signal: controller.signal });
              if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
              const data = await resp.json();
              if (latestSearchIdRef.current !== mySearchId || controller.signal.aborted) {
                console.log('Ignoring stale or aborted bbox search response (collection)');
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
              
              window.dispatchEvent(new CustomEvent('showItemsOnMap', { detail: { items: processedFeatures, numberReturned: data.numberReturned, numberMatched: data.numberMatched } }));
              window.dispatchEvent(new CustomEvent('zoomToBbox', { detail: { bbox } }));
              
              // Dispatch bbox search nextLink to update pagination
              const bboxNextLink = data.links?.find(l => l.rel === 'next')?.href;
              if (bboxNextLink) {
                window.dispatchEvent(new CustomEvent('updateNextLink', { detail: { nextLink: bboxNextLink } }));
              }
              
              // Optionally exit draw mode after search
              setIsDrawingBbox(false);
            } else {
              // All Collections bbox search
              console.log('🔎 Searching all collections within drawn bbox');
              const bboxParam = bbox.map(n => Number(n)).join(',');
              const limitParam = currentItemLimit;
              const baseUrl = stacApiUrlRef.current;
              let url = `${baseUrl}/search?bbox=${encodeURIComponent(bboxParam)}&limit=${encodeURIComponent(limitParam)}`;
              console.log('📅 Datetime filter ref value (onMouseUp):', appliedDatetimeFilterRef.current);
              if (appliedDatetimeFilterRef.current) {
                url += `&datetime=${encodeURIComponent(appliedDatetimeFilterRef.current)}`;
                console.log('✅ Datetime filter ADDED to URL');
              } else {
                console.log('⚠️ Datetime filter is EMPTY');
              }
              console.log('%c🔗 FULL API CALL (All Collections onMouseUp):', 'color: blue; font-weight: bold; font-size: 14px;');
              console.log('%cGET ' + url, 'color: green; font-family: monospace; font-size: 12px;');
              window.dispatchEvent(new CustomEvent('hideOverlays'));
              const resp = await fetch(url, { method: 'GET', signal: controller.signal });
              if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
              const data = await resp.json();
              if (latestSearchIdRef.current !== mySearchId || controller.signal.aborted) {
                console.log('Ignoring stale or aborted bbox search response (all collections)');
                return;
              }
              const features = Array.isArray(data.features) ? data.features : [];
              console.log('%c📊 ALL COLLECTIONS SEARCH RESULTS (onMouseUp):', 'color: purple; font-weight: bold;');
              console.log('Features returned:', features.length);
              
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
              
              window.dispatchEvent(new CustomEvent('showItemsOnMap', { detail: { items: processedFeatures, numberReturned: data.numberReturned, numberMatched: data.numberMatched } }));
              window.dispatchEvent(new CustomEvent('zoomToBbox', { detail: { bbox } }));
              
              // Dispatch bbox search nextLink to update pagination
              const bboxNextLink = data.links?.find(l => l.rel === 'next')?.href;
              if (bboxNextLink) {
                window.dispatchEvent(new CustomEvent('updateNextLink', { detail: { nextLink: bboxNextLink } }));
              }
              
              // Optionally exit draw mode after search
              setIsDrawingBbox(false);
            }
          } catch (err) {
            if (err?.name === 'AbortError') {
              console.log('BBox search aborted');
            } else {
              console.error('Error performing bbox GET /search:', err);
            }
          }
        }}
        
        // This is the full-screen styling
        style={{ width: '100%', height: '100%' }}
        
        // Set the map style from state
        mapStyle={mapStyle}
        
        // Basic interaction settings
        interactive={true}
        touchZoomRotate={true}
        dragRotate={!isDrawingBbox}
        dragPan={!isDrawingBbox}
        doubleClickZoom={!isDrawingBbox}
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
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>
      </div>
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
                <li><a href={`${stacApiUrl}/collections/${encodeURIComponent(selectedCollectionId)}/items?limit=${encodeURIComponent(currentItemLimit)}`} target="_blank" rel="noreferrer">/collections/{selectedCollectionId}/items</a></li>
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