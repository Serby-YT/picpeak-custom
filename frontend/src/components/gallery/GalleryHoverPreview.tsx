import React from 'react';
import { buildResourceUrl } from '../../utils/url';
import { useVideoPreviewsEnabled } from '../../hooks/useVideoPreviewsEnabled';
import {
  clearVisibility,
  getActivePreviewId,
  reportVisibility,
  subscribeToActivePreview,
} from '../../utils/videoPreviewCoordinator';
import type { Photo } from '../../types';

interface GalleryHoverPreviewProps {
  photo: Photo;
}

const VISIBILITY_THRESHOLDS = [0, 0.25, 0.5, 0.6, 0.75, 1];

function isVideoPhoto(photo: Photo): boolean {
  return (
    photo.media_type === 'video' ||
    Boolean(photo.mime_type && photo.mime_type.startsWith('video/')) ||
    photo.type === 'video'
  );
}

/**
 * The short muted montage that plays over a video thumbnail, YouTube-style.
 *
 * Self-contained on purpose: it finds its own card (its parent element), wires
 * its own hover and visibility handling, and positions itself absolutely over
 * the thumbnail. Every gallery layout can therefore adopt previews by dropping
 * in a single element, instead of each one growing its own copy of this logic.
 *
 * The parent card must be positioned (all layouts use `relative group`).
 *
 * Renders nothing at all for photos, for videos without a generated preview,
 * and for visitors who asked for reduced motion or data saving.
 */
export const GalleryHoverPreview: React.FC<GalleryHoverPreviewProps> = ({ photo }) => {
  const previewsEnabled = useVideoPreviewsEnabled();
  const enabled = previewsEnabled && isVideoPhoto(photo) && Boolean(photo.preview_url);

  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  const [isHovering, setIsHovering] = React.useState(false);
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const activePreviewId = React.useSyncExternalStore(
    subscribeToActivePreview,
    getActivePreviewId,
    getActivePreviewId
  );

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(hover: none) and (pointer: coarse)');
    const update = () => setIsTouchDevice(query.matches);
    update();
    if (query.addEventListener) {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  // Pointer devices: follow the card's own hover.
  React.useEffect(() => {
    if (!enabled || isTouchDevice) return;
    const card = anchorRef.current?.parentElement;
    if (!card) return;

    const onEnter = () => setIsHovering(true);
    const onLeave = () => setIsHovering(false);
    card.addEventListener('mouseenter', onEnter);
    card.addEventListener('mouseleave', onLeave);
    return () => {
      card.removeEventListener('mouseenter', onEnter);
      card.removeEventListener('mouseleave', onLeave);
      setIsHovering(false);
    };
  }, [enabled, isTouchDevice]);

  // Touch devices: report visibility so only the most-visible tile plays.
  React.useEffect(() => {
    if (!enabled || !isTouchDevice || typeof IntersectionObserver === 'undefined') return;
    const card = anchorRef.current?.parentElement;
    if (!card) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => reportVisibility(photo.id, entry.intersectionRatio));
      },
      { threshold: VISIBILITY_THRESHOLDS }
    );
    observer.observe(card);

    return () => {
      observer.disconnect();
      clearVisibility(photo.id);
    };
  }, [enabled, isTouchDevice, photo.id]);

  const active = enabled && (isTouchDevice ? activePreviewId === photo.id : isHovering);

  // No manual fetching. The endpoint authenticates by cookie just as well as
  // by bearer token, so the element loads its own source: preload="none" means
  // nothing is downloaded until the tile is actually asked to play, and the
  // clip then streams and caches through the browser like any other media.
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (active) {
      const started = video.play();
      if (started) {
        // Autoplay can still be refused; the thumbnail simply remains.
        started.catch(() => undefined);
      }
    } else {
      video.pause();
      if (video.currentTime !== 0) video.currentTime = 0;
      setPlaying(false);
    }
  }, [active]);

  if (!enabled) return null;

  return (
    <span ref={anchorRef} style={{ display: 'contents' }}>
      {!failed && (
        <video
          ref={videoRef}
          src={buildResourceUrl(photo.preview_url as string)}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
          onError={() => setFailed(true)}
          className={[
            'absolute inset-0 w-full h-full object-cover pointer-events-none',
            'transition-opacity duration-300',
            // Reveal only once frames are running, else the first paint
            // flashes black over the thumbnail.
            active && playing ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        />
      )}
    </span>
  );
};
