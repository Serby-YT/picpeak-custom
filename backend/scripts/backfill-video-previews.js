#!/usr/bin/env node

/**
 * Generate hover-preview clips for videos uploaded before previews existed.
 *
 * Safe to re-run: videos that already have a preview on disk are skipped.
 * Usage: node scripts/backfill-video-previews.js [eventId] [--force]
 */

const path = require('path');
const fs = require('fs').promises;
const { db } = require('../src/database/db');
const { generateHoverPreview } = require('../src/services/videoProcessor');

const STORAGE_PATH = process.env.STORAGE_PATH || path.join(__dirname, '../../storage');
const THUMBNAILS_DIR = path.join(STORAGE_PATH, 'thumbnails');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function backfillPreviews(eventId = null, force = false) {
  try {
    console.log('Starting hover-preview backfill...');
    console.log(`Storage path: ${STORAGE_PATH}`);

    await fs.mkdir(THUMBNAILS_DIR, { recursive: true });

    let query = db('photos')
      .join('events', 'photos.event_id', 'events.id')
      .where(function () {
        this.where('photos.media_type', 'video')
          .orWhere('photos.mime_type', 'like', 'video/%');
      })
      .select(
        'photos.id',
        'photos.filename',
        'photos.path',
        'photos.preview_path',
        'events.slug as event_slug'
      );

    if (eventId) {
      query = query.where('photos.event_id', eventId);
      console.log(`Filtering for event ID: ${eventId}`);
    }

    const videos = await query;
    console.log(`Found ${videos.length} video(s) to consider`);

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const video of videos) {
      const videoPath = path.join(STORAGE_PATH, 'events/active', video.path);
      const previewFilename = `preview_${video.filename.replace(/\.[^.]+$/, '.mp4')}`;
      const previewPath = path.join(THUMBNAILS_DIR, previewFilename);

      if (!(await exists(videoPath))) {
        console.error(`✗ Source not found: ${videoPath}`);
        errorCount++;
        continue;
      }

      if (!force && video.preview_path && (await exists(previewPath))) {
        console.log(`Preview already exists for ${video.filename}, skipping...`);
        skipCount++;
        continue;
      }

      try {
        console.log(`Generating preview for ${video.filename}...`);
        await generateHoverPreview(videoPath, previewPath);

        await db('photos')
          .where('id', video.id)
          .update({ preview_path: `thumbnails/${previewFilename}` });

        successCount++;
        console.log(`✓ Generated preview for ${video.filename}`);
      } catch (error) {
        console.error(`✗ Failed for ${video.filename}: ${error.message}`);
        errorCount++;
      }
    }

    console.log('\nHover-preview backfill complete!');
    console.log(`- Successfully generated: ${successCount}`);
    console.log(`- Skipped (already exist): ${skipCount}`);
    console.log(`- Errors: ${errorCount}`);
    console.log(`- Total considered: ${videos.length}`);
  } catch (error) {
    console.error('Error during preview backfill:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const eventArg = args.find((a) => !a.startsWith('--'));
backfillPreviews(eventArg ? parseInt(eventArg, 10) : null, force);
