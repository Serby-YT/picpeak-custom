import React, { useState, useEffect } from 'react';
import { Calendar, Clock } from 'lucide-react';
import { parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useLocalizedDate } from '../../hooks/useLocalizedDate';
import { useTheme } from '../../contexts/ThemeContext';
import { AuthenticatedImage } from '../common';
import { HeroDivider } from './HeroDivider';
import { buildResourceUrl } from '../../utils/url';
import type { Photo } from '../../types';
import type { HeroDividerStyle } from '../../types/theme.types';

interface HeroHeaderProps {
  photos: Photo[];
  slug: string;
  eventName?: string;
  eventLogo?: string | null;
  eventDate?: string | null;
  expiresAt?: string | null;
  heroPhotoOverride?: Photo | null;
  heroLogoVisible?: boolean;
  heroLogoSize?: 'small' | 'medium' | 'large' | 'xlarge';
  heroLogoPosition?: 'top' | 'center' | 'bottom';
  dividerStyle?: HeroDividerStyle;
  allowDownloads?: boolean;
  protectionLevel?: 'basic' | 'standard' | 'enhanced' | 'maximum';
  useEnhancedProtection?: boolean;
  useCanvasRendering?: boolean;
  onScrollToContent?: () => void;
  // Hero image anchor position (#162) – keyword or "X% Y%" focal point
  heroImageAnchor?: string;
  // Photographer/studio name credit shown bottom-center of the hero
  photographerName?: string;
}

export const HeroHeader: React.FC<HeroHeaderProps> = ({
  photos,
  slug,
  eventName,
  eventLogo,
  eventDate,
  expiresAt,
  heroPhotoOverride,
  dividerStyle = 'wave',
  allowDownloads = true,
  protectionLevel = 'standard',
  useEnhancedProtection = false,
  useCanvasRendering = false,
  heroImageAnchor = 'center',
  photographerName
}) => {
  const { t } = useTranslation();
  const { format } = useLocalizedDate();
  const { theme } = useTheme();
  const [heroPhoto, setHeroPhoto] = useState<Photo | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);

  const gallerySettings = theme.gallerySettings || {};
  const overlayOpacity = gallerySettings.heroOverlayOpacity || 0.2;

  // If an override is provided, always use it and skip initialization logic
  useEffect(() => {
    if (heroPhotoOverride) {
      setHeroPhoto(heroPhotoOverride);
      setHasInitialized(true);
    }
  }, [heroPhotoOverride]);

  // Reset initialization when heroImageId changes
  useEffect(() => {
    if (gallerySettings.heroImageId) {
      setHasInitialized(false);
    }
  }, [gallerySettings.heroImageId]);

  // Select hero photo (admin-selected or first photo only if gallery was empty)
  useEffect(() => {
    // When an override is provided, the effect above has already set the hero.
    if (heroPhotoOverride) return;

    if (photos.length > 0) {
      const heroId = gallerySettings.heroImageId;
      // If admin has selected a specific hero image, always use it when available
      if (heroId) {
        const adminSelectedHero = photos.find(p => p.id === heroId);
        if (adminSelectedHero) {
          setHeroPhoto(adminSelectedHero);
          setHasInitialized(true);
          return;
        }
      }

      // Only auto-select first photo on initial load
      if (!hasInitialized) {
        setHeroPhoto(photos[0]);
        setHasInitialized(true);
      }
    }
  }, [photos, gallerySettings.heroImageId, hasInitialized, heroPhotoOverride]);

  if (!heroPhoto) return null;

  return (
    <div className="relative">
      {/* Hero Section */}
      <div className="relative left-1/2 -translate-x-1/2 w-screen aspect-video sm:aspect-auto sm:h-screen mb-8">
        <AuthenticatedImage
          src={heroPhoto.hero_url || heroPhoto.url}
          fallbackSrc={heroPhoto.url}
          alt={heroPhoto.filename}
          className="w-full h-full object-cover"
          style={{ objectPosition: heroImageAnchor }}
          isGallery={true}
          slug={slug}
          photoId={heroPhoto.id}
          protectFromDownload={!allowDownloads || useEnhancedProtection}
          protectionLevel={protectionLevel}
          useEnhancedProtection={useEnhancedProtection}
          useCanvasRendering={useCanvasRendering || protectionLevel === 'maximum'}
        />

        {/* Overlay */}
        <div
          className="absolute inset-0 bg-black"
          style={{ opacity: overlayOpacity }}
        />

        {/* Hero Content */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center px-4 sm:px-10 lg:px-14">
            {/* Event Title */}
            {eventName && (
              <h1 className="text-2xl sm:text-4xl lg:text-5xl xl:text-6xl font-semibold text-white drop-shadow-lg mb-2 sm:mb-3">
                {eventName}
              </h1>
            )}

            {/* Event Dates */}
            {(eventDate || expiresAt) && (
              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-6 text-white/90">
                {eventDate && (
                  <span className="flex items-center text-xs sm:text-xl">
                    <Calendar className="w-3.5 h-3.5 sm:w-6 sm:h-6 mr-1.5 sm:mr-2" />
                    {format(parseISO(eventDate), 'PP')}
                  </span>
                )}
                {expiresAt && (
                  <span className="flex items-center text-xs sm:text-xl">
                    <Clock className="w-3.5 h-3.5 sm:w-6 sm:h-6 mr-1.5 sm:mr-2" />
                    {t('gallery.expires')} {format(parseISO(expiresAt), 'PP')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Photographer Credit */}
        {photographerName && (
          <div className="absolute bottom-3 sm:bottom-5 inset-x-0 flex justify-center">
            <span className="text-white/80 text-xs sm:text-sm drop-shadow-lg">
              {photographerName}
            </span>
          </div>
        )}

        {/* Decorative Divider */}
        <HeroDivider style={dividerStyle} />
      </div>
    </div>
  );
};

HeroHeader.displayName = 'HeroHeader';
