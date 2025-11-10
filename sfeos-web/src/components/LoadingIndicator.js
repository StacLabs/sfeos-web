import React from 'react';
import './LoadingIndicator.css';

const LoadingIndicator = ({ message = 'Loading...', position = 'fixed' }) => {
  return (
    <div className="loading-indicator" style={{ position }}>
      <span className="loading-spinner" />
      {message}
    </div>
  );
};

export default LoadingIndicator;
