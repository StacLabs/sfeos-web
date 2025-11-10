import React, { useState, useEffect } from 'react';
import '../UrlSearchBox.css';

const UrlSearchBox = ({ initialUrl, onUpdate }) => {
  const [url, setUrl] = useState(initialUrl);
  const [isVisible, setIsVisible] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    onUpdate(url);
  };

  useEffect(() => {
    const handleToggleUrlBox = () => {
      setIsVisible(prev => !prev);
    };

    window.addEventListener('toggleUrlBox', handleToggleUrlBox);
    return () => {
      window.removeEventListener('toggleUrlBox', handleToggleUrlBox);
    };
  }, []);

  return (
    <>
      {isVisible && (
        <form className="url-search-box" onSubmit={handleSubmit}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="STAC API URL"
          />
          <button type="submit">
            Update
          </button>
        </form>
      )}
    </>
  );
};

export default UrlSearchBox;
