const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

/**
 * A stored (uncompressed) ZIP whose every byte is known before it is sent, so any
 * byte range of it can be served on its own. That is what lets a phone's browser
 * resume a dropped download where it stopped instead of starting the archive over.
 *
 * archiver cannot do this: it only writes from the first byte onwards. Here the
 * archive is a fixed list of segments (headers, file contents, descriptors, the
 * central directory) and a range is just a walk over that list.
 *
 * Layout per entry, with general purpose flag bit 3 so the CRC can follow the data:
 *   local header 30 + name, the data, data descriptor 16
 * then central headers 46 + name each, then the end of central directory 22.
 * No ZIP64: callers keep every archive below 4GB (see splitIntoParts).
 */

const FLAGS = 0x0808; // bit 3: sizes and CRC in the data descriptor; bit 11: UTF-8 names
const VERSION = 20;
const ZIP32_LIMIT = 0xFFFFFFFF;
const MAX_ENTRIES = 0xFFFF;

// Archives are split well below the 4GB ZIP32 ceiling
const PART_TARGET_BYTES = 1024 * 1024 * 1024;
const PART_MAX_BYTES = 3.5 * 1024 * 1024 * 1024;

// CRCs survive between requests, so a resumed download does not re-read the files
// before its resume point just to rebuild the central directory
const crcCache = new Map();
const CRC_CACHE_LIMIT = 50000;

const crcKey = (entry) => `${entry.filePath}:${entry.size}:${entry.mtimeMs}`;

const rememberCrc = (entry, crc) => {
  if (crcCache.size >= CRC_CACHE_LIMIT) {
    crcCache.delete(crcCache.keys().next().value);
  }
  crcCache.set(crcKey(entry), crc);
};

async function fileCrc(entry) {
  const cached = crcCache.get(crcKey(entry));
  if (cached !== undefined) return cached;
  let crc = 0;
  for await (const chunk of fs.createReadStream(entry.filePath)) {
    crc = zlib.crc32(chunk, crc);
  }
  rememberCrc(entry, crc);
  return crc;
}

function dosDateTime(ms) {
  const d = new Date(ms);
  const year = Math.max(d.getUTCFullYear(), 1980);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()
  };
}

function localHeader(entry) {
  const name = Buffer.from(entry.name, 'utf8');
  const { time, date } = dosDateTime(entry.mtimeMs);
  const buf = Buffer.alloc(30);
  buf.writeUInt32LE(0x04034b50, 0);
  buf.writeUInt16LE(VERSION, 4);
  buf.writeUInt16LE(FLAGS, 6);
  buf.writeUInt16LE(0, 8); // stored
  buf.writeUInt16LE(time, 10);
  buf.writeUInt16LE(date, 12);
  // CRC and sizes stay zero here; the data descriptor carries them
  buf.writeUInt16LE(name.length, 26);
  buf.writeUInt16LE(0, 28);
  return Buffer.concat([buf, name]);
}

function dataDescriptor(entry, crc) {
  const buf = Buffer.alloc(16);
  buf.writeUInt32LE(0x08074b50, 0);
  buf.writeUInt32LE(crc >>> 0, 4);
  buf.writeUInt32LE(entry.size, 8);
  buf.writeUInt32LE(entry.size, 12);
  return buf;
}

function centralHeader(entry, crc, offset) {
  const name = Buffer.from(entry.name, 'utf8');
  const { time, date } = dosDateTime(entry.mtimeMs);
  const buf = Buffer.alloc(46);
  buf.writeUInt32LE(0x02014b50, 0);
  buf.writeUInt16LE((3 << 8) | VERSION, 4); // made by: Unix, so the permissions below apply
  buf.writeUInt16LE(VERSION, 6);
  buf.writeUInt16LE(FLAGS, 8);
  buf.writeUInt16LE(0, 10);
  buf.writeUInt16LE(time, 12);
  buf.writeUInt16LE(date, 14);
  buf.writeUInt32LE(crc >>> 0, 16);
  buf.writeUInt32LE(entry.size, 20);
  buf.writeUInt32LE(entry.size, 24);
  buf.writeUInt16LE(name.length, 28);
  buf.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  buf.writeUInt32LE(offset, 42);
  return Buffer.concat([buf, name]);
}

function endOfCentralDirectory(count, centralSize, centralOffset) {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(0x06054b50, 0);
  buf.writeUInt16LE(count, 8);
  buf.writeUInt16LE(count, 10);
  buf.writeUInt32LE(centralSize, 12);
  buf.writeUInt32LE(centralOffset, 16);
  return buf;
}

/**
 * Lay out the archive for entries that carry { filePath, name, size, mtimeMs }.
 * Returns null when it would not fit in a plain ZIP32 archive.
 */
