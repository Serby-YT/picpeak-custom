const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'display-sizes-'));
process.env.STORAGE_PATH = storage;

const { ensureDisplayAtSize, DISPLAY_SIZES } = require('../services/imageProcessor');

const displayRel = 'display/display_test.webp';

beforeAll(async () => {
  fs.mkdirSync(path.join(storage, 'display'), { recursive: true });
  // Portrait, like many event photos: the long edge is the height.
  await sharp({ create: { width: 1707, height: 2560, channels: 3, background: '#808080' } })
    .webp()
    .toFile(path.join(storage, displayRel));
});

afterAll(() => fs.rmSync(storage, { recursive: true, force: true }));

test('only the closed set of sizes is built', async () => {
  expect(DISPLAY_SIZES).toEqual([1080, 1600, 2048]);
  expect(await ensureDisplayAtSize(displayRel, '500')).toBeNull();
  expect(await ensureDisplayAtSize(displayRel, '2560')).toBeNull();
  expect(await ensureDisplayAtSize(displayRel, 'x')).toBeNull();
  expect(fs.existsSync(path.join(storage, 'display', 's500'))).toBe(false);
});

test('fits the photo inside the box, keeping its shape', async () => {
  const rel = await ensureDisplayAtSize(displayRel, '1080');
  expect(rel).toBe(path.join('display', 's1080', 'display_test.webp'));
  const meta = await sharp(path.join(storage, rel)).metadata();
  expect(meta.height).toBe(1080);
  expect(meta.width).toBe(720);
});

test('rebuilds when the display copy is newer, reuses otherwise', async () => {
  const rel = await ensureDisplayAtSize(displayRel, '1600');
  const tier = path.join(storage, rel);
  const first = fs.statSync(tier).mtimeMs;
  await ensureDisplayAtSize(displayRel, '1600');
  expect(fs.statSync(tier).mtimeMs).toBe(first);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(tier, old, old);
  await ensureDisplayAtSize(displayRel, '1600');
  expect(fs.statSync(tier).mtimeMs).toBeGreaterThan(old.getTime());
});
