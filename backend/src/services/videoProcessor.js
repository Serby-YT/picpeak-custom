const ffmpeg = require('fluent-ffmpeg');
const fsSync = require('fs');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

/**
 * Resolve an ffmpeg-family binary.
 *
 * Prefer the system build: Alpine's `ffmpeg` package ships both ffmpeg and
 * ffprobe and stays current. The bundled @ffmpeg-installer build ships ffmpeg
 * ONLY, so without a system ffprobe every metadata read fails and uploads are
 * rejected as "Invalid video file".
 */
function resolveBinary(name, envVar, bundled) {
  const candidates = [
    process.env[envVar],
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
    bundled
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch (err) {
      // Not usable, try the next candidate.
    }
  }
  return null;
}

let bundledFfmpeg = null;
try {
  bundledFfmpeg = require('@ffmpeg-installer/ffmpeg').path;
} catch (err) {
  logger.warn('Bundled ffmpeg package unavailable', { error: err.message });
}

const ffmpegPath = resolveBinary('ffmpeg', 'FFMPEG_PATH', bundledFfmpeg);
const ffprobePath = resolveBinary('ffprobe', 'FFPROBE_PATH', null);

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
} else {
  logger.error('No ffmpeg binary found - video processing will fail');
}

if (ffprobePath) {
  ffmpeg.setFfprobePath(ffprobePath);
} else {
  logger.error('No ffprobe binary found - video metadata extraction will fail');
}

logger.info('Video processing binaries resolved', { ffmpegPath, ffprobePath });

/**
 * Extract video metadata using FFmpeg
 * @param {string} videoPath - Path to the video file
 * @returns {Promise<Object>} - Video metadata
 */
async function extractVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        logger.error('Error extracting video metadata', { error: err.message, videoPath });
        return reject(err);
      }

      try {
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        const result = {
          duration: Math.floor(metadata.format.duration || 0),
          width: videoStream?.width || null,
          height: videoStream?.height || null,
          videoCodec: videoStream?.codec_name || null,
          audioCodec: audioStream?.codec_name || null,
          size: metadata.format.size || 0,
          bitrate: metadata.format.bit_rate || null,
          format: metadata.format.format_name || null
        };

        resolve(result);
      } catch (parseErr) {
        logger.error('Error parsing video metadata', { error: parseErr.message });
        reject(parseErr);
      }
    });
  });
}

// Thumbnails keep the source aspect ratio; 600px wide suits the large tiles a
// video gets in a masonry gallery.
const THUMBNAIL_WIDTH = 600;

/**
 * Generate a poster frame for a video.
 *
 * @param {string} videoPath - Path to the video file
 * @param {string} outputPath - Path for the output thumbnail
 * @param {Object} options - { timeOffset, width, quality }
 * @returns {Promise<string>} - Path to generated thumbnail
 */
async function generateVideoThumbnail(videoPath, outputPath, options = {}) {
  const {
    timeOffset = null,
    width = THUMBNAIL_WIDTH,
    quality = 2 // mjpeg scale, 1-31, lower is better
  } = options;

  // Pick a frame worth showing. The opening second of an edited film is
  // usually black, a fade-in or a title card, so sample a little way in and
  // let ffmpeg's `thumbnail` filter choose the most representative frame from
  // the batch that follows.
  let seek = timeOffset;
  if (seek === null) {
    let duration = 0;
    try {
      duration = await getVideoDuration(videoPath);
    } catch (err) {
      duration = 0;
    }
    seek = duration > 12 ? duration * 0.1 : Math.max(0, Math.min(1, duration / 3));
  }

  const seekArg = typeof seek === 'number' ? seek.toFixed(2) : seek;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .inputOptions([`-ss ${seekArg}`])
      .outputOptions([
        '-frames:v', '1',
        // scale preserves the source aspect. Forcing a square (the old
        // `size: '300x300'`) squashed every 16:9 frame, so the still did not
        // match the clip that plays over it on hover.
        '-vf', `thumbnail,scale='min(${width},iw)':-2`,
        '-q:v', String(quality),
        '-an'
      ])
      .output(outputPath)
      .on('end', () => {
        logger.info('Video thumbnail generated', { videoPath, outputPath, seek: seekArg });
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error('Error generating video thumbnail', { error: err.message, videoPath });
        reject(err);
      })
      .run();
  });
}

/**
 * Validate that a file is a valid video
 * @param {string} videoPath - Path to the video file
 * @returns {Promise<boolean>} - True if valid video
 */
async function isValidVideo(videoPath) {
  try {
    const metadata = await extractVideoMetadata(videoPath);
    return metadata.duration > 0 && metadata.width > 0 && metadata.height > 0;
  } catch (error) {
    logger.error('Video validation failed', { error: error.message, videoPath });
    return false;
  }
}

/**
 * Get video duration in seconds
 * @param {string} videoPath - Path to the video file
 * @returns {Promise<number>} - Duration in seconds
 */
