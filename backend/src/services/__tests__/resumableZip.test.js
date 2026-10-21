const fs = require('fs');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');
const AdmZip = require('adm-zip');

const {
  buildLayout,
  writeRange,
  parseRange,
  splitIntoParts,
  withFileStats,
  PART_TARGET_BYTES
} = require('../resumableZip');

// Collect the bytes writeRange produces for [start, end]
const readRange = async (layout, start, end) => {
  const chunks = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  await writeRange(layout, start, end, sink);
  return Buffer.concat(chunks);
};

describe('resumableZip', () => {
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumable-zip-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const makeFile = (name, size, seed) => {
    const filePath = path.join(dir, name);
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + seed) & 0xff;
    fs.writeFileSync(filePath, bytes);
    return filePath;
  };

  const sampleEntries = () => withFileStats([
    { filePath: makeFile('a.jpg', 1234, 1), name: 'a.jpg' },
    { filePath: makeFile('b.jpg', 98765, 2), name: 'Individual Photos/Nuntă Ștefan ăîâșț.jpg' },
    { filePath: makeFile('c.mp4', 0, 3), name: 'c.mp4' },
    { filePath: makeFile('d.jpg', 300000, 4), name: 'Collages/d.jpg' }
  ]);

  it('writes a valid ZIP whose length matches the layout and whose files match the originals', async () => {
    const entries = await sampleEntries();
    const layout = buildLayout(entries);
    const zip = await readRange(layout, 0, layout.size - 1);

    expect(zip.length).toBe(layout.size);
    const read = new AdmZip(zip);
    expect(read.getEntries().map((e) => e.entryName)).toEqual(entries.map((e) => e.name));
    for (const entry of entries) {
      // getData checks the CRC as well as returning the bytes
      expect(read.getEntry(entry.name).getData().equals(fs.readFileSync(entry.filePath))).toBe(true);
    }
  });

  it('serves any byte range exactly as the same bytes of the whole archive', async () => {
    const entries = await sampleEntries();
    const full = buildLayout(entries);
    const whole = await readRange(full, 0, full.size - 1);

    // A fresh layout for every request, the way the route builds one per request
    const cuts = [0, 1, 29, 30, 1263, 1264, 1280, 50000, whole.length - 30, whole.length - 1];
    for (const start of cuts) {
      const layout = buildLayout(entries);
      const tail = await readRange(layout, start, layout.size - 1);
      expect(tail.equals(whole.subarray(start))).toBe(true);
    }
    const middle = await readRange(buildLayout(entries), 1000, 120000);
    expect(middle.equals(whole.subarray(1000, 120001))).toBe(true);
  });

  it('stitches a download interrupted several times back into the same archive', async () => {
    const entries = await sampleEntries();
    const layout = buildLayout(entries);
    const whole = await readRange(layout, 0, layout.size - 1);

    const pieces = [];
    let position = 0;
    for (const stop of [777, 40000, 250000, layout.size - 1]) {
      pieces.push(await readRange(buildLayout(entries), position, stop));
      position = stop + 1;
    }
    expect(Buffer.concat(pieces).equals(whole)).toBe(true);
  });

  it('keeps the same ETag for the same files and changes it when a file changes', async () => {
    const entries = await sampleEntries();
    expect(buildLayout(entries).etag).toBe(buildLayout(entries).etag);
    const changed = entries.map((e, i) => (i === 0 ? { ...e, size: e.size + 1 } : e));
    expect(buildLayout(changed).etag).not.toBe(buildLayout(entries).etag);
  });

  it('parses the Range headers download managers send', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-9', 100)).toBeNull();
    expect(parseRange('items=0-5', 100)).toBeNull();
  });

  it('splits a gallery into parts of about 1GB, in order, without dropping a photo', () => {
    const photo = 12 * 1024 * 1024;
    const entries = Array.from({ length: 700 }, (_, i) => ({ name: `${i}.jpg`, size: photo }));
    const parts = splitIntoParts(entries);

    const perPart = Math.floor(PART_TARGET_BYTES / photo);
    expect(parts.length).toBe(Math.ceil(700 / perPart));
    expect(parts.flat().map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (const part of parts) {
      expect(part.reduce((sum, e) => sum + e.size, 0)).toBeLessThanOrEqual(PART_TARGET_BYTES);
    }
  });

  it('gives a file bigger than the target a part of its own, and refuses one too big for ZIP32', () => {
    const big = { name: 'film.mp4', size: 2 * 1024 * 1024 * 1024 };
    const parts = splitIntoParts([{ name: 'a.jpg', size: 10 }, big, { name: 'b.jpg', size: 10 }]);
    expect(parts.map((p) => p.map((e) => e.name))).toEqual([['a.jpg'], ['film.mp4'], ['b.jpg']]);
    expect(splitIntoParts([{ name: 'huge.mov', size: 4 * 1024 * 1024 * 1024 }])).toBeNull();
  });
});
