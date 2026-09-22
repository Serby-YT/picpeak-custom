import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';

import { AdminPhotoGrid } from '../AdminPhotoGrid';
import { photosService } from '../../../services/photos.service';
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
    deletePhoto: vi.fn().mockResolvedValue(undefined),
    deletePhotos: vi.fn().mockResolvedValue(undefined),
    updatePhotosCategory: vi.fn().mockResolvedValue(undefined),
    downloadPhoto: vi.fn().mockResolvedValue(undefined),
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

const categories = [
  { id: 11, name: 'Photoshoot' },
  { id: 12, name: 'Party' }
];

const renderGrid = (photos = makePhotos(10)) => {
  const onPhotoClick = vi.fn();
  const onSelectionChange = vi.fn();
  const onPhotosDeleted = vi.fn();
  const utils = render(
    <AdminPhotoGrid
      photos={photos}
      eventId={1}
      onPhotoClick={onPhotoClick}
      onPhotosDeleted={onPhotosDeleted}
      onSelectionChange={onSelectionChange}
      categories={categories}
    />
  );
  return { ...utils, onPhotoClick, onSelectionChange, onPhotosDeleted };
};

const menu = () => screen.queryByTestId('photo-context-menu');
const menuItem = (name: string) =>
  within(screen.getByTestId('photo-context-menu')).getByRole('menuitem', { name });

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('AdminPhotoGrid right-click menu', () => {
  it('opens a menu on right-click and suppresses the browser menu', () => {
    renderGrid();
    const notPrevented = fireEvent.contextMenu(tile(3), { clientX: 100, clientY: 120 });

    expect(notPrevented).toBe(false);
    expect(menu()).toBeInTheDocument();
    expect(within(menu()!).getByText('photo-3.jpg')).toBeInTheDocument();
    expect(menuItem('Photoshoot')).toBeInTheDocument();
    expect(menuItem('Party')).toBeInTheDocument();
    expect(menuItem('Uncategorized')).toBeInTheDocument();
  });

  it('moves ALL selected photos when right-clicking a selected photo', async () => {
    const { onSelectionChange, onPhotosDeleted } = renderGrid();
    fireEvent.click(checkbox(2));
    fireEvent.click(checkbox(5), { shiftKey: true });

    fireEvent.contextMenu(tile(4));
    fireEvent.click(menuItem('Party'));

    await waitFor(() => expect(photosService.updatePhotosCategory).toHaveBeenCalledTimes(1));
    const [eventId, ids, categoryId] = vi.mocked(photosService.updatePhotosCategory).mock.calls[0];
    expect(eventId).toBe(1);
    expect([...ids].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    expect(categoryId).toBe(12);
    expect(menu()).not.toBeInTheDocument();
    await waitFor(() => expect(onPhotosDeleted).toHaveBeenCalled());
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('moves only the right-clicked photo when it is not selected, keeping the selection', async () => {
    renderGrid();
    fireEvent.click(checkbox(1));
    fireEvent.click(checkbox(2));

    fireEvent.contextMenu(tile(7));
    fireEvent.click(menuItem('Photoshoot'));

    await waitFor(() =>
      expect(photosService.updatePhotosCategory).toHaveBeenCalledWith(1, [7], 11)
    );
    expect(checkedIds(10)).toEqual([1, 2]);
  });

  it('can move photos back to Uncategorized', async () => {
    renderGrid();
    fireEvent.contextMenu(tile(4));
    fireEvent.click(menuItem('Uncategorized'));

    await waitFor(() =>
      expect(photosService.updatePhotosCategory).toHaveBeenCalledWith(1, [4], null)
    );
  });

  it('marks the current category of a single photo', () => {
    const photos = makePhotos(3);
    (photos[1] as unknown as { category_id: string }).category_id = '12';
    renderGrid(photos);
    fireEvent.contextMenu(tile(2));

    expect(menuItem('Party').querySelector('svg')).not.toBeNull();
    expect(menuItem('Photoshoot').querySelector('svg')).toBeNull();
  });

  it('Open opens the viewer on that photo', () => {
    const { onPhotoClick } = renderGrid();
    fireEvent.contextMenu(tile(6));
    fireEvent.click(menuItem('Open'));

    expect(onPhotoClick).toHaveBeenCalledWith(expect.objectContaining({ id: 6 }), 5);
    expect(menu()).not.toBeInTheDocument();
  });

  it('Select then Deselect toggles the photo', () => {
    renderGrid();
    fireEvent.contextMenu(tile(6));
    fireEvent.click(menuItem('Select'));
    expect(checkedIds(10)).toEqual([6]);

    fireEvent.contextMenu(tile(6));
    fireEvent.click(menuItem('Deselect'));
    expect(checkedIds(10)).toEqual([]);
  });

  it('Download downloads the right-clicked photo', async () => {
    renderGrid();
    fireEvent.contextMenu(tile(3));
    fireEvent.click(menuItem('Download'));

    await waitFor(() =>
      expect(photosService.downloadPhoto).toHaveBeenCalledWith(1, 3, 'photo-3.jpg')
    );
  });

  it('Delete on a selected photo deletes the whole selection after confirming', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderGrid();
    fireEvent.click(checkbox(1));
    fireEvent.click(checkbox(3), { shiftKey: true });

    fireEvent.contextMenu(tile(2));
    expect(menuItem('Delete {{count}} photos')).toBeInTheDocument();
    fireEvent.click(menuItem('Delete {{count}} photos'));

    await waitFor(() => expect(photosService.deletePhotos).toHaveBeenCalledTimes(1));
    const [, ids] = vi.mocked(photosService.deletePhotos).mock.calls[0];
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('Delete on an unselected photo deletes only that photo', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderGrid();
    fireEvent.contextMenu(tile(9));
    fireEvent.click(menuItem('Delete'));

    await waitFor(() => expect(photosService.deletePhoto).toHaveBeenCalledWith(1, 9));
    expect(photosService.deletePhotos).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('closes on Escape and on an outside click without doing anything', () => {
    renderGrid();
    fireEvent.contextMenu(tile(3));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu()).not.toBeInTheDocument();

    fireEvent.contextMenu(tile(3));
    fireEvent.mouseDown(document.body);
    expect(menu()).not.toBeInTheDocument();
    expect(photosService.updatePhotosCategory).not.toHaveBeenCalled();
  });

  it('stays inside the viewport near the bottom-right corner', () => {
    renderGrid();
    fireEvent.contextMenu(tile(3), { clientX: window.innerWidth - 2, clientY: window.innerHeight - 2 });
    const el = menu() as HTMLElement;

    expect(parseFloat(el.style.left)).toBeLessThanOrEqual(window.innerWidth);
    expect(parseFloat(el.style.top)).toBeLessThanOrEqual(window.innerHeight);
  });
});
