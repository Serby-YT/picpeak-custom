const path = require('path');
const fs = require('fs').promises;
const { db } = require('../database/db');
const logger = require('../utils/logger');
const { generateDerivatives } = require('./imageProcessor');
const { processUploadedVideo, isVideoMimeType } = require('./videoProcessor');
const watermarkGeneratorService = require('./watermarkGeneratorService');

const getStoragePath = () => process.env.STORAGE_PATH || path.join(__dirname, '../../../storage');

// Two at a time. sharp already spreads a single resize across all four cores,
// so more workers buy no throughput and cost memory — and this box swaps.
//
// Two is also the point of this queue. The upload route used to fire a display
// image job per photo with no ceiling at all, so a batch of twenty-five could
// put twenty-five 32MP decodes in flight at once while the request was still
// thumbnailing them one by one.
const CONCURRENCY = 2;

const pending = [];
let active = 0;

/**
 * Queue a photo's derivative work (thumbnail, display copy, dimensions,
 * watermark) to run after the upload response has already gone out.
 *
 * Nothing here is on the critical path: until a job runs the photo simply has
 * no thumbnail_path, which the admin grid and the gallery both already render
 * as a placeholder. A failure is logged and dropped rather than retried —
 * thumbnails can be rebuilt from the admin at any time, and a poison file must
 * not be able to wedge the queue behind it.
 */
function enqueue(job) {
  pending.push(job);
  pump();
}

function pump() {
  while (active < CONCURRENCY && pending.length > 0) {
    const job = pending.shift();
    active++;
    run(job)
      .catch((error) => {
        logger.error(`Derivative job crashed for photo ${job.photoId}: ${error.message}`);
      })
      .finally(() => {
        active--;
        pump();
      });
  }
}

async function run({ photoId, filePath, filename, mimeType }) {
  if (!photoId) return;

  if (isVideoMimeType(mimeType)) {
    await runVideo({ photoId, filePath, filename });
    return;
  }

  const { thumbnailPath, width, height } = await generateDerivatives(filePath);

  const update = {};
  if (thumbnailPath) update.thumbnail_path = thumbnailPath;
  if (width) update.width = width;
  if (height) update.height = height;

  if (Object.keys(update).length > 0) {
    await db('photos').where({ id: photoId }).update(update);
  }

  try {
    await watermarkGeneratorService.generateForPhoto(photoId);
  } catch (error) {
    logger.warn(`Watermark generation failed for photo ${photoId}: ${error.message}`);
  }
}

async function runVideo({ photoId, filePath, filename }) {
  const thumbnailDir = path.join(getStoragePath(), 'thumbnails');
  await fs.mkdir(thumbnailDir, { recursive: true });
  const videoThumbnailPath = path.join(thumbnailDir, `thumb_${filename.replace(/\.[^.]+$/, '.jpg')}`);

  const result = await processUploadedVideo(filePath, videoThumbnailPath);

  const update = { thumbnail_path: path.relative(getStoragePath(), videoThumbnailPath) };
  if (result.metadata) {
    update.duration = result.metadata.duration;
    update.video_codec = result.metadata.videoCodec;
    update.audio_codec = result.metadata.audioCodec;
    update.width = result.metadata.width;
    update.height = result.metadata.height;
  }

  await db('photos').where({ id: photoId }).update(update);
}

function stats() {
  return { pending: pending.length, active };
}

module.exports = { enqueue, stats };
