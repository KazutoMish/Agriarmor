import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
const bucket = admin.storage.from('product-images');
const targets = [
  { id: '00000000-0000-4000-8000-000000000001', size: '250', photo: 'public/assets/redrevive-250-hd.png' },
  { id: '00000000-0000-4000-8000-000000000002', size: '500', photo: 'public/assets/redrevive-500-hd.png' },
];
const hashOf = bytes => createHash('sha256').update(bytes).digest('hex');
const before = await admin.from('products').select('id,name,image_url,price,stock').in('id', targets.map(t => t.id));
if (before.error) throw new Error(`Could not read target products (${before.error.code}).`);
assert.equal(before.data.length, targets.length);
for (const target of targets) {
  const product = before.data.find(p => p.id === target.id);
  assert.match(product.name, new RegExp(`RedRevive.*${target.size}\\s*ml`, 'i'));
  target.before = product;
  target.bytes = await readFile(target.photo);
  target.hash = hashOf(target.bytes);
  assert.equal(target.bytes.readUInt32BE(16), 1254);
  assert.equal(target.bytes.readUInt32BE(20), 1254);
}
const results = [];
for (const target of targets) {
  // productSize currently parses digits from image URLs; use an alphabetic version.
  const version = target.hash.slice(0, 12).replace(/[0-9]/g, digit => String.fromCharCode(103 + Number(digit)));
  const storagePath = `redrevive-${target.size}-hd-${version}.png`;
  const uploaded = await bucket.upload(storagePath, target.bytes, { contentType: 'image/png', cacheControl: '3600', upsert: false });
  if (uploaded.error) {
    const existing = await bucket.download(storagePath);
    if (existing.error) throw new Error(`The ${target.size}ml replacement photo could not be uploaded.`);
    assert.equal(hashOf(Buffer.from(await existing.data.arrayBuffer())), target.hash);
  }
  const imageUrl = bucket.getPublicUrl(storagePath).data.publicUrl;
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
  assert.equal(response.ok, true);
  assert.match(response.headers.get('content-type'), /image\/png/);
  assert.equal(hashOf(Buffer.from(await response.arrayBuffer())), target.hash);
  let change = admin.from('products').update({ image_url: imageUrl }).eq('id', target.id);
  change = target.before.image_url === null ? change.is('image_url', null) : change.eq('image_url', target.before.image_url);
  const updated = await change.select('id,name,image_url,price,stock').single();
  if (updated.error) throw new Error(`The ${target.size}ml photo could not be updated (${updated.error.code}).`);
  assert.equal(updated.data.image_url, imageUrl);
  assert.equal(updated.data.price, target.before.price);
  assert.equal(updated.data.stock, target.before.stock);
  const visible = await publicClient.from('products').select('id,name,image_url').eq('id', target.id).single();
  if (visible.error) throw new Error(`Public catalog read failed (${visible.error.code}).`);
  assert.equal(visible.data.image_url, imageUrl);
  results.push({ productId: target.id, size: `${target.size}ml`, name: updated.data.name, imageUrl,
    previousImageUrl: target.before.image_url, localPath: target.photo, width: 1254, height: 1254,
    exactPhotoVerified: true, publicCatalogVerified: true, priceUnchanged: true, stockUnchanged: true });
  await writeFile('.tools/small-product-photo-update-result.json', JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results));
