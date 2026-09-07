import React, { useState, useEffect, useRef, useCallback } from 'react';
import { buildResourceUrl } from '../../utils/url';
import {
  getActiveGallerySlug,
  getGalleryToken,
  inferGallerySlugFromLocation,
  resolveSlugFromRequestUrl,
} from '../../utils/galleryAuthStorage';

interface AuthenticatedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'onLoad'> {
  src: string;
  fallbackSrc?: string;
  // Shown blurred, filling the frame, while the real image loads — e.g. pass
  // the already-cached grid thumbnail so a lightbox view has something to
  // show instantly instead of a blank/gray box.
  placeholderSrc?: string;
  useWatermark?: boolean;
  isGallery?: boolean;
  protectFromDownload?: boolean;
  slug?: string;
  photoId?: number;
  requiresToken?: boolean;
  secureUrlTemplate?: string;
  downloadUrlTemplate?: string;
  onProtectionViolation?: (violationType: string) => void;
  watermarkText?: string;
  overlayProtection?: boolean;
  fragmentGrid?: boolean;
  scrambleFragments?: boolean;
  useCanvasRendering?: boolean;
  blockKeyboardShortcuts?: boolean;
  detectPrintScreen?: boolean;
  detectDevTools?: boolean;
  protectionLevel?: 'basic' | 'standard' | 'enhanced' | 'maximum';
  useEnhancedProtection?: boolean;
  onLoad?: () => void;
}

// The size tiers the gallery thumbnail endpoint will build on request. Kept in
// step with THUMBNAIL_WIDTHS on the backend.
const THUMBNAIL_TIERS = [400, 800, 1200];

// Assumes the gallery grid: two columns on a phone, three on a tablet, four on
// a desktop. Without this the browser assumes the image spans the viewport and
// picks the largest tier, which would undo the whole point of the srcset.
const DEFAULT_TILE_SIZES = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw';

const buildThumbnailSrcSet = (resolvedSrc: string): string | undefined => {
  if (!resolvedSrc.includes('/thumbnail/')) return undefined;
  const joiner = resolvedSrc.includes('?') ? '&' : '?';
  return THUMBNAIL_TIERS.map((w) => `${resolvedSrc}${joiner}w=${w} ${w}w`).join(', ');
};

