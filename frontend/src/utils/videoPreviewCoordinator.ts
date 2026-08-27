/**
 * Decides which video tile is allowed to play its hover preview.
 *
 * On a phone several tiles sit on screen at once. Playing all of them would
 * spend a visitor's mobile data on videos they are not looking at, so only the
 * single most-visible tile plays, and only once it is comfortably in view.
 *
 * Desktop hover does not use this - there the pointer already picks exactly one.
 */

// A tile has to be mostly on screen before it earns the right to play.
const MIN_VISIBLE_RATIO = 0.6;

const ratios = new Map<number, number>();
const listeners = new Set<() => void>();
let activeId: number | null = null;

function recompute(): void {
  let bestId: number | null = null;
  let bestRatio = MIN_VISIBLE_RATIO;

  ratios.forEach((ratio, id) => {
    if (ratio >= bestRatio) {
      bestRatio = ratio;
      bestId = id;
    }
  });

  if (bestId !== activeId) {
    activeId = bestId;
    listeners.forEach((listener) => listener());
  }
}

export function reportVisibility(id: number, ratio: number): void {
  ratios.set(id, ratio);
  recompute();
}

export function clearVisibility(id: number): void {
  if (ratios.delete(id)) {
    recompute();
  }
}

export function getActivePreviewId(): number | null {
  return activeId;
}

export function subscribeToActivePreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
