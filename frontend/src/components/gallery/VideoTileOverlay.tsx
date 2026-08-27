import React from 'react';
import { GalleryHoverPreview } from './GalleryHoverPreview';
import { VideoTileIndicator, isVideoPhoto } from './VideoTileIndicator';
import type { Photo } from '../../types';

interface VideoTileOverlayProps {
  photo: Photo;
}

/**
 * Everything a gallery tile needs in order to present a video: the play glyph
 * and duration that mark it as one, plus the hover preview when a clip exists.
 *
 * Layouts drop in this single element. Photos render nothing, and a video whose
 * preview failed to generate still gets its glyph and duration.
 */
export const VideoTileOverlay: React.FC<VideoTileOverlayProps> = ({ photo }) => {
  const [previewPlaying, setPreviewPlaying] = React.useState(false);

  if (!isVideoPhoto(photo)) return null;

  return (
    <>
      <GalleryHoverPreview photo={photo} onPlayingChange={setPreviewPlaying} />
      <VideoTileIndicator photo={photo} previewPlaying={previewPlaying} />
    </>
  );
};
