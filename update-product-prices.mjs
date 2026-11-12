import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, SUPABASE_PUBLISHABLE_KEY: publishable } = process.env;
if (!url || !secret || !publishable) throw new Error('Server connection settings are missing.');
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) },
};
const admin = createClient(url, secret, options);
const publicClient = createClient(url, publishable, options);
const targets = [
  { id: '00000000-0000-4000-8000-000000000001', size: /250\s*ml/i, price: 75 },
  { id: '00000000-0000-4000-8000-000000000002', size: /500\s*ml/i, price: 150 },
  { id: '00000000-0000-4000-8000-000000000003', size: /1\s*l\b/i, price: 300 },
];
const fields = 'id,name,price,image_url,stock';
const before = await admin.from('products').select(fields).in('id', targets.map(p => p.id));
if (before.error) throw new Error(`Could not read target products (${before.error.code}).`);
assert.equal(before.data.length, targets.length);
for (const target of targets) {
  const product = before.data.find(p => p.id === target.id);
  assert.match(product.name, /RedRevive/i);
  assert.match(product.name, target.size);
  target.before = product;
}
const results = [];
for (const target of targets) {
  const updated = await admin.from('products').update({ price: target.price })
    .eq('id', target.id).eq('price', target.before.price).select(fields).single();
  if (updated.error) throw new Error(`Could not update ${target.before.name} (${updated.error.code}).`);
  assert.equal(updated.data.price, target.price);
  assert.equal(updated.data.image_url, target.before.image_url);
  results.push({ id: target.id, name: updated.data.name, previousPrice: target.before.price, price: updated.data.price });
  await writeFile('.tools/product-price-update-result.json', JSON.stringify({ products: results }, null, 2));
}
const visible = await publicClient.from('products').select(fields).in('id', targets.map(p => p.id));
if (visible.error) throw new Error(`Could not verify public prices (${visible.error.code}).`);
assert.equal(visible.data.length, targets.length);
for (const target of targets) {
  assert.equal(visible.data.find(p => p.id === target.id).price, target.price);
  const quote = await publicClient.rpc('quote_order', {
    p_items: [{ product_id: target.id, quantity: 1 }], p_promo_code: null, p_fulfillment_type: 'pickup',
  });
  if (quote.error) throw new Error(`Could not verify ${target.before.name} checkout quote (${quote.error.code}).`);
  assert.equal(quote.data.subtotal, target.price);
  assert.equal(quote.data.total, target.price);
}
const quote = await publicClient.rpc('quote_order', {
  p_items: targets.map(p => ({ product_id: p.id, quantity: 1 })), p_promo_code: null, p_fulfillment_type: 'delivery',
});
if (quote.error) throw new Error(`Could not verify combined checkout quote (${quote.error.code}).`);
assert.equal(quote.data.subtotal, 525);
assert.equal(quote.data.delivery_fee, 0);
assert.equal(quote.data.total, 525);
const result = { products: results, publicCatalogVerified: true, individualQuotesVerified: true, combinedQuote: quote.data };
await writeFile('.tools/product-price-update-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
