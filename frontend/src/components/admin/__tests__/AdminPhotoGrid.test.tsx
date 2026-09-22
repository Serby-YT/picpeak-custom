import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { AdminPhotoGrid } from '../AdminPhotoGrid';
import type { AdminPhoto } from '../../../services/photos.service';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key)
    })
  };
});

vi.mock('../AdminAuthenticatedImage', () => ({
  AdminAuthenticatedImage: () => <div />
}));

vi.mock('../../../services/photos.service', () => ({
  photosService: {
    deletePhotos: vi.fn(),
    updatePhotosCategory: vi.fn(),
    downloadPhoto: vi.fn(),
    formatBytes: () => "1 MB"
  }
}));

const makePhotos = (count: number): AdminPhoto[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    filename: `photo-${i + 1}.jpg`,
    thumbnail_url: null
  })) as unknown as AdminPhoto[];

const checkbox = (id: number) => screen.getByTestId(`admin-photo-checkbox-${id}`);
const tile = (id: number) => screen.getByTestId(`admin-photo-tile-${id}`);
const isChecked = (id: number) => checkbox(id).getAttribute('aria-checked') === 'true';
const checkedIds = (count: number) =>
  Array.from({ length: count }, (_, i) => i + 1).filter(isChecked);

const renderGrid = (photos = makePhotos(10)) => {
  const onPhotoClick = vi.fn();
  const onSelectionChange = vi.fn();
  const utils = render(
    <AdminPhotoGrid
      photos={photos}
      eventId={1}
      onPhotoClick={onPhotoClick}
      onPhotosDeleted={vi.fn()}
      onSelectionChange={onSelectionChange}
    />
  );
  return { ...utils, onPhotoClick, onSelectionChange };
};

describe('AdminPhotoGrid shift+click range selection', () => {
  it('selects every photo between the anchor and the shift-clicked photo', () => {
    const { onSelectionChange } = renderGrid();
    fireEvent.click(checkbox(3));
    fireEvent.click(checkbox(7), { shiftKey: true });

    expect(checkedIds(10)).toEqual([3, 4, 5, 6, 7]);
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.arrayContaining([3, 4, 5, 6, 7]));
    expect(onSelectionChange.mock.lastCall![0]).toHaveLength(5);
  });

  it('works when the range goes backwards', () => {
    renderGrid();
    fireEvent.click(checkbox(8));
    fireEvent.click(checkbox(2), { shiftKey: true });

    expect(checkedIds(10)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('adds ranges to the existing selection', () => {
    renderGrid();
    fireEvent.click(checkbox(1));
    fireEvent.click(checkbox(2), { shiftKey: true });
    fireEvent.click(checkbox(6));
    fireEvent.click(checkbox(8), { shiftKey: true });

    expect(checkedIds(10)).toEqual([1, 2, 6, 7, 8]);
  });

  it('chains from the last shift-clicked photo', () => {
    renderGrid();
    fireEvent.click(checkbox(2));
    fireEvent.click(checkbox(4), { shiftKey: true });
    fireEvent.click(checkbox(6), { shiftKey: true });

    expect(checkedIds(10)).toEqual([2, 3, 4, 5, 6]);
  });

  it('shift-click without an anchor just selects that photo', () => {
    renderGrid();
    fireEvent.click(checkbox(5), { shiftKey: true });

    expect(checkedIds(10)).toEqual([5]);
  });

  it('falls back to a plain toggle when the anchor has left the grid', () => {
    const photos = makePhotos(10);
    const { rerender } = renderGrid(photos);
    fireEvent.click(checkbox(3));

    rerender(
      <AdminPhotoGrid
        photos={photos.filter(p => p.id !== 3)}
        eventId={1}
        onPhotoClick={vi.fn()}
        onPhotosDeleted={vi.fn()}
      />
    );
    fireEvent.click(checkbox(7), { shiftKey: true });

    expect(isChecked(7)).toBe(true);
    expect(isChecked(4)).toBe(false);
    expect(isChecked(6)).toBe(false);
  });

  it('in selection mode a tile click selects instead of opening the viewer', () => {
    const { onPhotoClick } = renderGrid();
    fireEvent.click(screen.getByText('Select Photos'));
    fireEvent.click(tile(2));
    fireEvent.click(tile(5), { shiftKey: true });

    expect(onPhotoClick).not.toHaveBeenCalled();
    expect(checkedIds(10)).toEqual([2, 3, 4, 5]);
  });

  it('a tile click toggles off again in selection mode', () => {
    renderGrid();
    fireEvent.click(screen.getByText('Select Photos'));
    fireEvent.click(tile(2));
    fireEvent.click(tile(2));

    expect(checkedIds(10)).toEqual([]);
  });

  it('outside selection mode a tile click still opens the viewer', () => {
    const { onPhotoClick } = renderGrid();
    fireEvent.click(tile(4));

    expect(onPhotoClick).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }), 3);
    expect(checkedIds(10)).toEqual([]);
  });

  it('shift+click on a tile outside selection mode starts selecting', () => {
    const { onPhotoClick } = renderGrid();
    fireEvent.click(tile(4), { shiftKey: true });

    expect(onPhotoClick).not.toHaveBeenCalled();
    expect(checkedIds(10)).toEqual([4]);
    expect(screen.getByText('Cancel Selection')).toBeInTheDocument();
  });

  it('shows the shift+click hint in selection mode', () => {
    renderGrid();
    expect(screen.queryByText('Shift+click to select a range')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Select Photos'));
    expect(screen.getByText('Shift+click to select a range')).toBeInTheDocument();
  });

  it('shift+mousedown is prevented so page text does not get highlighted', () => {
    renderGrid();
    const shiftDown = fireEvent.mouseDown(tile(3), { shiftKey: true });
    const plainDown = fireEvent.mouseDown(tile(3));

    expect(shiftDown).toBe(false);
    expect(plainDown).toBe(true);
  });

  it('selects a full 800-photo range in one shift-click', () => {
    const { onSelectionChange } = renderGrid(makePhotos(800));
    fireEvent.click(checkbox(1));
    fireEvent.click(checkbox(800), { shiftKey: true });

    expect(onSelectionChange.mock.lastCall![0]).toHaveLength(800);
    expect(isChecked(400)).toBe(true);
    expect(screen.getByText('Move to Category')).toBeInTheDocument();
  }, 30000);
});