function buildLayout(entries) {
  if (entries.length > MAX_ENTRIES) return null;

  const segments = [];
  const offsets = [];
  let offset = 0;

  entries.forEach((entry) => {
    offsets.push(offset);
    const header = localHeader(entry);
    segments.push({ start: offset, length: header.length, bytes: () => header });
    offset += header.length;
    segments.push({ start: offset, length: entry.size, file: entry });
    offset += entry.size;
    segments.push({ start: offset, length: 16, bytes: async () => dataDescriptor(entry, await fileCrc(entry)) });
    offset += 16;
  });

  const centralOffset = offset;
  let centralSize = 0;
  entries.forEach((entry) => { centralSize += 46 + Buffer.byteLength(entry.name, 'utf8'); });

  segments.push({
    start: centralOffset,
    length: centralSize + 22,
    bytes: async () => {
      const headers = [];
      for (let i = 0; i < entries.length; i += 1) {
        headers.push(centralHeader(entries[i], await fileCrc(entries[i]), offsets[i]));
      }
      return Buffer.concat([...headers, endOfCentralDirectory(entries.length, centralSize, centralOffset)]);
    }
  });

  const size = centralOffset + centralSize + 22;
  if (size > ZIP32_LIMIT) return null;

  // Changes whenever a file is added, removed, renamed or replaced, so a resume
  // against a gallery that changed in between gets the whole new archive instead
  const etag = '"' + crypto.createHash('sha1')
    .update(JSON.stringify(entries.map((e) => [e.name, e.size, e.mtimeMs])))
    .digest('hex') + '"';

  return { segments, size, etag };
}

/**
 * Write bytes [start, end] (inclusive) of the archive to a writable stream.
 * Stops quietly when the client goes away (isAborted returns true).
 */
async function writeRange(layout, start, end, out, isAborted = () => false) {
  const write = (chunk) => new Promise((resolve) => {
    if (out.write(chunk)) resolve();
    else out.once('drain', resolve);
  });

  for (const segment of layout.segments) {
    const segEnd = segment.start + segment.length - 1;
    if (segment.length === 0 || segEnd < start) continue;
    if (segment.start > end) break;
    if (isAborted()) return;

    const from = Math.max(start, segment.start) - segment.start;
    const to = Math.min(end, segEnd) - segment.start;

    if (segment.file) {
      // Whole file read from its first byte: its CRC comes for free on the way
      const wholeFile = from === 0 && to === segment.length - 1;
      let crc = 0;
      const stream = fs.createReadStream(segment.file.filePath, { start: from, end: to });
      try {
        for await (const chunk of stream) {
          if (isAborted()) return;
          if (wholeFile) crc = zlib.crc32(chunk, crc);
          await write(chunk);
        }
      } finally {
        stream.destroy();
      }
      if (wholeFile) rememberCrc(segment.file, crc);
    } else {
      const bytes = await segment.bytes();
      await write(from === 0 && to === bytes.length - 1 ? bytes : bytes.subarray(from, to + 1));
    }
  }
}

/**
 * Parse a Range header against a known size. Only a single range is supported,
 * which is all a download manager ever sends.
 * Returns { start, end }, null for "send everything", or 'unsatisfiable'.
 */
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;

  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/**
 * Split sized entries, in order, into parts of about PART_TARGET_BYTES each.
 * Returns null when a single file is too big for a ZIP32 part.
 */
function splitIntoParts(entries) {
  const parts = [];
  let current = [];
  let currentBytes = 0;

  for (const entry of entries) {
    if (entry.size > PART_MAX_BYTES) return null;
    if (current.length > 0 && (currentBytes + entry.size > PART_TARGET_BYTES || current.length >= MAX_ENTRIES - 1)) {
      parts.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += entry.size;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/**
 * Stat each file for its size and modification time, dropping missing files so
 * the layout and the bytes sent always describe the same files.
 */
async function withFileStats(entries) {
  const sized = [];
  for (const entry of entries) {
    try {
      const stat = await fs.promises.stat(entry.filePath);
      if (stat.isFile()) sized.push({ ...entry, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
    } catch (_) {
      // Missing on disk: leave it out
    }
  }
  return sized;
}

/**
 * Send an archive as a download, answering Range / If-Range so it can be resumed.
 */
async function sendResumableZip(req, res, layout, filename) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', layout.etag);
  res.setHeader('Cache-Control', 'private, no-transform');

  // A resume against a changed archive must start over, never splice two versions
  const ifRange = req.headers['if-range'];
  const range = ifRange && ifRange !== layout.etag ? null : parseRange(req.headers.range, layout.size);

  if (range === 'unsatisfiable') {
    res.setHeader('Content-Range', `bytes */${layout.size}`);
    res.status(416).end();
    return { complete: false };
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : layout.size - 1;
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${layout.size}`);
  }
  res.setHeader('Content-Length', end - start + 1);

  if (req.method === 'HEAD') {
    res.end();
    return { complete: false };
  }

  let aborted = false;
  res.on('close', () => { if (!res.writableFinished) aborted = true; });

  await writeRange(layout, start, end, res, () => aborted);
  if (!aborted) res.end();
  return { complete: !aborted && end === layout.size - 1 };
}

module.exports = {
  buildLayout,
  writeRange,
  parseRange,
  splitIntoParts,
  withFileStats,
  sendResumableZip,
  PART_TARGET_BYTES
};
