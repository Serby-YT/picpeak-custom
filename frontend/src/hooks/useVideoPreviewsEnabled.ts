import { useEffect, useState } from 'react';

/**
 * Whether hover previews should play at all.
 *
 * Two opt-outs are honoured: a visitor who asked the OS for reduced motion, and
 * a visitor whose browser is in data-saver mode. Both get the static thumbnail.
 */
export function useVideoPreviewsEnabled(): boolean {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const update = () => {
      const connection = (navigator as Navigator & {
        connection?: { saveData?: boolean };
      }).connection;
      setEnabled(!reducedMotion.matches && connection?.saveData !== true);
    };

    update();

    if (reducedMotion.addEventListener) {
      reducedMotion.addEventListener('change', update);
      return () => reducedMotion.removeEventListener('change', update);
    }
    // Safari < 14
    reducedMotion.addListener(update);
    return () => reducedMotion.removeListener(update);
  }, []);

  return enabled;
}
