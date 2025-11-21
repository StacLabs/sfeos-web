import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

// Mock the SFEOSMap component to avoid complex dependencies
jest.mock('./SFEOSMap', () => {
  return function MockSFEOSMap() {
    return <div data-testid="sfeos-map">Map Component</div>;
  };
});

test('renders without crashing', () => {
  render(<App />);
  // The app should render without throwing an error
  expect(screen.getByTestId('sfeos-map')).toBeInTheDocument();
});
