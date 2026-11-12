import { chromium } from './node_modules/playwright/index.mjs';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const problems = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', e => problems.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '.tools/home-desktop.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Desktop overflow');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.tools/home-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile overflow');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Track order' }).click();
  await page.getByRole('heading', { name: /How’s your/ }).waitFor();
  await page.goto(`${base}/admin`);
  await page.getByRole('heading', { name: /Welcome back/ }).waitFor();
  assert.equal(await page.locator('.admin-tabs').count(), 0, 'Admin dashboard must not appear before authentication');
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(`${base}/assets/og-card.html`);
  await page.locator('.bottle').waitFor();
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  await page.screenshot({ path: 'public/assets/og-image.png' });
  console.log('PASS real catalog fallback, desktop/mobile overflow, navigation, admin login guard, sharing image');
  await context.close();

  // All Supabase calls below are intercepted test fixtures. No live orders.
  const live = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const app = await live.newPage();
  app.on('pageerror', e => problems.push(e.message));
  const products = [
    { id:'00000000-0000-4000-8000-000000000001',name:'RedRevive Con',description:'A handy bottle for home projects.',price:39,image_url:'/assets/redrevive-250.svg',category:'Home & DIY',stock:100,is_available:true,created_at:'2026-01-01T00:00:00Z' },
    { id:'00000000-0000-4000-8000-000000000002',name:'RedRevive Con 500 ml',description:'More revival for your workshop.',price:69,image_url:'/assets/redrevive-500.svg',category:'Workshop',stock:100,is_available:true,created_at:'2026-01-01T00:00:00Z' },
  ];
  let order;
  let proofAttached = false;
  let receivedPayload;
  let interruptNextOrder = false;
  let interrupted = false;
  let creationCount = 0;
  await live.route('https://*.supabase.co/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const payload = path.includes('/rpc/') ? request.postDataJSON() : {};
    let response = {};
    if (path.endsWith('/products')) response = products;
    else if (path.endsWith('/promos')) response = [];
    else if (path.endsWith('/quote_order')) {
      if (interrupted) { await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'22023',message:'There is not enough stock for RedRevive Con.'})}); return; }
      const subtotal = payload.p_items.reduce((s,i) => s + products.find(p=>p.id===i.product_id).price * i.quantity,0);
      const delivery_fee = payload.p_fulfillment_type === 'pickup' || subtotal >= 499 ? 0 : 60;
      response = {subtotal,discount:0,delivery_fee,total:subtotal+delivery_fee};
    } else if (path.endsWith('/place_order')) {
      if (order?.client_request_id === payload.p_order.client_request_id) { await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(order)}); return; }
      creationCount += 1;
      receivedPayload = payload;
      const subtotal = payload.p_items.reduce((s,i) => s + products.find(p=>p.id===i.product_id).price*i.quantity,0);
      order = { id:'11111111-1111-4111-8111-111111111111',order_number:'AA-TEST-123456789',...payload.p_order,subtotal,discount:0,delivery_fee:60,total:subtotal+60,status:'pending',created_at:new Date().toISOString(),has_payment_proof:false,order_items:payload.p_items.map(i=>({product_id:i.product_id,name_snapshot:products.find(p=>p.id===i.product_id).name,price_snapshot:39,quantity:i.quantity})) };
      response = order;
      if (interruptNextOrder) { interruptNextOrder=false; interrupted=true; await route.abort('connectionreset'); return; }
    } else if (path.endsWith('/track_order')) response = payload.p_phone.replace(/\D/g,'') === '09171234567' ? {...order,has_payment_proof:proofAttached} : null;
    else if (path.endsWith('/create_payment_proof_upload')) response = {path:'proofs/test-image'};
    else if (path.endsWith('/attach_payment_proof')) { proofAttached=true; response=true; }
    else if (path.includes('/storage/v1/object/')) response = {Key:'payment-proofs/proofs/test-image'};
    await route.fulfill({ status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:JSON.stringify(response) });
  });
  await app.goto(`${base}/products`);
  await app.getByRole('button', {name:'Add to cart'}).first().click();
  await app.goto(`${base}/cart`);
  await app.getByRole('button', {name:'Increase quantity of RedRevive Con',exact:true}).click();
  await app.getByRole('link', {name:'Continue to checkout'}).click();
  await app.getByRole('button', {name:'Place my order'}).waitFor({state:'visible'});
  await app.getByRole('button', {name:'Place my order'}).click();
  await app.getByText('Enter your full name.',{exact:true}).waitFor();
  await app.locator('[name="customer_name"]').fill('Maria Santos');
  await app.locator('[name="phone"]').fill('09171234567');
  await app.getByRole('button', {name:/I’ll pick it up/}).click();
  assert.equal(await app.locator('[name="address"]').count(),0,'Pickup does not request an address');
  assert.equal(await app.getByRole('button',{name:'Pay on pickup',exact:true}).getAttribute('aria-pressed'),'true');
  await app.getByRole('button', {name:/Deliver to me/}).click();
  await app.locator('[name="address"]').fill('123 Sampaguita Street, San Jose del Monte, Bulacan');
  await app.getByRole('button',{name:'GCash',exact:true}).click();
  await app.locator('[name="payment_reference"]').fill('TEST-REFERENCE-ONLY');
  await app.locator('input[type=file]').setInputFiles({name:'proof.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPSIAAAAASUVORK5CYII=','base64')});
  await app.getByRole('button',{name:'Place my order'}).click();
  await app.getByRole('heading',{name:/A fresh start, ordered/}).waitFor();
  assert.equal(receivedPayload.p_order.payment_method,'gcash');
  assert.equal(receivedPayload.p_items[0].quantity,2);
  assert.equal(proofAttached,true);
  assert.equal(await app.locator('.cart-count').innerText(),'0');
  await app.getByRole('link',{name:'Track my order',exact:true}).click();
  await app.getByRole('button',{name:'Find my order'}).click();
  await app.getByText('AA-TEST-123456789',{exact:true}).waitFor();
  await app.locator('[name="phone"]').fill('09179999999');
  await app.getByRole('button',{name:'Find my order'}).click();
  await app.getByText(/couldn’t find that combination/).waitFor();
  console.log('PASS intercepted catalog/cart/quantity/checkout validation/pickup/payment/proof/confirmation/tracking flow; zero live order writes');
  // Reserve the last unit, drop the response, then reload. A failed fresh quote
  // must not prevent replaying the original idempotent checkout request.
  await app.goto(`${base}/products`);
  await app.getByRole('button',{name:'Add to cart'}).first().click();
  await app.goto(`${base}/checkout`);
  await app.locator('[name="customer_name"]').fill('Maria Santos');
  await app.locator('[name="phone"]').fill('09171234567');
  await app.locator('[name="address"]').fill('123 Sampaguita Street, San Jose del Monte, Bulacan');
  interruptNextOrder=true;
  await app.getByRole('button',{name:'Place my order'}).click();
  await app.getByRole('button',{name:'Retry previous order'}).waitFor();
  await app.reload();
  await app.getByText('There is not enough stock for RedRevive Con.',{exact:true}).waitFor();
  await app.getByRole('button',{name:'Retry previous order'}).click();
  await app.getByRole('heading',{name:/A fresh start, ordered/}).waitFor();
  assert.equal(creationCount,2,'Interrupted request retry must not create a third order');
  console.log('PASS interrupted checkout recovers after reload despite a failed stock quote, without duplicate order creation');
  assert.deepEqual(problems,[],'Browser runtime exceptions');
  console.log('PASS no browser runtime exceptions');
  await live.close();
} finally { await browser.close(); }
