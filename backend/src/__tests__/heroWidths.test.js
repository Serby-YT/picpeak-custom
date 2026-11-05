const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-widths-'));
process.env.STORAGE_PATH = storage;

const { ensureHeroAtWidth, HERO_WIDTHS } = require('../services/imageProcessor');

const heroRel = 'heroes/hero_test.jpg';

beforeAll(async () => {
  fs.mkdirSync(path.join(storage, 'heroes'), { recursive: true });
  await sharp({ create: { width: 3840, height: 2160, channels: 3, background: '#808080' } })
    .jpeg()
    .toFile(path.join(storage, heroRel));
});

afterAll(() => fs.rmSync(storage, { recursive: true, force: true }));

test('only the closed set of widths is built', async () => {
  expect(HERO_WIDTHS).toEqual([1280, 1920, 2560]);
  expect(await ensureHeroAtWidth(heroRel, '1000')).toBeNull();
  expect(await ensureHeroAtWidth(heroRel, '99999')).toBeNull();
  expect(await ensureHeroAtWidth(heroRel, 'abc')).toBeNull();
  expect(fs.existsSync(path.join(storage, 'heroes', 'w1000'))).toBe(false);
});

test('builds a copy at the requested width and reuses it', async () => {
  const rel = await ensureHeroAtWidth(heroRel, '1280');
  expect(rel).toBe(path.join('heroes', 'w1280', 'hero_test.jpg'));
  const meta = await sharp(path.join(storage, rel)).metadata();
  expect(meta.width).toBe(1280);
  expect(meta.height).toBe(720);

  const firstMtime = fs.statSync(path.join(storage, rel)).mtimeMs;
  await ensureHeroAtWidth(heroRel, '1280');
  expect(fs.statSync(path.join(storage, rel)).mtimeMs).toBe(firstMtime);
});

test('rebuilds when the full hero is newer', async () => {
  const rel = await ensureHeroAtWidth(heroRel, '1920');
  const tier = path.join(storage, rel);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(tier, old, old);
  await ensureHeroAtWidth(heroRel, '1920');
  expect(fs.statSync(tier).mtimeMs).toBeGreaterThan(old.getTime());
});

test('missing source returns null', async () => {
  expect(await ensureHeroAtWidth('heroes/nope.jpg', '1280')).toBeNull();
});
