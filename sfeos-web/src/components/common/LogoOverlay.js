import React from 'react';
import './LogoOverlay.css';

const LogoOverlay = () => {
  return (
    <div className="logo-overlay">
      <a href="https://github.com/stac-utils/stac-fastapi-elasticsearch-opensearch" target="_blank" rel="noopener noreferrer">
        <img 
          src={`${process.env.PUBLIC_URL}/assets/sfeos-logo.png`} 
          alt="SFEOS Logo"
          className="logo-image"
        />
      </a>
    </div>
  );
};

export default LogoOverlay;
