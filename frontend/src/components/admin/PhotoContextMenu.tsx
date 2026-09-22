import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CheckSquare, Download, Eye, FolderOpen, Square, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface CategoryOption {
  id: number;
  name: string;
}

interface PhotoContextMenuProps {
  x: number;
  y: number;
  /** What the menu acts on: "12 photos selected" or the filename */
  title: string;
  targetCount: number;
  isSelected: boolean;
  /** Current category of a single target, to mark it in the list */
  currentCategoryId: number | null;
  categories: CategoryOption[];
  onOpen: () => void;
  onToggleSelect: () => void;
  onMoveToCategory: (categoryId: number | null) => void;
  onDownload: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const EDGE_MARGIN = 8;

const itemClass =
  'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-neutral-700 dark:text-neutral-200 ' +
  'hover:bg-neutral-100 dark:hover:bg-neutral-700 focus:bg-neutral-100 dark:focus:bg-neutral-700 focus:outline-none';

export const PhotoContextMenu: React.FC<PhotoContextMenuProps> = ({
  x,
  y,
  title,
  targetCount,
  isSelected,
  currentCategoryId,
  categories,
  onOpen,
  onToggleSelect,
  onMoveToCategory,
  onDownload,
  onDelete,
  onClose
}) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu on screen near the right/bottom edges
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(EDGE_MARGIN, Math.min(x, window.innerWidth - width - EDGE_MARGIN)),
      top: Math.max(EDGE_MARGIN, Math.min(y, window.innerHeight - height - EDGE_MARGIN))
    });
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Every command closes the menu after running
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-testid="photo-context-menu"
      className="fixed z-50 min-w-[220px] max-w-[280px] max-h-[80vh] overflow-y-auto py-1 rounded-lg shadow-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400 truncate">
        {title}
      </div>
      <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />

      <button type="button" role="menuitem" className={itemClass} onClick={run(onOpen)}>
        <Eye className="w-4 h-4" />
        {t('photos.contextOpen', 'Open')}
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={run(onToggleSelect)}>
        {isSelected ? <Square className="w-4 h-4" /> : <CheckSquare className="w-4 h-4" />}
        {isSelected ? t('photos.contextDeselect', 'Deselect') : t('photos.contextSelect', 'Select')}
      </button>

      <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
      <div className="px-3 py-1 flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
        <FolderOpen className="w-3.5 h-3.5" />
        {targetCount > 1
          ? t('photos.contextMoveMany', 'Move {{count}} photos to', { count: targetCount })
          : t('photos.contextMoveOne', 'Move to category')}
      </div>
      {categories.map(category => (
        <button
          key={category.id}
          type="button"
          role="menuitem"
          className={`${itemClass} pl-8`}
          onClick={run(() => onMoveToCategory(Number(category.id)))}
        >
          <span className="flex-1 truncate">{category.name}</span>
          {currentCategoryId === Number(category.id) && <Check className="w-4 h-4 text-primary-600" />}
        </button>
      ))}
      <button
        type="button"
        role="menuitem"
        className={`${itemClass} pl-8 italic`}
        onClick={run(() => onMoveToCategory(null))}
      >
        <span className="flex-1">{t('photos.uncategorized', 'Uncategorized')}</span>
      </button>

      <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
      <button type="button" role="menuitem" className={itemClass} onClick={run(onDownload)}>
        <Download className="w-4 h-4" />
        {t('photos.contextDownload', 'Download')}
      </button>
      <button
        type="button"
        role="menuitem"
        className={`${itemClass} text-red-600 dark:text-red-400`}
        onClick={run(onDelete)}
      >
        <Trash2 className="w-4 h-4" />
        {targetCount > 1
          ? t('photos.contextDeleteMany', 'Delete {{count}} photos', { count: targetCount })
          : t('photos.contextDelete', 'Delete')}
      </button>
    </div>,
    document.body
  );
};
