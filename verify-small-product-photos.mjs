import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from './browser-check/node_modules/playwright/index.mjs';

const photos = JSON.parse(await readFile('.tools/small-product-photo-update-result.json', 'utf8'));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const results = [];
let orderAttempts = 0;
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    await context.route('**/rest/v1/rpc/place_order', route => { orderAttempts++; return route.abort(); });
    await context.addInitScript(ids => localStorage.setItem('agriarmor-cart', JSON.stringify(ids.map(product_id => ({ product_id, quantity: 1 })))), photos.map(p => p.productId));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [path, selector] of [
      ['/products', '.product-card img'],
      ['/cart', '.cart-product-image img'],
      ['/checkout', '.summary-products img'],
    ]) {
      const catalogResponse = page.waitForResponse(response => response.url().includes('/rest/v1/products?') && response.request().method() === 'GET');
      await page.goto(`http://127.0.0.1:5173${path}`, { waitUntil: 'domcontentloaded' });
      assert.equal((await catalogResponse).status(), 200);
      for (const target of photos) {
        const image = page.locator(`${selector}[src="${target.imageUrl}"]`).first();
        await image.waitFor({ state: 'visible' });
        await image.scrollIntoViewIfNeeded();
        const dimensions = await image.evaluate(async img => {
          await img.decode();
          const rect = img.getBoundingClientRect();
          const parent = img.parentElement.getBoundingClientRect();
          return {
            naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
            objectFit: getComputedStyle(img).objectFit,
            imageInsideContainer: rect.left >= parent.left - 1 && rect.right <= parent.right + 1 && rect.top >= parent.top - 1 && rect.bottom <= parent.bottom + 1,
            noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
          };
        });
        assert.equal(dimensions.naturalWidth, 1254);
        assert.equal(dimensions.naturalHeight, 1254);
        assert.equal(dimensions.objectFit, 'contain');
        assert.equal(dimensions.imageInsideContainer, true);
        assert.equal(dimensions.noHorizontalOverflow, true);
        if (path === '/products') {
          const card = image.locator('xpath=ancestor::article');
          const size = await card.locator('.product-size').textContent();
          assert.match(size, new RegExp(target.size.replace('ml', '\\s*ml')));
          await card.screenshot({ path: `.tools/product-${target.size}-hd-${width}.png` });
        }
        results.push({ width, path, size: target.size, ...dimensions });
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Verify locally packaged photos also load if the live catalog is unavailable.
  const fallback = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await fallback.route('**/rest/v1/products?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  const page = await fallback.newPage();
  await page.goto('http://127.0.0.1:5173/products');
  for (const photo of photos) {
    const image = page.locator(`.product-card img[src="/assets/redrevive-${photo.size.replace('ml', '')}-hd.png"]`);
    await image.waitFor({ state: 'visible' });
    await image.evaluate(img => img.decode());
    assert.equal(await image.evaluate(img => img.naturalWidth), 1254);
  }
  await fallback.close();
  assert.equal(orderAttempts, 0);
  await writeFile('.tools/small-product-photo-verification.json', JSON.stringify({ results, localFallbackVerified: true, orderAttempts }, null, 2));
  console.log(JSON.stringify({ results, localFallbackVerified: true, orderAttempts }));
} finally {
  await browser.close();
}
