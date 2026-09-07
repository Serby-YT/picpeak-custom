const sharp = require('sharp');
const exifr = require('exifr');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');
const { db } = require('../database/db');

// Configure sharp for better memory management with large batches
sharp.cache(false); // Disable cache to prevent memory buildup
sharp.concurrency(2); // Limit concurrent operations

// Default thumbnail settings
const DEFAULT_THUMBNAIL_WIDTH = 1200;
const DEFAULT_THUMBNAIL_HEIGHT = 1200;
const DEFAULT_THUMBNAIL_FIT = 'inside'; // preserve aspect ratio, no crop
const DEFAULT_THUMBNAIL_QUALITY = 90;
const DEFAULT_THUMBNAIL_FORMAT = 'webp';

const getStoragePath = () => process.env.STORAGE_PATH || path.join(__dirname, '../../../storage');
const getThumbnailPath = () => path.join(getStoragePath(), 'thumbnails');

// Helper to parse setting value (handles both JSON-encoded and plain values)
function parseSettingValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  // Try to parse as JSON first (in case it's a JSON-encoded string like '"cover"')
  try {
    return JSON.parse(value);
  } catch (e) {
    // If it's not valid JSON, return the raw value
    return value;
  }
}

// Validate that fit value is valid for Sharp
function validateFitValue(fit) {
  const validFitValues = ['cover', 'contain', 'fill', 'inside', 'outside'];
  if (fit && validFitValues.includes(fit)) {
    return fit;
  }
  return DEFAULT_THUMBNAIL_FIT;
}

// Get thumbnail settings from database
async function getThumbnailSettings() {
  try {
    const settings = await db('app_settings')
      .whereIn('setting_key', [
        'thumbnail_width',
        'thumbnail_height',
        'thumbnail_fit',
        'thumbnail_quality',
        'thumbnail_format'
      ])
      .select('setting_key', 'setting_value');

    const settingsMap = {};
    settings.forEach(s => {
      settingsMap[s.setting_key] = parseSettingValue(s.setting_value);
    });

    // Parse and validate fit value
    const fitValue = validateFitValue(settingsMap.thumbnail_fit);

    return {
      width: parseInt(settingsMap.thumbnail_width) || DEFAULT_THUMBNAIL_WIDTH,
      height: parseInt(settingsMap.thumbnail_height) || DEFAULT_THUMBNAIL_HEIGHT,
      fit: fitValue,
      quality: parseInt(settingsMap.thumbnail_quality) || DEFAULT_THUMBNAIL_QUALITY,
      format: settingsMap.thumbnail_format || DEFAULT_THUMBNAIL_FORMAT
    };
  } catch (error) {
    // If database is not ready or settings don't exist, use defaults
    logger.warn('Could not fetch thumbnail settings, using defaults:', error.message);
    return {
      width: DEFAULT_THUMBNAIL_WIDTH,
      height: DEFAULT_THUMBNAIL_HEIGHT,
      fit: DEFAULT_THUMBNAIL_FIT,
      quality: DEFAULT_THUMBNAIL_QUALITY,
      format: DEFAULT_THUMBNAIL_FORMAT
    };
  }
}

