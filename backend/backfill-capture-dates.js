/**
 * One-off backfill: populate photos.captured_at from EXIF for rows where it is
 * null (photos uploaded before capture-date extraction existed, or where it
 * previously failed).
 *
 * Usage (inside the backend container):
 *   node backfill-capture-dates.js            # dry run, reports only
 *   node backfill-capture-dates.js --apply    # actually writes to the DB
 */

require('dotenv').config();
const { db } = require('./src/database/db');
const { extractCaptureDate } = require('./src/services/imageProcessor');
const { resolvePhotoFilePath } = require('./src/services/photoResolver');

const APPLY = process.argv.includes('--apply');

async function main() {
  // Select every column resolvePhotoFilePath needs - selecting only id/filename
  // silently resolves to the wrong path.
  const photos = await db('photos')
    .whereNull('captured_at')
    .select('id', 'event_id', 'filename', 'path', 'source_origin', 'external_relpath');

  console.log(`Found ${photos.length} photo(s) with no captured_at${APPLY ? '' : ' (DRY RUN)'}`);

  // resolvePhotoFilePath needs the owning event (source_mode / external_path)
  const events = await db('events').select('id', 'source_mode', 'external_path', 'slug');
  const eventMap = new Map(events.map((e) => [e.id, e]));

  let updated = 0;
  let noExif = 0;
  let failed = 0;

  for (const photo of photos) {
    try {
      const event = eventMap.get(photo.event_id);
      if (!event) {
        console.warn(`  ! no event ${photo.event_id} for ${photo.filename}`);
        failed++;
        continue;
      }

      const filePath = resolvePhotoFilePath(event, photo);
      if (!filePath) {
        console.warn(`  ! could not resolve path for ${photo.filename}`);
        failed++;
        continue;
      }

      const capturedAt = await extractCaptureDate(filePath);
      if (!capturedAt) {
        noExif++;
        continue;
      }

      if (APPLY) {
        await db('photos').where('id', photo.id).update({ captured_at: capturedAt });
      }
      updated++;
      if (updated <= 5) {
        console.log(`  ${APPLY ? 'set' : 'would set'} ${photo.filename} -> ${capturedAt.toISOString()}`);
      }
    } catch (error) {
      console.error(`  ! ${photo.filename}: ${error.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${APPLY ? 'Updated' : 'Would update'}: ${updated}, no EXIF date: ${noExif}, failed: ${failed}`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
