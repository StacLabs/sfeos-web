import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import StacClient from '../StacClient';

// Mock fetch globally
global.fetch = jest.fn();

// Mock window.dispatchEvent
global.dispatchEvent = jest.fn();

describe('StacClient', () => {
  const mockCollections = [
    { id: 'collection1', title: 'Collection One' },
    { id: 'collection2', title: 'Collection Two' }
  ];

  const mockCatalog = {
    title: 'Test STAC Catalog',
    description: 'A test catalog for STAC items'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fetch.mockClear();

    // Default successful responses
    fetch.mockImplementation((url) => {
      if (url.includes('/collections')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ collections: mockCollections })
        });
      } else if (url.endsWith('/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockCatalog)
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });
  });

  test('renders catalog header when root catalog is available', async () => {
    await act(async () => {
      render(<StacClient stacApiUrl="http://localhost:8000" />);
    });

    await waitFor(() => {
      expect(screen.getByText('STAC Catalog')).toBeInTheDocument();
      expect(screen.getByText('Test STAC Catalog')).toBeInTheDocument();
    });
  });

  test('renders catalog description when expanded', async () => {
    await act(async () => {
      render(<StacClient stacApiUrl="http://localhost:8000" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Description')).toBeInTheDocument();
    });

    const descriptionHeader = screen.getByText('Description');
    fireEvent.click(descriptionHeader);

    await waitFor(() => {
      expect(screen.getByText('A test catalog for STAC items')).toBeInTheDocument();
    });
  });

  test('fetches collections on mount', async () => {
    await act(async () => {
      render(<StacClient stacApiUrl="http://localhost:8000" />);
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('http://localhost:8000/');
      expect(fetch).toHaveBeenCalledWith('http://localhost:8000/collections');
    });

    expect(await screen.findByText('collection1')).toBeInTheDocument();
    expect(await screen.findByText('collection2')).toBeInTheDocument();
  });

  test('shows loading state initially', () => {
    render(<StacClient stacApiUrl="http://localhost:8000" />);
    expect(screen.getByText('Loading collections...')).toBeInTheDocument();
  });

  test('handles fetch error gracefully', async () => {
    fetch.mockImplementation(() =>
      Promise.reject(new Error('Network error'))
    );

    await act(async () => {
      render(<StacClient stacApiUrl="http://localhost:8000" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Error: Network error')).toBeInTheDocument();
    });
  });

  test('handles API error response', async () => {
    fetch.mockImplementation((url) => {
      if (url.includes('/collections')) {
        return Promise.resolve({
          ok: false,
          status: 500
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockCatalog)
      });
    });

    await act(async () => {
      render(<StacClient stacApiUrl="http://localhost:8000" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Error: Failed to fetch collections: 500')).toBeInTheDocument();
    });
  });

  test('handles empty collections response', async () => {
    fetch.mockImplementation((url) => {
      if (url.includes('/collections')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ collections: [] })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockCatalog)
      });
    });

    await act(async () => {
      render(<StacClient stacApiUrl="http://localhost:8000" />);
    });

    await waitFor(() => {
      expect(screen.getByText('No collections found')).toBeInTheDocument();
    });
  });

  test('uses default STAC API URL when none provided', async () => {
    // Mock environment variable
    process.env.REACT_APP_STAC_API_URL = 'http://default-api.com';

    await act(async () => {
      render(<StacClient />);
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('http://default-api.com/');
      expect(fetch).toHaveBeenCalledWith('http://default-api.com/collections');
    });

    // Clean up
    delete process.env.REACT_APP_STAC_API_URL;
  });

  test('handles catalog fetch failure gracefully', async () => {
    fetch.mockImplementation((url) => {
      if (url.endsWith('/')) {
        return Promise.reject(new Error('Catalog fetch failed'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ collections: mockCollections })
      });
    });

    // Mock console.warn to avoid console output during tests
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      render(<StacClient stacApiUrl="http://localhost:8000" />);
    });

    await waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith('Could not fetch root catalog:', expect.any(Error));
    });

    // Verify collections still load despite catalog failure
    expect(await screen.findByText('collection1')).toBeInTheDocument();

    consoleWarn.mockRestore();
  });
});
