import React from 'react';
import { Play } from 'lucide-react';
import { formatDuration } from '../../utils/formatDuration';
import type { Photo } from '../../types';

interface VideoTileIndicatorProps {
  photo: Photo;
  /** Hide the centre play glyph while the hover preview is running. */
  previewPlaying?: boolean;
}

export function isVideoPhoto(photo: Photo): boolean {
  return (
    photo.media_type === 'video' ||
    Boolean(photo.mime_type && photo.mime_type.startsWith('video/')) ||
    photo.type === 'video'
  );
}

/**
 * Marks a tile as a video: a centred play glyph plus a duration pill.
 *
 * In a gallery that mixes stills and video these are the only cue a client has
 * about which tiles move - without them a video is indistinguishable from a
 * photo until they click it.
 *
 * The glyph fades out while the hover preview plays, since the moving image is
 * then its own affordance; the duration stays, as it does on YouTube.
 */
export const VideoTileIndicator: React.FC<VideoTileIndicatorProps> = ({
  photo,
  previewPlaying = false,
}) => {
  if (!isVideoPhoto(photo)) return null;

  const duration = formatDuration(photo.duration);

  return (
    <>
      <div
        className={[
          'absolute inset-0 flex items-center justify-center pointer-events-none',
          'transition-opacity duration-300',
          previewPlaying ? 'opacity-0' : 'opacity-100',
        ].join(' ')}
        aria-hidden="true"
      >
        <span className="flex items-center justify-center w-12 h-12 rounded-full bg-black/45 backdrop-blur-sm ring-1 ring-white/25">
          {/* nudged right: a triangle looks off-centre when optically centred */}
          <Play className="w-5 h-5 text-white translate-x-[1px]" fill="currentColor" />
        </span>
      </div>

      {/* bottom-LEFT: masonry puts its download/expand buttons bottom-right and
          the feedback counts top-left, so this is the one free corner. */}
      {duration && (
        <div className="absolute bottom-2 left-2 pointer-events-none">
          <span className="px-1.5 py-0.5 rounded bg-black/75 text-white text-[11px] font-medium leading-none tabular-nums">
            {duration}
          </span>
        </div>
      )}
    </>
  );
};
