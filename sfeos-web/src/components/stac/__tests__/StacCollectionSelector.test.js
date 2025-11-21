import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StacCollectionSelector from '../StacCollectionSelector';

// Mock the StacCollectionDetails component
jest.mock('../StacCollectionDetails', () => {
  return function MockStacCollectionDetails({ collection }) {
    return <div data-testid="stac-collection-details">{collection ? collection.id : 'no-collection'}</div>;
  };
});

const mockCollections = [
  { id: 'collection1', title: 'Collection One' },
  { id: 'collection2', title: 'Collection Two' }
];

const defaultProps = {
  collections: mockCollections,
  loading: false,
  error: null,
  selectedCollection: null,
  onCollectionChange: jest.fn(),
  onZoomToBbox: jest.fn(),
  onShowItemsOnMap: jest.fn(),
  stacApiUrl: 'http://localhost:8000'
};

describe('StacCollectionSelector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock window.dispatchEvent to avoid console warnings
    global.dispatchEvent = jest.fn();
  });

  test('renders collection selector with title', () => {
    render(<StacCollectionSelector {...defaultProps} />);
    expect(screen.getByText('STAC Collections')).toBeInTheDocument();
  });

  test('shows loading state when loading is true', () => {
    render(<StacCollectionSelector {...defaultProps} loading={true} />);
    expect(screen.getByText('Loading collections...')).toBeInTheDocument();
  });

  test('shows error message when error is provided', () => {
    const errorMessage = 'Failed to load collections';
    render(<StacCollectionSelector {...defaultProps} error={errorMessage} />);
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  test('renders select dropdown with collections', () => {
    render(<StacCollectionSelector {...defaultProps} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('Select a collection...')).toBeInTheDocument();
    expect(screen.getByText('All Collections')).toBeInTheDocument();
    expect(screen.getByText('collection1')).toBeInTheDocument();
    expect(screen.getByText('collection2')).toBeInTheDocument();
  });

  test('calls onCollectionChange with null when "All Collections" is selected', () => {
    render(<StacCollectionSelector {...defaultProps} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'all-collections' } });
    expect(defaultProps.onCollectionChange).toHaveBeenCalledWith(null);
  });

  test('calls onCollectionChange with selected collection when specific collection is chosen', () => {
    render(<StacCollectionSelector {...defaultProps} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'collection1' } });
    expect(defaultProps.onCollectionChange).toHaveBeenCalledWith(mockCollections[0]);
  });

  test('dispatches custom events when collection changes', () => {
    render(<StacCollectionSelector {...defaultProps} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'collection1' } });

    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'hideOverlays'
      })
    );
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'clearItemGeometries'
      })
    );
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'clearSearchCache'
      })
    );
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'selectedCollectionChanged',
        detail: { collectionId: 'collection1' }
      })
    );
  });

  test('renders StacCollectionDetails component', () => {
    render(<StacCollectionSelector {...defaultProps} />);
    expect(screen.getByTestId('stac-collection-details')).toBeInTheDocument();
  });

  test('passes selectedCollection to StacCollectionDetails', () => {
    const selectedCollection = mockCollections[0];
    render(<StacCollectionSelector {...defaultProps} selectedCollection={selectedCollection} />);
    expect(screen.getByTestId('stac-collection-details')).toHaveTextContent('collection1');
  });
});
