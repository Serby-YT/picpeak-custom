/**
 * One-off backfill: build the common phone and laptop sizes (thumbnails at
 * 400/800px, viewer copies at 1080/1600px) for photos uploaded before uploads
 * started doing it themselves. Newest galleries first, one photo at a time, so
 * it never competes with real visitors for more than one core.
 *
 * Safe to stop and rerun: sizes that already exist are skipped.
 *
 * Usage (inside the backend container):
 *   node prebuild-screen-sizes.js                 # active galleries
 *   node prebuild-screen-sizes.js --include-archived
 *   node prebuild-screen-sizes.js --event <slug>  # one gallery
 */

require('dotenv').config();
const { db } = require('./src/database/db');
const { prebuildScreenSizes } = require('./src/services/imageProcessor');

const INCLUDE_ARCHIVED = process.argv.includes('--include-archived');
const EVENT_ARG = process.argv.indexOf('--event');
const ONLY_SLUG = EVENT_ARG > -1 ? process.argv[EVENT_ARG + 1] : null;

async function main() {
  let query = db('events').select('id', 'slug').orderBy('id', 'desc');
  if (!INCLUDE_ARCHIVED) query = query.where('is_archived', false);
  if (ONLY_SLUG) query = query.where('slug', ONLY_SLUG);
  const events = await query;

  let done = 0;
  let failed = 0;
  const started = Date.now();

  for (const event of events) {
    // Every column resolvePhotoFilePath needs, as in backfill-capture-dates.js.
    const photos = await db('photos')
      .where('event_id', event.id)
      .andWhere((b) => b.whereNull('media_type').orWhereNot('media_type', 'video'))
      .select('id', 'event_id', 'filename', 'path', 'source_origin', 'external_relpath', 'mime_type');

    for (const photo of photos) {
      if (photo.mime_type && photo.mime_type.startsWith('video/')) continue;
      try {
        await prebuildScreenSizes(photo);
        done++;
      } catch (error) {
        failed++;
        console.error(`photo ${photo.id}: ${error.message}`);
      }
    }
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`${event.slug}: ${photos.length} photos (total ${done} done, ${failed} failed, ${mins} min)`);
  }

  console.log(`Finished: ${done} photos, ${failed} failed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