export const AuthenticatedImage: React.FC<AuthenticatedImageProps> = ({
  src,
  fallbackSrc,
  placeholderSrc,
  alt,
  useWatermark = false,
  isGallery = false,
  protectFromDownload,
  slug,
  photoId,
  requiresToken,
  secureUrlTemplate,
  downloadUrlTemplate,
  onProtectionViolation,
  watermarkText,
  overlayProtection,
  fragmentGrid,
  scrambleFragments,
  useCanvasRendering,
  blockKeyboardShortcuts,
  detectPrintScreen,
  detectDevTools,
  protectionLevel,
  useEnhancedProtection,
  onLoad,
  ...props
}) => {
  const unusedProps = {
    protectFromDownload,
    photoId,
    requiresToken,
    secureUrlTemplate,
    downloadUrlTemplate,
    onProtectionViolation,
    watermarkText,
    overlayProtection,
    fragmentGrid,
    scrambleFragments,
    blockKeyboardShortcuts,
    detectPrintScreen,
    detectDevTools,
    protectionLevel,
    useEnhancedProtection
  };
  void unusedProps;

  const [imageSrc, setImageSrc] = useState<string>('');
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [canvasReady, setCanvasReady] = useState(false);
  const [canvasFailed, setCanvasFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Route the pixels through a plain <img> whenever no protection feature
  // needs them to pass through JS first. That is the ordinary case here, and
  // on a phone it is the difference between a usable gallery and an unusable
  // one. Fetching each tile by hand into a Blob meant every image in the
  // gallery was requested the moment it mounted — eighty at once for a real
  // event — with no way for the browser to lazy-load them, choose a smaller
  // file for a small screen, or reuse its own HTTP cache on the next visit.
  //
  // Same-origin subresources carry the gallery cookie, so authentication is
  // unaffected; SameSite=Lax only withholds cookies from cross-site requests.
  const plainImageSrc = React.useMemo(() => {
    if (!src) return null;
    const needsScriptedPixels =
      useCanvasRendering ||
      useEnhancedProtection ||
      fragmentGrid ||
      scrambleFragments ||
      overlayProtection ||
      protectionLevel === 'enhanced' ||
      protectionLevel === 'maximum';
    if (needsScriptedPixels) return null;

    return src.startsWith('/admin')
      ? buildResourceUrl(`/api${src}`)
      : src.startsWith('/')
        ? buildResourceUrl(src)
        : src;
  }, [
    src,
    useCanvasRendering,
    useEnhancedProtection,
    fragmentGrid,
    scrambleFragments,
    overlayProtection,
    protectionLevel,
  ]);

  // Draw image to canvas when canvas rendering is enabled
  const drawToCanvas = useCallback(() => {
    if (!useCanvasRendering || !canvasRef.current || !imageRef.current) return;

    const canvas = canvasRef.current;
    const img = imageRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx || !img.complete || img.naturalWidth === 0) return;

    // Set canvas dimensions to match image
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // Draw the image
    ctx.drawImage(img, 0, 0);

    setCanvasReady(true);
  }, [useCanvasRendering]);

  useEffect(() => {
    let aborted = false;
    const objectUrls: string[] = [];

    // Nothing to fetch by hand in plain mode — the browser owns the request.
    if (plainImageSrc) {
      setIsLoading(false);
      return;
    }

    // Determine which token to use based on context
    if (!src) {
      setImageSrc(fallbackSrc || '');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(false);
    setCanvasFailed(false);
    setCanvasReady(false);

    const resolveSlug = (candidateSrc?: string): string | null => {
      if (slug) {
        return slug;
      }
      const fromUrl = candidateSrc ? resolveSlugFromRequestUrl(candidateSrc) : null;
      if (fromUrl) {
        return fromUrl;
      }
      return getActiveGallerySlug() || inferGallerySlugFromLocation();
    };

    const fetchWithAuth = async (rawUrl: string | undefined | null): Promise<string> => {
      if (!rawUrl) {
        throw new Error('No URL provided');
      }

      // Build full URL for the image
      const fullImageUrl = rawUrl.startsWith('/admin')
        ? buildResourceUrl(`/api${rawUrl}`)
        : rawUrl.startsWith('/')
          ? buildResourceUrl(rawUrl)
          : rawUrl;

      const headers: Record<string, string> = {};
      const slugForRequest = resolveSlug(rawUrl);
      const token = getGalleryToken(slugForRequest);
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(fullImageUrl, {
        credentials: 'include',
        headers: Object.keys(headers).length ? headers : undefined,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.push(objectUrl);
      return objectUrl;
    };

    const fetchImage = async () => {
      try {
        const primaryUrl = await fetchWithAuth(src);
        if (!aborted) {
          setImageSrc(primaryUrl);
          setError(false);
        }
      } catch (err) {
        setIsLoading(false);
        if (fallbackSrc && fallbackSrc !== src) {
          try {
            const fallbackUrl = await fetchWithAuth(fallbackSrc);
            if (!aborted) {
              setImageSrc(fallbackUrl);
              setError(false);
            }
            return;
          } catch (fallbackError) {
            // Swallow and mark error below
          }
        }
        if (!aborted) {
          setError(true);
          setImageSrc('');
        }
        return;
      }
      if (!aborted) {
        setIsLoading(false);
      }
    };

    fetchImage();

    // Cleanup function
    return () => {
      aborted = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, fallbackSrc, slug]);

  // Effect to draw to canvas when image is loaded and canvas rendering is enabled
  useEffect(() => {
    if (!useCanvasRendering || !imageSrc) return;

    // Create a hidden image to load and then draw to canvas
    const img = new Image();
    // Only set crossOrigin for non-blob URLs (blob URLs are same-origin)
    // Setting crossOrigin on blob URLs can cause silent failures
    if (!imageSrc.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      imageRef.current = img;
      drawToCanvas();
      onLoad?.();
    };

    img.onerror = (e) => {
      // Fall back to regular img if canvas loading fails
      console.warn('Canvas image load failed, falling back to img tag:', e);
      setCanvasFailed(true);
    };

    img.src = imageSrc;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [imageSrc, useCanvasRendering, drawToCanvas, onLoad]);

  if (plainImageSrc) {
    const { sizes: callerSizes, loading: callerLoading, ...imgProps } = props;
    const srcSet = buildThumbnailSrcSet(plainImageSrc);
    return (
      <img
        src={plainImageSrc}
        srcSet={srcSet}
        sizes={srcSet ? callerSizes || DEFAULT_TILE_SIZES : callerSizes}
        loading={callerLoading || 'lazy'}
        decoding="async"
        alt={alt}
        onLoad={onLoad}
        {...imgProps}
      />
    );
  }

  if (isLoading) {
    if (placeholderSrc) {
      // The caller's own style may gate opacity on ITS OWN load state (e.g.
      // the lightbox fades the real image in from 0 once loaded) — that
      // doesn't apply to this placeholder, which should stay visible for
      // the whole loading phase, so opacity is deliberately not inherited.
      const { opacity: _callerOpacity, ...restStyle } = (props.style || {}) as React.CSSProperties;
      return (
        <div className={props.className} style={{ overflow: 'hidden', ...restStyle, opacity: 1 }}>
          <img
            src={placeholderSrc}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover"
            style={{ filter: 'blur(16px)', transform: 'scale(1.1)' }}
          />
        </div>
      );
    }
    return (
      <div className={props.className} style={{ backgroundColor: 'var(--color-surface, #f3f4f6)', ...props.style }}>
        {/* Show a placeholder while loading */}
      </div>
    );
  }

  if (error && fallbackSrc) {
    return <img src={fallbackSrc} alt={alt} {...props} />;
  }

  if (!imageSrc) {
    return null;
  }

  // Canvas rendering mode - only if enabled and not failed
  if (useCanvasRendering && !canvasFailed) {
    return (
      <canvas
        ref={canvasRef}
        className={props.className}
        style={{
          ...props.style,
          // Hide canvas until it's ready to prevent flash
          opacity: canvasReady ? 1 : 0,
          transition: 'opacity 0.2s ease-in-out',
        }}
        // Prevent context menu on canvas
        onContextMenu={(e) => {
          e.preventDefault();
          onProtectionViolation?.('canvas_context_menu');
          return false;
        }}
        // Prevent drag
        onDragStart={(e) => {
          e.preventDefault();
          return false;
        }}
        aria-label={alt}
        role="img"
      />
    );
  }

  return <img src={imageSrc} alt={alt} onLoad={onLoad} {...props} />;
};