async function generateThumbnail(imagePath, options = {}) {
  // options.nameFrom lets the thumbnail be *read* from one file but *named*
  // after another, so it can be built from the cheap display copy while
  // keeping the thumb_<original> filename every other lookup expects.
  const filename = path.basename(options.nameFrom || imagePath);
  const thumbnailFilename = `thumb_${filename}`;
  const thumbnailDir = getThumbnailPath();
  const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);
  
  // Get thumbnail settings
  const settings = await getThumbnailSettings();
  
  // Ensure thumbnail directory exists
  await fs.mkdir(thumbnailDir, { recursive: true });
  
  // Check if we need to regenerate (for broken thumbnails)
  if (options.regenerate) {
    try {
      await fs.unlink(thumbnailPath);
      logger.info(`Deleted broken thumbnail: ${thumbnailPath}`);
    } catch (err) {
      // File might not exist, that's okay
    }
  }
  
  try {
    // First, verify the source image is complete and valid
    const metadata = await sharp(imagePath).metadata();
    
    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid image metadata - file may be incomplete');
    }
    
    // Create sharp instance with memory-efficient settings
    let sharpInstance = sharp(imagePath, { 
      limitInputPixels: 268402689, // ~16k x 16k max
      sequentialRead: true, // More memory efficient for large images
      failOnError: false // Don't fail on minor issues
    });
    
    // Strip EXIF/metadata from thumbnails (privacy: prevent GPS leak etc.)
    // Strip EXIF/ICC and normalise to sRGB.
    //
    // This used to read .withMetadata(false), which does the opposite of what
    // it looks like: in sharp any withMetadata() call *enables* metadata
    // retention, so the original 13.7KB EXIF block and the ICC profile were
    // copied into every derivative. Two consequences, both bad. The files were
    // about three times their necessary size — a 400px tile measured 41KB
    // against 13KB — and the privacy intent stated here was inverted, with
    // camera, lens, timestamps and any GPS the camera recorded shipped to
    // every gallery visitor. Omitting the call entirely is what strips them.
    //
    // toColourspace makes dropping the profile safe: these originals are
    // already sRGB, but an AdobeRGB export would otherwise render flat once
    // its profile was gone.
    sharpInstance = sharpInstance.toColourspace('srgb');

    // Apply resize with configured settings
    // For square thumbnails with 'cover' fit, we crop to center
    sharpInstance = sharpInstance.resize(settings.width, settings.height, {
      withoutEnlargement: true,
      fit: settings.fit, // 'cover' will crop to fill the exact dimensions
      position: 'center' // Center the crop for better composition
    });
    
    // Apply format-specific options
    if (settings.format === 'jpeg') {
      sharpInstance = sharpInstance.jpeg({ 
        quality: settings.quality,
        progressive: true, // Progressive JPEG for better loading
        mozjpeg: true // Better compression
      });
    } else if (settings.format === 'png') {
      sharpInstance = sharpInstance.png({
        quality: settings.quality,
        compressionLevel: 9,
        progressive: true
      });
    } else if (settings.format === 'webp') {
      sharpInstance = sharpInstance.webp({
        quality: settings.quality,
        effort: 4 // Balance between speed and compression
      });
    }
    
    // Write to a scratch name and rename into place. The serve path
    // regenerates missing thumbnails on demand, so two requests (or a request
    // and the derivative queue) can be producing the same file at the same
    // moment; without this they interleave writes and leave a truncated image.
    // rename(2) within a directory is atomic, so a reader sees the old file or
    // the new one, never a half-written one.
    const tempThumbnailPath = `${thumbnailPath}.${process.pid}.${Date.now()}.tmp`;
    await sharpInstance.toFile(tempThumbnailPath);

    // Verify the thumbnail was created successfully
    const stats = await fs.stat(tempThumbnailPath);
    if (stats.size === 0) {
      await fs.unlink(tempThumbnailPath).catch(() => {});
      throw new Error('Generated thumbnail is empty');
    }

    await fs.rename(tempThumbnailPath, thumbnailPath);

    return path.relative(getStoragePath(), thumbnailPath);
  } catch (error) {
    const msg = (error && error.message) ? error.message : String(error);
    logger.error(`Failed to generate thumbnail for ${filename}: ${msg}`);
    
    // Clean up any partially created file. The scratch name is only known
    // inside the try block, so sweep the directory for this run's leftovers.
    await fs.unlink(thumbnailPath).catch(() => {});
    try {
      const dir = path.dirname(thumbnailPath);
      const base = path.basename(thumbnailPath);
      const leftovers = await fs.readdir(dir);
      await Promise.all(
        leftovers
          .filter((name) => name.startsWith(`${base}.${process.pid}.`) && name.endsWith('.tmp'))
          .map((name) => fs.unlink(path.join(dir, name)).catch(() => {}))
      );
    } catch (sweepErr) {
      // Ignore - a stray scratch file is harmless
    }
    
    // Return null if thumbnail generation fails, don't fail the whole upload
    return null;
  }
}

/**
 * Check if a thumbnail exists and is valid
 */
