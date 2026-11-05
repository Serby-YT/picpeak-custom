import React, { useState, useEffect } from 'react';
import { Calendar, Download } from 'lucide-react';
import { parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useLocalizedDate } from '../../hooks/useLocalizedDate';
import { useTheme } from '../../contexts/ThemeContext';
import { AuthenticatedImage } from '../common';
import { HeroDivider } from './HeroDivider';
import { HeroCredits, type GalleryCredit } from './HeroCredits';
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
  // Contact card the photographer credit links to (branding contact_url)
  photographerUrl?: string | null;
  // Other photographers credited on this gallery
  credits?: GalleryCredit[];
  // Download the whole gallery, offered on the hero itself so a client does not
  // have to find it in the menu.
  onDownloadAll?: () => void;
  isDownloading?: boolean;
}

// Widths the hero endpoint will build on request; anything larger gets the
// full 3840px cover. Kept in step with HERO_WIDTHS on the backend.
const HERO_TIERS = [1280, 1920, 2560];

// How many image pixels the cover actually needs on this screen. The hero box
// is object-cover, so a landscape photo on a portrait phone is scaled to the
// box HEIGHT and its sides cropped — width alone would undersize it. Device
// pixel ratio is capped at 2: a phone at 3x cannot show the difference on a
// photo sitting behind the title scrim, and it costs over twice the bytes.
// Box sizes mirror the classes below: 68svh (min 380px) on phones, full
// screen from the sm breakpoint.
// The hero file is always a 16:9 centre crop (generateHeroImage, fit: cover),
// whatever shape the original photo was.
const HERO_ASPECT = 16 / 9;

const pickHeroWidth = (): number | null => {
  if (typeof window === 'undefined') return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const boxHeight = vw < 640 ? Math.max(380, vh * 0.68) : vh;
  const cssWidth = Math.max(vw, boxHeight * HERO_ASPECT);
  const needed = cssWidth * Math.min(window.devicePixelRatio || 1, 2);
  // 15% leeway: a copy that is slightly short of the exact need looks the
  // same, and missing a tier by a few percent meant jumping straight to the
  // 2MB full cover (a 1024px retina screen needs 2730px, for example).
  return HERO_TIERS.find((w) => w >= needed * 0.85) ?? null;
};

const withHeroWidth = (url: string, width: number | null): string => {
  if (!width) return url;
  return `${url}${url.includes('?') ? '&' : '?'}w=${width}`;
};

export const HeroHeader: React.FC<HeroHeaderProps> = ({
  photos,
  slug,
  eventName,
  eventLogo,
  eventDate,
  heroPhotoOverride,
  dividerStyle = 'wave',
  allowDownloads = true,
  protectionLevel = 'standard',
  useEnhancedProtection = false,
  useCanvasRendering = false,
  heroImageAnchor = 'center',
  photographerName,
  photographerUrl,
  credits = [],
  onDownloadAll,
  isDownloading = false
}) => {
  const { t } = useTranslation();
  // HeroDivider renders nothing for these, so there is no shape to clear.
  const hasVisibleDivider = !!dividerStyle && dividerStyle !== 'none' && dividerStyle !== 'straight';
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
    // A parent that passes the prop at all is choosing the hero itself, even
    // while its choice is still null for a render. Guessing photos[0] in that
    // gap started a full cover download that was thrown away a moment later,
    // so a phone fetched two 4K covers on every first visit.
    if (heroPhotoOverride !== undefined) return;

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

  const heroSrc = heroPhoto.hero_url
    ? withHeroWidth(heroPhoto.hero_url, pickHeroWidth())
    : heroPhoto.url;

  return (
    <div className="relative">
      {/* Hero Section */}
      <div className="relative left-1/2 -translate-x-1/2 w-screen h-[68svh] min-h-[380px] sm:h-screen sm:min-h-0 mb-4 sm:mb-6">
        <AuthenticatedImage
          src={heroSrc}
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

        {/* Overlay: flat dim (user-controlled) kept light, plus a gradient
            scrim concentrated behind the title so contrast does not depend on
            how bright this particular photograph happens to be. */}
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ opacity: overlayOpacity }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 90% 55% at 50% 55%, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.18) 45%, rgba(0,0,0,0) 75%)'
          }}
        />

        {/* Hero Content */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center px-4 sm:px-10 lg:px-14">
            {/* Event Title */}
            {eventName && (
              <h1 className="gallery-hero-title text-[clamp(1.75rem,7vw,4rem)] font-semibold text-white drop-shadow-lg mb-2 sm:mb-3 leading-[1.05]">
                {eventName}
              </h1>
            )}

            {/* Event date only. The expiry is stated once, by the banner - it
                does not belong under the couple's names as well. */}
            {eventDate && (
              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-6 text-white/90">
                {eventDate && (
                  <span className="flex items-center text-xs sm:text-xl">
                    <Calendar className="w-3.5 h-3.5 sm:w-6 sm:h-6 mr-1.5 sm:mr-2" />
                    {format(parseISO(eventDate), 'PP')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Download All + Photographer Credit, stacked bottom-centre.
            The divider is drawn over the bottom of the hero at h-12 sm:h-16, so
            sitting at bottom-3 put these underneath it and the wave cut straight
            across the label. Clear the divider's height when one is drawn; sit
            low when it is not, since 'none' and 'straight' render nothing. */}
        {(photographerName || credits.length > 0 || (allowDownloads && onDownloadAll)) && (
          <div
            className={`absolute inset-x-0 flex flex-col items-center gap-2 sm:gap-3 ${
              hasVisibleDivider ? 'bottom-16 sm:bottom-20' : 'bottom-3 sm:bottom-5'
            }`}
          >
            {allowDownloads && onDownloadAll && (
              <button
                type="button"
                onClick={onDownloadAll}
                disabled={isDownloading}
                className="gallery-hero-download"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>{isDownloading ? t('gallery.preparingDownload') : t('gallery.downloadAll')}</span>
              </button>
            )}
            <HeroCredits ownerName={photographerName} ownerUrl={photographerUrl} credits={credits} />
          </div>
        )}

        {/* Decorative Divider */}
        <HeroDivider style={dividerStyle} />
      </div>
    </div>
  );
};

HeroHeader.displayName = 'HeroHeader';
