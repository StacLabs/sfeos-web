import React from 'react';
import { Form } from 'react-bootstrap';
import { MAP_STYLES, getStyleUrl } from '../../mapstyle';
import './MapStyleSelector.css';

function MapStyleSelector({ value, onChange }) {
  const apiKey = process.env.REACT_APP_MAPTILER_KEY;
  
  // Build options with full URLs
  const options = MAP_STYLES.map((style) => ({
    url: getStyleUrl(style.id, apiKey),
    label: style.label,
  }));
  
  return (
    <div className="map-style-selector">
      <Form.Select 
        value={value} 
        onChange={(e) => onChange(e.target.value)}
        aria-label="Select map style"
        size="sm"
      >
        {options.map((opt) => (
          <option key={opt.url} value={opt.url}>
            {opt.label}
          </option>
        ))}
      </Form.Select>
    </div>
  );
}

export default MapStyleSelector;