async function isThumbnailValid(thumbnailPath) {
  try {
    const fullPath = path.join(getStoragePath(), thumbnailPath);
    const stats = await fs.stat(fullPath);
    
    // Check if file exists and has content
    if (stats.size === 0) {
      return false;
    }
    
    // Try to read metadata to ensure it's a valid image
    await sharp(fullPath).metadata();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Regenerate thumbnail if it's broken or missing
 */
async function ensureThumbnail(photo) {
  const { db } = require('../database/db');
  const { resolvePhotoFilePath } = require('./photoResolver');
  let originalPath;
  try {
    const event = await db('events').where('id', photo.event_id).first();
    originalPath = resolvePhotoFilePath(event, photo);
    logger.info(`Ensuring thumbnail for photo ${photo.id} from source: ${originalPath}`);
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    logger.error(`Failed to resolve original path for thumbnail (photo ${photo.id}): ${msg}`);
    return null;
  }
  
  // Check if thumbnail exists and is valid
  if (photo.thumbnail_path) {
    const isValid = await isThumbnailValid(photo.thumbnail_path);
    if (isValid) {
      return photo.thumbnail_path;
    }
    logger.warn(`Invalid thumbnail detected for photo ${photo.id}, regenerating...`);
  }
  
  // Generate new thumbnail. Prefer the display copy as the source when one
  // exists: it is a 2560px WebP that decodes in a fraction of the time of a
  // 32MP camera original, is still comfortably larger than the thumbnail it
  // feeds, and is indistinguishable at thumbnail scale. This route is hit for
  // every tile of a freshly uploaded event, so the difference is the whole
  // grid loading briskly rather than the box decoding full-size JPEGs.
  let thumbnailSource = originalPath;
  try {
    const displayCandidate = path.join(getDisplayPath(), displayFilename(originalPath));
    const displayStats = await fs.stat(displayCandidate);
    if (displayStats.size > 0) {
      thumbnailSource = displayCandidate;
    }
  } catch (err) {
    // No display copy yet — fall back to decoding the original.
  }

  const newThumbnailPath = await generateThumbnail(thumbnailSource, {
    regenerate: true,
    nameFrom: originalPath
  });
  
  if (newThumbnailPath) {
    // Update database with new thumbnail path
    const { db } = require('../database/db');
    await db('photos')
      .where({ id: photo.id })
      .update({ thumbnail_path: newThumbnailPath });
    
    logger.info(`Regenerated thumbnail for photo ${photo.id}`);
    return newThumbnailPath;
  }
  
  return null;
}

async function generateVideoPlaceholder(originalFilename, options = {}) {
  const parsed = path.parse(originalFilename || '');
  const baseName = parsed.name || 'video';
  const thumbnailDir = getThumbnailPath();
  const thumbnailFilename = `thumb_${baseName}.jpg`;
  const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);

  const settings = await getThumbnailSettings();
  const width = settings.width || DEFAULT_THUMBNAIL_WIDTH;
  const height = settings.height || DEFAULT_THUMBNAIL_HEIGHT;

  if (options.regenerate) {
    try {
      await fs.unlink(thumbnailPath);
    } catch (_) {
      // ignore if missing
    }
  }

  try {
    await fs.mkdir(thumbnailDir, { recursive: true });
    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a" stop-opacity="0.9"/>
            <stop offset="100%" stop-color="#1e293b" stop-opacity="0.9"/>
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" rx="18" fill="url(#grad)"/>
        <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 6}" fill="rgba(255,255,255,0.85)"/>
        <polygon points="${width / 2 - 10},${height / 2 - 14} ${width / 2 - 10},${height / 2 + 14} ${width / 2 + 16},${height / 2}" fill="#0f172a"/>
        <text x="50%" y="${height - 18}" font-family="Arial, sans-serif" font-size="16" fill="rgba(255,255,255,0.9)" text-anchor="middle">
          VIDEO
        </text>
      </svg>
    `;

    await sharp(Buffer.from(svg))
      .resize(width, height, { fit: 'cover' })
      .jpeg({ quality: settings.quality || DEFAULT_THUMBNAIL_QUALITY })
      .toFile(thumbnailPath);

    return path.relative(getStoragePath(), thumbnailPath);
  } catch (error) {
    logger.error('Failed to generate video placeholder thumbnail:', error.message);
    return null;
  }
}

// Hero image settings - optimized for large/retina displays
const DEFAULT_HERO_WIDTH = 3840;
const DEFAULT_HERO_HEIGHT = 2160;
const DEFAULT_HERO_QUALITY = 90;
const DEFAULT_HERO_FORMAT = 'jpeg';

const getHeroPath = () => path.join(getStoragePath(), 'heroes');

/**
 * Generate a hero-optimized image for gallery headers
 * Outputs a 1920x1080 image suitable for full-width hero sections
 */
async function generateHeroImage(imagePath, options = {}) {
  const filename = path.basename(imagePath);
  const heroFilename = `hero_${filename}`;
  const heroDir = getHeroPath();
  const heroPath = path.join(heroDir, heroFilename);

  // Ensure hero directory exists
  await fs.mkdir(heroDir, { recursive: true });

  // Check if we need to regenerate
  if (options.regenerate) {
    try {
      await fs.unlink(heroPath);
      logger.info(`Deleted existing hero image: ${heroPath}`);
    } catch (err) {
      // File might not exist, that's okay
    }
  }

  try {
    // First, verify the source image is complete and valid
    const metadata = await sharp(imagePath).metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid image metadata - file may be incomplete');
    }

    // Calculate dimensions to maintain aspect ratio while fitting within hero bounds
    const heroWidth = options.width || DEFAULT_HERO_WIDTH;
    const heroHeight = options.height || DEFAULT_HERO_HEIGHT;
    const quality = options.quality || DEFAULT_HERO_QUALITY;

    // Create sharp instance with memory-efficient settings
    let sharpInstance = sharp(imagePath, {
      limitInputPixels: 268402689,
      sequentialRead: true,
      failOnError: false
    });

    // Strip EXIF/metadata from hero images (privacy: prevent GPS leak etc.)
    // Strip EXIF/ICC and normalise to sRGB.
    //
    // This used to read .withMetadata(false), which does the opposite of what
    // it looks like: in sharp any withMetadata() call *enables* metadata
    // retention, so the original 13.7KB EXIF block and the ICC profile were
    // copied into every derivative. Two consequences, both bad. The files were
    // about three times their necessary size — a 400px tile measured 41KB
    // against 13KB — and the privacy intent stated here was inverted, with
    // camera, lens, timestamps and any GPS the camera recorded shipped to
    // every gallery visitor. Omitting the call entirely is what strips them.
    //
    // toColourspace makes dropping the profile safe: these originals are
    // already sRGB, but an AdobeRGB export would otherwise render flat once
    // its profile was gone.
    sharpInstance = sharpInstance.toColourspace('srgb');

    // Resize to fit hero dimensions while maintaining aspect ratio
    // Use 'cover' to fill the hero area (crops if needed)
    sharpInstance = sharpInstance.resize(heroWidth, heroHeight, {
      withoutEnlargement: false, // Allow upscaling for small images
      fit: 'cover',
      position: 'center'
    });

    // Apply JPEG format with high quality
    sharpInstance = sharpInstance.jpeg({
      quality: quality,
      progressive: true,
      mozjpeg: true
    });

    // Save the hero image
    await sharpInstance.toFile(heroPath);

    // Verify the hero image was created successfully
    const stats = await fs.stat(heroPath);
    if (stats.size === 0) {
      throw new Error('Generated hero image is empty');
    }

    logger.info(`Generated hero image for ${filename}: ${heroPath}`);
    return path.relative(getStoragePath(), heroPath);
  } catch (error) {
    const msg = (error && error.message) ? error.message : String(error);
    logger.error(`Failed to generate hero image for ${filename}: ${msg}`);

    // Clean up any partially created file
    try {
      await fs.unlink(heroPath);
    } catch (unlinkErr) {
      // Ignore unlink errors
    }

    return null;
  }
}

/**
 * Check if a hero image exists and is valid
 */
async function isHeroValid(heroPath) {
  try {
    const fullPath = path.join(getStoragePath(), heroPath);
    const stats = await fs.stat(fullPath);

    if (stats.size === 0) {
      return false;
    }

    // Try to read metadata to ensure it's a valid image
    await sharp(fullPath).metadata();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Ensure a hero image exists for a photo, regenerate if needed
 */
async function ensureHeroImage(photo) {
  const { db } = require('../database/db');
  const { resolvePhotoFilePath } = require('./photoResolver');

  let originalPath;
  try {
    const event = await db('events').where('id', photo.event_id).first();
    originalPath = resolvePhotoFilePath(event, photo);
    logger.info(`Ensuring hero image for photo ${photo.id} from source: ${originalPath}`);
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    logger.error(`Failed to resolve original path for hero image (photo ${photo.id}): ${msg}`);
    return null;
  }

  // Check if hero image exists and is valid
  if (photo.hero_path) {
    const isValid = await isHeroValid(photo.hero_path);
    if (isValid) {
      return photo.hero_path;
    }
    logger.warn(`Invalid hero image detected for photo ${photo.id}, regenerating...`);
  }

  // Generate new hero image
  const newHeroPath = await generateHeroImage(originalPath, { regenerate: true });

  if (newHeroPath) {
    // Update database with new hero path
    await db('photos')
      .where({ id: photo.id })
      .update({ hero_path: newHeroPath });

    logger.info(`Regenerated hero image for photo ${photo.id}`);
    return newHeroPath;
  }

  return null;
}

// Display image settings — a lightbox-viewing variant, capped at a sane
// on-screen resolution and encoded as WebP for a smaller transfer than the
// original camera file. Never used for downloads (those always serve the
// true original at full quality/resolution).
const DEFAULT_DISPLAY_WIDTH = 2560;
const DEFAULT_DISPLAY_HEIGHT = 2560;
const DEFAULT_DISPLAY_QUALITY = 88;

const getDisplayPath = () => path.join(getStoragePath(), 'display');

const displayFilename = (originalFilename) => {
  const base = path.basename(originalFilename, path.extname(originalFilename));
  return `display_${base}.webp`;
};

/**
 * Generate a lightbox-display variant: downscaled to fit within
 * DEFAULT_DISPLAY_WIDTH/HEIGHT (no crop, aspect preserved), WebP encoded.
 */
async function generateDisplayImage(imagePath) {
  const displayDir = getDisplayPath();
  const displayPath = path.join(displayDir, displayFilename(imagePath));

  await fs.mkdir(displayDir, { recursive: true });

  try {
    const metadata = await sharp(imagePath).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid image metadata - file may be incomplete');
    }

    let sharpInstance = sharp(imagePath, {
      limitInputPixels: 268402689,
      sequentialRead: true,
      failOnError: false
    });

    // Strip EXIF/ICC and normalise to sRGB.
    //
    // This used to read .withMetadata(false), which does the opposite of what
    // it looks like: in sharp any withMetadata() call *enables* metadata
    // retention, so the original 13.7KB EXIF block and the ICC profile were
    // copied into every derivative. Two consequences, both bad. The files were
    // about three times their necessary size — a 400px tile measured 41KB
    // against 13KB — and the privacy intent stated here was inverted, with
    // camera, lens, timestamps and any GPS the camera recorded shipped to
    // every gallery visitor. Omitting the call entirely is what strips them.
    //
    // toColourspace makes dropping the profile safe: these originals are
    // already sRGB, but an AdobeRGB export would otherwise render flat once
    // its profile was gone.
    sharpInstance = sharpInstance.toColourspace('srgb');

    // 'inside' — downscale only, preserve full frame and aspect ratio.
    // Never crops and never upscales (withoutEnlargement default true here
    // matters: a display copy should never exceed the original's own size).
    sharpInstance = sharpInstance.resize(DEFAULT_DISPLAY_WIDTH, DEFAULT_DISPLAY_HEIGHT, {
      fit: 'inside',
      withoutEnlargement: true
    });

    sharpInstance = sharpInstance.webp({ quality: DEFAULT_DISPLAY_QUALITY, effort: 4 });

    // Same reason as the thumbnail: written under a scratch name and renamed
    // into place, so a concurrent generator cannot be read mid-write.
    const tempDisplayPath = `${displayPath}.${process.pid}.${Date.now()}.tmp`;
    await sharpInstance.toFile(tempDisplayPath);

    const stats = await fs.stat(tempDisplayPath);
    if (stats.size === 0) {
      await fs.unlink(tempDisplayPath).catch(() => {});
      throw new Error('Generated display image is empty');
    }

    await fs.rename(tempDisplayPath, displayPath);

    return path.relative(getStoragePath(), displayPath);
  } catch (error) {
    const msg = (error && error.message) ? error.message : String(error);
    logger.error(`Failed to generate display image for ${path.basename(imagePath)}: ${msg}`);
    await fs.unlink(displayPath).catch(() => {});
    try {
      const dir = path.dirname(displayPath);
      const base = path.basename(displayPath);
      const leftovers = await fs.readdir(dir);
      await Promise.all(
        leftovers
          .filter((name) => name.startsWith(`${base}.${process.pid}.`) && name.endsWith('.tmp'))
          .map((name) => fs.unlink(path.join(dir, name)).catch(() => {}))
      );
    } catch (sweepErr) {
      // Ignore - a stray scratch file is harmless
    }
    return null;
  }
}

/**
 * Ensure a display variant exists for this original photo file, generating
 * it on first request. No DB column needed — path is deterministic from the
 * original filename, existence is checked directly on disk.
 */
async function ensureDisplayImage(imagePath) {
  const displayPath = path.join(getDisplayPath(), displayFilename(imagePath));

  try {
    const stats = await fs.stat(displayPath);
    if (stats.size > 0) {
      return path.relative(getStoragePath(), displayPath);
    }
  } catch (err) {
    // Doesn't exist yet — fall through to generate
  }

  return generateDisplayImage(imagePath);
}

/**
 * Extract capture date from EXIF metadata
 * @param {string} imagePath - Path to the image file
 * @returns {Date|null} - The capture date or null if not available
 */
async function extractCaptureDate(imagePath) {
  try {
    // Parse EXIF data, looking for common date fields
    const exif = await exifr.parse(imagePath, {
      pick: ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'ModifyDate']
    });

    if (!exif) {
      return null;
    }

    // Priority order: DateTimeOriginal > CreateDate > DateTimeDigitized > ModifyDate
    const captureDate = exif.DateTimeOriginal ||
                        exif.CreateDate ||
                        exif.DateTimeDigitized ||
                        exif.ModifyDate;

    if (captureDate) {
      // exifr returns Date objects directly when parsing dates
      if (captureDate instanceof Date) {
        // Validate the date is reasonable (not in the future, not before 1990)
        const now = new Date();
        const minDate = new Date('1990-01-01');
        if (captureDate > minDate && captureDate <= now) {
          return captureDate;
        }
      }
      // Handle string dates if necessary
      if (typeof captureDate === 'string') {
        const parsed = new Date(captureDate);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }

    return null;
  } catch (error) {
    // Log only as debug - many images don't have EXIF data
    logger.debug(`Could not extract EXIF date from ${path.basename(imagePath)}:`, error.message);
    return null;
  }
}

/**
 * Build both derivative sizes from a single decode of the original.
 *
 * The old upload path opened the same 32MP camera file four times: metadata
 * for the thumbnail, the thumbnail resize, metadata again for the stored
 * dimensions, then metadata plus the resize for the display copy. Decoding a
 * 6960x4640 JPEG is nearly all of the cost, so the display copy is made from
 * the original once and the thumbnail is taken from *that*: a 2560px WebP
 * decodes in a fraction of the time and is still more than twice the size of
 * the thumbnail it feeds, so nothing is upscaled and the result is visually
 * identical at thumbnail scale.
 *
 * Falls back to reading the original if the display copy could not be
 * written, so a failure here costs speed, never a missing thumbnail.
 */
async function generateDerivatives(imagePath) {
  const result = { thumbnailPath: null, displayPath: null, width: null, height: null };
  const filename = path.basename(imagePath);

  try {
    const metadata = await sharp(imagePath).metadata();
    if (metadata.width && metadata.height) {
      result.width = metadata.width;
      result.height = metadata.height;
    }
  } catch (error) {
    logger.warn(`Could not read dimensions for ${filename}: ${error.message}`);
  }

  result.displayPath = await generateDisplayImage(imagePath);

  const thumbnailSource = result.displayPath
    ? path.join(getStoragePath(), result.displayPath)
    : imagePath;

  try {
    result.thumbnailPath = await generateThumbnail(thumbnailSource, { nameFrom: imagePath });
  } catch (error) {
    logger.error(`Failed to generate thumbnail for ${filename}: ${error.message}`);
  }

  return result;
}

// Widths the gallery is allowed to ask for. A closed set, because each one is
// a file on disk and an open parameter would let a caller fill the volume with
// arbitrary sizes. 400 covers a two-column phone grid at 2x, 800 a tablet or a
// dense desktop column, 1200 the largest tile any layout renders.
const THUMBNAIL_WIDTHS = [400, 800, 1200];

function normalizeThumbnailWidth(requested) {
  const value = parseInt(requested, 10);
  if (!Number.isFinite(value)) return null;
  // Round up to the first tier that covers the request, so a 500px slot is
  // served the 800 rather than an upscaled 400.
  return THUMBNAIL_WIDTHS.find((w) => w >= value) || null;
}

/**
 * A thumbnail at one of the allowed widths, generated on first request and
 * cached on disk beside the others.
 *
 * The single 1200px thumbnail was being sent to every device: on a phone
 * showing two columns that is roughly ten times the pixels the screen can use,
 * and across a gallery of eighty photos it is about 14MB where 0.5MB would do.
 *
 * Built from the display copy when one exists — decoding a 2560px WebP is far
 * cheaper than a 32MP original, and it is still larger than every tier here.
 */
async function ensureThumbnailAtWidth(photo, requestedWidth) {
  const width = normalizeThumbnailWidth(requestedWidth);
  if (!width) return null;

  const { resolvePhotoFilePath } = require("./photoResolver");
  const { db } = require("../database/db");

  let originalPath;
  try {
    const event = await db("events").where("id", photo.event_id).first();
    originalPath = resolvePhotoFilePath(event, photo);
  } catch (error) {
    logger.error(`Could not resolve source for sized thumbnail (photo ${photo.id}): ${error.message}`);
    return null;
  }

  const tierDir = path.join(getThumbnailPath(), `w${width}`);
  const filename = `thumb_${path.basename(originalPath)}`;
  const tierPath = path.join(tierDir, filename);

  try {
    const stats = await fs.stat(tierPath);
    if (stats.size > 0) {
      return path.relative(getStoragePath(), tierPath);
    }
  } catch (err) {
    // Not built yet.
  }

  let source = originalPath;
  try {
    const displayCandidate = path.join(getDisplayPath(), displayFilename(originalPath));
    const displayStats = await fs.stat(displayCandidate);
    if (displayStats.size > 0) source = displayCandidate;
  } catch (err) {
    // No display copy; fall back to the original.
  }

  await fs.mkdir(tierDir, { recursive: true });
  const tempPath = `${tierPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await sharp(source, { sequentialRead: true, failOnError: false })
      .toColourspace('srgb')
      .resize(width, width, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toFile(tempPath);

    const stats = await fs.stat(tempPath);
    if (stats.size === 0) {
      await fs.unlink(tempPath).catch(() => {});
      throw new Error("Generated thumbnail is empty");
    }

    await fs.rename(tempPath, tierPath);
    return path.relative(getStoragePath(), tierPath);
  } catch (error) {
    logger.error(`Failed to build ${width}px thumbnail for photo ${photo.id}: ${error.message}`);
    await fs.unlink(tempPath).catch(() => {});
    return null;
  }
}

module.exports = {
  generateThumbnail,
  ensureThumbnailAtWidth,
  THUMBNAIL_WIDTHS,
  generateDerivatives,
  isThumbnailValid,
  ensureThumbnail,
  generateVideoPlaceholder,
  generateHeroImage,
  isHeroValid,
  ensureHeroImage,
  generateDisplayImage,
  ensureDisplayImage,
  extractCaptureDate
};
