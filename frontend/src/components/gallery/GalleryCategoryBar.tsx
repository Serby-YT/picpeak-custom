import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PhotoCategory } from '../../types';

interface GalleryCategoryBarProps {
  categories: PhotoCategory[];
  selectedCategoryId: number | string | null;
  onCategoryChange: (categoryId: number | string | null) => void;
  photoCounts: Record<number | string, number>;
  totalPhotos: number;
  // 'bottom' is the copy after the last photo: picking a category there jumps
  // back up to the top bar, so the client starts the new section from its
  // first photo instead of landing somewhere in the middle of it.
  position?: 'top' | 'bottom';
}

const TOP_BAR_ID = 'gallery-category-bar-top';

/**
 * Category pills shown right under the hero. Clients missed the categories
 * when they only lived in the Menu drawer, so this puts them on the page.
 * Shares state with the sidebar: GalleryView owns selectedCategoryId.
 *
 * Phones get a single row that scrolls sideways (a wrapped wall of pills
 * would push the photos off the first screen); wider screens centre and wrap.
 */
export const GalleryCategoryBar: React.FC<GalleryCategoryBarProps> = ({
  categories,
  selectedCategoryId,
  onCategoryChange,
  photoCounts,
  totalPhotos,
  position = 'top',
}) => {
  const { t } = useTranslation();
  const navRef = useRef<HTMLElement>(null);
  // Which edges still have pills hidden past them. Phones only: on wider
  // screens the row wraps, so nothing overflows and both stay false.
  const [fade, setFade] = useState({ left: false, right: false });

  const updateFade = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setFade({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
  }, []);

  useEffect(() => {
    updateFade();
    window.addEventListener('resize', updateFade);
    return () => window.removeEventListener('resize', updateFade);
  }, [updateFade, categories.length]);

  // A fading edge is the hint that the row scrolls sideways; without it a
  // client sees the first two or three categories and assumes that is all.
  const maskImage = fade.left || fade.right
    ? `linear-gradient(to right, ${fade.left ? 'transparent 0, black 32px' : 'black 0'}, ${fade.right ? 'black calc(100% - 40px), transparent 100%' : 'black 100%'})`
    : undefined;

  const select = (id: number | string | null, el: HTMLButtonElement) => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = reduceMotion ? 'auto' : 'smooth';
    // Keep the tapped pill fully visible when the row is scrolled sideways.
    // Done before the page scroll below so it cannot cancel it.
    el.scrollIntoView({ behavior, block: 'nearest', inline: 'nearest' });
    onCategoryChange(id);
    if (position === 'bottom') {
      const top = document.getElementById(TOP_BAR_ID);
      if (top) {
        window.scrollTo({ top: top.getBoundingClientRect().top + window.scrollY - 16, behavior });
      }
    }
  };

  const pills: { id: number | string | null; name: string; count: number }[] = [
    { id: null, name: t('gallery.categoryBarAll', 'All'), count: totalPhotos },
    ...categories.map(c => ({ id: c.id, name: c.name, count: photoCounts[c.id] || 0 })),
  ];

  return (
    <nav
      ref={navRef}
      id={position === 'top' ? TOP_BAR_ID : undefined}
      onScroll={updateFade}
      aria-label={t('gallery.categories')}
      style={{ maskImage, WebkitMaskImage: maskImage }}
      className={`gallery-category-bar ${position === 'bottom' ? 'mt-10 sm:mt-14' : 'mb-6'} -mx-2 px-2 sm:mx-0 sm:px-0 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
    >
      <div className="flex gap-2 w-max sm:w-auto sm:flex-wrap sm:justify-center">
        {pills.map(pill => {
          const isSelected = selectedCategoryId === pill.id;
          return (
            <button
              key={pill.id ?? 'all'}
              type="button"
              aria-pressed={isSelected}
              onClick={e => select(pill.id, e.currentTarget)}
              style={
                isSelected
                  ? { backgroundColor: 'var(--color-text)', color: 'var(--color-background)', borderColor: 'var(--color-text)' }
                  : { color: 'var(--color-muted-text)', borderColor: 'var(--color-surface-border)' }
              }
              className="gallery-category-pill shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2.5 text-sm font-medium transition-colors active:scale-[0.97]"
            >
              <span>{pill.name}</span>
              <span className="opacity-60 tabular-nums">{pill.count}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
