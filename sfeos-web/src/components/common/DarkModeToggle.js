import React, { useState, useEffect } from 'react';
import { getStyleUrl } from '../../mapstyle';
import './DarkModeToggle.css';

function DarkModeToggle({ currentStyle, onStyleChange }) {
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Detect system preference on mount
  useEffect(() => {
    const mediaQueryObj = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(mediaQueryObj.matches);
  }, []);

  const handleToggle = (e) => {
    const newDarkMode = e.target.checked;
    setIsDarkMode(newDarkMode);
    
    const apiKey = process.env.REACT_APP_MAPTILER_KEY;
    
    // Map of base styles to their dark variants
    // If a style doesn't have a dark variant, it will fall back to backdrop-dark
    const darkModeMap = {
      'streets': 'streets-dark',
      'outdoor': 'backdrop-dark',
      'basic': 'basic-dark',
      'bright': 'backdrop-dark',
      'topo': 'backdrop-dark',
      'winter': 'backdrop-dark',
      'toner': 'backdrop-dark',
      'dataviz': 'dataviz-dark',
      'backdrop': 'backdrop-dark',
      'landscape': 'landscape-dark',
      'aquarelle': 'aquarelle-dark',
      'satellite': 'satellite',
      'hybrid': 'hybrid',
      'openstreetmap': 'openstreetmap',
      'ocean': 'ocean',
    };

    // Extract current style ID from URL
    const styleMatch = currentStyle.match(/\/maps\/([^/?]+)/);
    if (styleMatch) {
      let currentStyleId = styleMatch[1];
      
      // Remove dark/light/pastel/vivid suffixes to get base style
      const baseStyle = currentStyleId
        .replace(/-dark$/, '')
        .replace(/-light$/, '')
        .replace(/-pastel$/, '')
        .replace(/-vivid$/, '')
        .replace(/-topographique$/, '')
        .replace(/-lite$/, '');
      
      // Determine new style
      let newStyleId;
      if (newDarkMode) {
        newStyleId = darkModeMap[baseStyle] || 'backdrop-dark';
      } else {
        newStyleId = baseStyle;
      }
      
      const newStyleUrl = getStyleUrl(newStyleId, apiKey);
      onStyleChange(newStyleUrl);
    }
  };

  return (
    <div className="dark-mode-toggle">
      <label className="toggle-label">
        <input
          type="checkbox"
          checked={isDarkMode}
          onChange={handleToggle}
          className="toggle-checkbox"
          aria-label="Toggle dark mode"
        />
        <span className="toggle-slider">
          <span className="toggle-icon">
            {isDarkMode ? '🌙' : '☀️'}
          </span>
        </span>
      </label>
    </div>
  );
}

export default DarkModeToggle;
