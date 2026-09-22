const fs = require('fs');

/**
 * Exact byte size of the ZIP that archiver('zip', { zlib: { level: 0 } }) produces
 * when every entry is added with archive.file(). Knowing it up front lets the
 * download send a Content-Length, so the browser shows a percentage and time left
 * instead of an open-ended "X MB of ?".
 *
 * Layout written by compress-commons (archiver 5.x) for stored file entries:
 *   local header 30 + name, the data, data descriptor 16
 *   central header 46 + name, +28 ZIP64 extra field once the entry starts past 4GB
 *   end of central directory 22, +76 (ZIP64 EOCD 56 + locator 20) once the
 *   archive itself needs ZIP64
 *
 * Returns null when the size cannot be known exactly (a single file over 4GB gets
 * per-entry ZIP64 headers that are not modelled here) — send no Content-Length then.
 */
const ZIP64_MAGIC = 0xFFFFFFFF;
const ZIP64_MAGIC_SHORT = 0xFFFF;

function predictZipSize(entries) {
  let offset = 0;
  let centralLength = 0;

  for (const entry of entries) {
    if (entry.size > ZIP64_MAGIC) return null;
    const nameLength = Buffer.byteLength(entry.name, 'utf8');
    const entryOffset = offset;
    offset += 30 + nameLength + entry.size + 16;
    centralLength += 46 + nameLength + (entryOffset > ZIP64_MAGIC ? 28 : 0);
  }

  const needsZip64 = entries.length > ZIP64_MAGIC_SHORT
    || centralLength > ZIP64_MAGIC
    || offset > ZIP64_MAGIC;

  return offset + centralLength + 22 + (needsZip64 ? 76 : 0);
}

/**
 * Stat each file and return the entries with their sizes, dropping any file that
 * is missing so the archive and the prediction always describe the same files.
 */
async function withFileSizes(entries) {
  const sized = [];
  for (const entry of entries) {
    try {
      const stat = await fs.promises.stat(entry.filePath);
      if (stat.isFile()) sized.push({ ...entry, size: stat.size });
    } catch (_) {
      // Missing on disk: leave it out of both the ZIP and the size
    }
  }
  return sized;
}

module.exports = { predictZipSize, withFileSizes };
