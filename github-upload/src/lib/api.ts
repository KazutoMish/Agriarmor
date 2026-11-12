import { supabase } from './supabase';
import type { CartItem, Order, Quote } from '../types';

function client() { if (!supabase) throw new Error('Live ordering is not configured yet. Please contact AgriArmor.'); return supabase; }
export async function getQuote(items: CartItem[], fulfillment: string, promo: string): Promise<Quote> {
  const { data, error } = await client().rpc('quote_order', { p_items: items, p_fulfillment_type: fulfillment, p_promo_code: promo || null });
  if (error) throw error;
  return data as Quote;
}
export async function placeOrder(order: Record<string, unknown>, items: CartItem[], promo: string, honeypot: string): Promise<Order> {
  const { data, error } = await client().rpc('place_order', { p_order: order, p_items: items, p_promo_code: promo || null, p_honeypot: honeypot });
  if (error) throw error;
  return data as Order;
}
export async function trackOrder(order_number: string, phone: string): Promise<Order | null> {
  const { data, error } = await client().rpc('track_order', { p_order_number: order_number, p_phone: phone });
  if (error) throw error;
  return data as Order | null;
}
export async function uploadProof(order: Order, phone: string, file: File) {
  const db = client();
  const { data, error } = await db.rpc('create_payment_proof_upload', { p_order_number: order.order_number, p_phone: phone });
  if (error) {
    // Recover if a previous attachment committed before its response was lost.
    const tracked = await trackOrder(order.order_number, phone);
    if (tracked?.has_payment_proof) return;
    throw error;
  }
  const path = (data as { path: string }).path;
  const result = await db.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false });
  // An earlier upload may have succeeded before its response was lost.
  // Attachment checks the exact private path, order, expiry, and image metadata.
  if (result.error) {
    const retry = await db.rpc('attach_payment_proof', { p_order_number: order.order_number, p_phone: phone, p_path: path });
    if (!retry.error) return;
    throw result.error;
  }
  const attached = await db.rpc('attach_payment_proof', { p_order_number: order.order_number, p_phone: phone, p_path: path });
  if (attached.error) {
    const tracked = await trackOrder(order.order_number, phone);
    if (tracked?.has_payment_proof) return;
    throw attached.error;
  }
}
