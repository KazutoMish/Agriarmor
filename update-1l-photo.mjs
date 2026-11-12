import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const targetId = '00000000-0000-4000-8000-000000000003';
const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !secret || !publishable) throw new Error('Server connection settings are missing.');
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) },
};
const admin = createClient(url, secret, options);
const publicClient = createClient(url, publishable, options);
const bytes = await readFile('public/assets/redrevive-1000.png');
const hash = createHash('sha256').update(bytes).digest('hex');
// The catalog currently infers sizes from digits in the image URL. Keep the
// content version alphabetic so it cannot accidentally match 250 or 500.
const version = hash.slice(0, 12).replace(/[0-9]/g, digit => String.fromCharCode(103 + Number(digit)));
const storagePath = `redrevive-1000-${version}.png`;
const bucket = admin.storage.from('product-images');
const before = await admin.from('products').select('id,name,image_url,price,stock').eq('id', targetId).single();
if (before.error) throw new Error(`Could not read the 1 L product (${before.error.code}).`);
if (!/\b1\s*l\b|RedRevive Pro/i.test(before.data.name)) throw new Error('Target product does not match the 1 L listing.');

const uploaded = await bucket.upload(storagePath, bytes, { contentType: 'image/png', cacheControl: '3600', upsert: false });
if (uploaded.error) {
  const existing = await bucket.download(storagePath);
  if (existing.error) throw new Error('The replacement photo could not be uploaded.');
  const existingHash = createHash('sha256').update(Buffer.from(await existing.data.arrayBuffer())).digest('hex');
  if (existingHash !== hash) throw new Error('Existing storage image does not match the replacement.');
}
const imageUrl = bucket.getPublicUrl(storagePath).data.publicUrl;
let change = admin.from('products').update({ image_url: imageUrl }).eq('id', targetId);
change = before.data.image_url === null ? change.is('image_url', null) : change.eq('image_url', before.data.image_url);
const updated = await change.select('id,name,image_url,price,stock').single();
if (updated.error) throw new Error(`The 1 L photo could not be updated (${updated.error.code}).`);
if (updated.data.id !== targetId || updated.data.image_url !== imageUrl) throw new Error('Updated product verification failed.');

const visible = await publicClient.from('products').select('id,name,image_url').eq('id', targetId).single();
if (visible.error || visible.data.image_url !== imageUrl) throw new Error('The public catalog is not showing the new photo.');
const response = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) throw new Error('The public photo is not accessible.');
const publicHash = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
if (publicHash !== hash) throw new Error('The public photo does not match the supplied image.');
const result = {
  productId: targetId,
  name: updated.data.name,
  imageUrl,
  previousImageUrl: before.data.image_url,
  exactPhotoVerified: true,
  publicCatalogVerified: true,
  priceUnchanged: updated.data.price === before.data.price,
  stockUnchanged: updated.data.stock === before.data.stock,
};
await writeFile('.tools/1l-photo-update-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
