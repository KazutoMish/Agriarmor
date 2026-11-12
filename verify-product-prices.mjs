import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from './browser-check/node_modules/playwright/index.mjs';

const products = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'RedRevive Con · 250 ml', price: '₱75' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'RedRevive Con · 500 ml', price: '₱150' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'RedRevive Pro · 1 L', price: '₱300' },
];
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
let orderAttempts = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/rest/v1/rpc/place_order', route => { orderAttempts++; return route.abort(); });
  await context.addInitScript(ids => localStorage.setItem('agriarmor-cart', JSON.stringify(ids.map(product_id => ({ product_id, quantity: 1 })))), products.map(p => p.id));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const navigate = async path => {
    const catalog = page.waitForResponse(r => r.url().includes('/rest/v1/products?') && r.request().method() === 'GET');
    await page.goto(`http://127.0.0.1:5173${path}`, { waitUntil: 'domcontentloaded' });
    assert.equal((await catalog).status(), 200);
  };
  await navigate('/products');
  for (const product of products) {
    const card = page.locator('.product-card').filter({ has: page.getByRole('heading', { name: product.name, exact: true }) });
    await card.waitFor();
    assert.equal((await card.locator('.product-title > span').textContent()).trim(), product.price);
  }
  await navigate('/cart');
  for (const product of products) {
    const item = page.locator('.cart-item').filter({ has: page.getByRole('heading', { name: product.name, exact: true }) });
    await item.waitFor();
    assert.equal((await item.locator('.cart-product-end > strong').textContent()).trim(), product.price);
  }
  assert.match(await page.locator('.summary-row.total').textContent(), /₱525/);
  const quoted = page.waitForResponse(r => r.url().includes('/rest/v1/rpc/quote_order') && r.request().method() === 'POST');
  await navigate('/checkout');
  const quoteResponse = await quoted;
  assert.equal(quoteResponse.status(), 200);
  assert.equal((await quoteResponse.json()).total, 525);
  for (const product of products) {
    const item = page.locator('.summary-products > div').filter({ has: page.getByText(product.name, { exact: true }) });
    await item.waitFor();
    assert.equal((await item.locator('b').textContent()).trim(), product.price);
  }
  await page.waitForFunction(() => document.querySelector('.summary-row.total')?.textContent.includes('₱525'));
  await navigate('/');
  assert.equal((await page.locator('.hero-starting strong').textContent()).trim(), '₱75');
  assert.equal(orderAttempts, 0);
  assert.deepEqual(errors, []);
  const result = { productCardsVerified: true, persistedCartVerified: true, checkoutTotal: 525, homepageStartingPrice: 75, orderAttempts };
  await writeFile('.tools/product-price-verification.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await context.close();
} finally {
  await browser.close();
}
