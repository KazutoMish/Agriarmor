import { chromium } from './node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://*.supabase.co/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.locator('.hero-photo img').waitFor();
  await page.locator('.hero-photo img').evaluate(image => image.decode());
  for (const width of [1440, 900, 768, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const result = await page.evaluate(() => {
      const image = document.querySelector('.hero-photo img');
      const frame = document.querySelector('.hero-photo').getBoundingClientRect();
      const rect = image.getBoundingClientRect();
      return { viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, loaded: image.complete && image.naturalWidth === 1414 && image.naturalHeight === 2000, fit: getComputedStyle(image).objectFit, frame: { width: frame.width, height: frame.height }, image: { width: rect.width, height: rect.height } };
    });
    assert.equal(result.loaded, true, 'Exact poster loaded');
    assert.equal(result.overflow, false, `Horizontal overflow at ${width}px`);
    assert.equal(result.fit, 'contain', 'Full poster remains visible');
    assert.ok(result.frame.height > 300, `Photo area collapsed at ${width}px`);
    assert.equal(result.image.width, result.frame.width);
    assert.equal(result.image.height, result.frame.height);
    if (width <= 700) assert.ok(Math.abs(result.frame.width / result.frame.height - 1414 / 2000) < 0.001, 'Mobile preserves poster ratio');
    console.log(JSON.stringify(result));
    if (width === 1440 || width === 390) await page.locator('.hero').screenshot({ path: `.tools/home-photo-${width}.png` });
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('PASS: supplied poster loads, full image is visible, desktop/mobile layout has no overflow, no runtime errors.');
} finally {
  await browser.close();
}
