import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from './browser-check/node_modules/playwright/index.mjs';

const manifest = JSON.parse(await readFile('.tools/1l-photo-update-result.json', 'utf8'));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const results = [];
let orderAttempts = 0;
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.route('**/rest/v1/rpc/place_order', route => { orderAttempts++; return route.abort(); });
    await context.addInitScript(id => localStorage.setItem('agriarmor-cart', JSON.stringify([{ product_id: id, quantity: 1 }])), manifest.productId);
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
      const photo = page.locator(`${selector}[src="${manifest.imageUrl}"]`).first();
      await photo.waitFor({ state: 'visible' });
      await photo.scrollIntoViewIfNeeded();
      const dimensions = await photo.evaluate(async img => {
        await img.decode();
        const rect = img.getBoundingClientRect();
        const parent = img.parentElement.getBoundingClientRect();
        return {
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
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
      if (path === '/products') await photo.locator('xpath=ancestor::article').screenshot({ path: `.tools/product-1l-hd-${width}.png`, timeout: 15000 });
      results.push({ width, path, ...dimensions });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  assert.equal(orderAttempts, 0);
  await writeFile('.tools/product-1l-hd-verification.json', JSON.stringify({ imageUrl: manifest.imageUrl, results, orderAttempts }, null, 2));
  console.log(JSON.stringify({ results, orderAttempts }));
} finally {
  await browser.close();
}