async function getVideoDuration(videoPath) {
  try {
    const metadata = await extractVideoMetadata(videoPath);
    return metadata.duration;
  } catch (error) {
    logger.error('Error getting video duration', { error: error.message });
    return 0;
  }
}

/**
 * Process uploaded video - extract metadata and generate thumbnail
 * @param {string} videoPath - Path to the video file
 * @param {string} thumbnailPath - Path for the thumbnail
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Video metadata and processing result
 */
async function processUploadedVideo(videoPath, thumbnailPath, options = {}) {
  try {
    // Validate video
    const isValid = await isValidVideo(videoPath);
    if (!isValid) {
      throw new Error('Invalid video file');
    }

    // Extract metadata
    const metadata = await extractVideoMetadata(videoPath);

    // Generate thumbnail
    await generateVideoThumbnail(videoPath, thumbnailPath, options);

    // Verify thumbnail was created
    try {
      await fs.access(thumbnailPath);
    } catch (err) {
      throw new Error('Thumbnail generation failed');
    }

    return {
      success: true,
      metadata,
      thumbnailPath
    };
  } catch (error) {
    logger.error('Error processing video', { error: error.message, videoPath });
    throw error;
  }
}

/**
 * Get video thumbnail at specific time
 * @param {string} videoPath - Path to video file
 * @param {string} outputPath - Output path for thumbnail
 * @param {number} timeInSeconds - Time in seconds to capture thumbnail
 * @returns {Promise<string>} - Path to thumbnail
 */
async function getThumbnailAtTime(videoPath, outputPath, timeInSeconds = 1) {
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  const timeOffset = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return generateVideoThumbnail(videoPath, outputPath, { timeOffset });
}

/**
 * Check if file is a video based on MIME type
 * @param {string} mimeType - MIME type of the file
 * @returns {boolean} - True if video MIME type
 */
function isVideoMimeType(mimeType) {
  return mimeType && mimeType.startsWith('video/');
}

// Hover preview defaults: a short muted montage, YouTube-style.
const PREVIEW_SEGMENTS = 3;
const PREVIEW_SEGMENT_SECONDS = 1.5;
const PREVIEW_WIDTH = 480;

/**
 * Generate a short, muted hover-preview clip.
 *
 * Samples a few evenly spaced segments and concatenates them, rather than
 * taking the head of the file - the first seconds of an event film are usually
 * titles or establishing shots and say nothing about the video.
 *
 * @param {string} videoPath - Path to the source video
 * @param {string} outputPath - Path for the output .mp4
 * @param {Object} options - { segments, segmentSeconds, width }
 * @returns {Promise<string>} - Path to the generated preview
 */
async function generateHoverPreview(videoPath, outputPath, options = {}) {
  const {
    segments = PREVIEW_SEGMENTS,
    segmentSeconds = PREVIEW_SEGMENT_SECONDS,
    width = PREVIEW_WIDTH
  } = options;

  const duration = await getVideoDuration(videoPath);
  if (!duration || duration <= 0) {
    throw new Error('Cannot generate preview without a valid duration');
  }

  // Too short to sample across: just take the opening.
  const usable = duration < segments * segmentSeconds * 2 ? 1 : segments;
  const segLength = Math.min(segmentSeconds, duration / (usable + 1));

  const offsets = [];
  for (let i = 0; i < usable; i++) {
    offsets.push(usable === 1 ? 0 : (duration * (i + 1)) / (usable + 1));
  }

  // Open the source once per segment with an input-level seek. Input seeking
  // jumps straight to the keyframe, so a 10-minute film costs the same as a
  // 30-second one; a filter-level trim would decode everything up to the last
  // sample point.
  const command = ffmpeg();
  offsets.forEach((start) => {
    command.input(videoPath).inputOptions([`-ss ${start.toFixed(2)}`]);
  });

  const parts = offsets.map((_, i) =>
    `[${i}:v]trim=duration=${segLength.toFixed(2)},` +
    `setpts=PTS-STARTPTS,scale='min(${width},iw)':-2[v${i}]`
  );
  const labels = offsets.map((_, i) => `[v${i}]`).join('');
  const filter = `${parts.join(';')};${labels}concat=n=${usable}:v=1:a=0[out]`;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    command
      .complexFilter(filter, 'out')
      .outputOptions([
        '-an',                    // muted - previews never carry audio
        '-c:v', 'libx264',
        '-profile:v', 'baseline', // widest mobile decoder support
        '-level', '3.1',
        '-pix_fmt', 'yuv420p',
        '-crf', '30',
        '-preset', 'veryfast',
        '-r', '24',
        '-movflags', '+faststart' // start playing before the whole file lands
      ])
      .output(outputPath)
      .on('end', () => {
        logger.info('Hover preview generated', { videoPath, outputPath, segments: usable });
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error('Error generating hover preview', { error: err.message, videoPath });
        reject(err);
      })
      .run();
  });
}

module.exports = {
  extractVideoMetadata,
  generateVideoThumbnail,
  generateHoverPreview,
  isValidVideo,
  getVideoDuration,
  processUploadedVideo,
  getThumbnailAtTime,
  isVideoMimeType
};
