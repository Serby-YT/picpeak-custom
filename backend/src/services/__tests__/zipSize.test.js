const fs = require('fs');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');
const archiver = require('archiver');

const { predictZipSize, withFileSizes } = require('../zipSize');

// Build the archive exactly the way the download routes do and count the bytes
const actualZipSize = async (entries) => {
  let bytes = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback();
    }
  });
  const finished = new Promise((resolve) => sink.on('finish', resolve));
  const archive = archiver('zip', { zlib: { level: 0 } });
  archive.pipe(sink);
  for (const entry of entries) archive.file(entry.filePath, { name: entry.name });
  await archive.finalize();
  await finished;
  return bytes;
};

describe('predictZipSize', () => {
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipsize-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const makeFile = (name, size) => {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, Buffer.alloc(size, 7));
    return filePath;
  };

  it('matches archiver byte for byte on ordinary photos', async () => {
    const entries = await withFileSizes([
      { filePath: makeFile('a.jpg', 1234), name: 'a.jpg' },
      { filePath: makeFile('b.jpg', 98765), name: 'b.jpg' },
      { filePath: makeFile('c.mp4', 0), name: 'c.mp4' }
    ]);
    expect(predictZipSize(entries)).toBe(await actualZipSize(entries));
  });

  it('counts UTF-8 names in bytes and folder prefixes', async () => {
    const entries = await withFileSizes([
      { filePath: makeFile('d.jpg', 500), name: 'Individual Photos/Nuntă Ștefan ăîâșț.jpg' },
      { filePath: makeFile('e.jpg', 700), name: path.join('Collages', 'e.jpg') }
    ]);
    expect(predictZipSize(entries)).toBe(await actualZipSize(entries));
  });

  it('matches for an empty archive', async () => {
    expect(predictZipSize([])).toBe(await actualZipSize([]));
  });

  it('matches for many entries', async () => {
    const entries = await withFileSizes(
      Array.from({ length: 300 }, (_, i) => ({
        filePath: makeFile(`many-${i}.jpg`, (i * 37) % 2048),
        name: `photo-${i}.jpg`
      }))
    );
    expect(predictZipSize(entries)).toBe(await actualZipSize(entries));
  });

  it('adds ZIP64 records once the archive passes 4GB (formula verified on real 4.2GB and 7.9GB galleries)', () => {
    const GB = 1024 ** 3;
    const entries = [
      { name: 'one.jpg', size: 3 * GB },
      { name: 'two.jpg', size: 2 * GB }
    ];
    const local = (30 + 7 + 3 * GB + 16) + (30 + 7 + 2 * GB + 16);
    // two.jpg starts below 4GB, so neither central entry needs the 28-byte extra field
    const central = (46 + 7) * 2;
    expect(predictZipSize(entries)).toBe(local + central + 22 + 76);

    const three = [...entries, { name: 'three.jpg', size: 10 }];
    const localThree = local + 30 + 9 + 10 + 16;
    // three.jpg starts past 4GB → 28-byte ZIP64 extra in its central entry
    const centralThree = central + 46 + 9 + 28;
    expect(predictZipSize(three)).toBe(localThree + centralThree + 22 + 76);
  });

  it('gives up (null) on a single file over 4GB', () => {
    expect(predictZipSize([{ name: 'huge.mov', size: 0xFFFFFFFF + 1 }])).toBeNull();
  });

  it('withFileSizes drops files that are missing on disk', async () => {
    const entries = await withFileSizes([
      { filePath: makeFile('present.jpg', 10), name: 'present.jpg' },
      { filePath: path.join(dir, 'missing.jpg'), name: 'missing.jpg' }
    ]);
    expect(entries.map((e) => e.name)).toEqual(['present.jpg']);
    expect(entries[0].size).toBe(10);
  });
});
