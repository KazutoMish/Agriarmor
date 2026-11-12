import { afterEach, describe, expect, it, vi } from 'vitest';
import { cartSchema, checkoutSchema, phoneSchema, proofSchema } from '../src/lib/validation';
import { deliveryFee } from '../src/lib/utils';

const checkout = {
  customer_name: 'Maria Santos',
  phone: '0917 123 4567',
  email: '',
  fulfillment_type: 'delivery' as const,
  address: '123 Sampaguita Street, Quezon City',
  scheduled_at: '',
  notes: '',
  payment_method: 'cod' as const,
  payment_reference: '',
  website: '',
};

afterEach(() => vi.useRealTimers());

describe('checkout safeguards', () => {
  it('accepts delivery with optional email and scheduling left blank', () => {
    expect(checkoutSchema.safeParse(checkout).success).toBe(true);
  });

  it('requires an address only for delivery', () => {
    expect(checkoutSchema.safeParse({ ...checkout, address: '' }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...checkout, fulfillment_type: 'pickup', payment_method: 'pay_on_pickup', address: '' }).success).toBe(true);
  });

  it('prevents payment methods that do not match fulfillment', () => {
    expect(checkoutSchema.safeParse({ ...checkout, payment_method: 'pay_on_pickup' }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...checkout, fulfillment_type: 'pickup' }).success).toBe(false);
  });

  it('rejects a filled honeypot and invalid optional email', () => {
    expect(checkoutSchema.safeParse({ ...checkout, website: 'https://spam.example' }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...checkout, email: 'not-an-email' }).success).toBe(false);
  });

  it('accepts future schedules and rejects past or malformed dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    expect(checkoutSchema.safeParse({ ...checkout, scheduled_at: '2026-11-13T10:00:00+08:00' }).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...checkout, scheduled_at: '2026-11-11T10:00:00+08:00' }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...checkout, scheduled_at: 'tomorrow' }).success).toBe(false);
  });
});

describe('phone and persisted cart inputs', () => {
  it('accepts local and international Philippine mobile numbers', () => {
    expect(phoneSchema.safeParse('0917 123 4567').success).toBe(true);
    expect(phoneSchema.safeParse('+63 917 123 4567').success).toBe(true);
    expect(phoneSchema.safeParse('1234567890').success).toBe(false);
    expect(phoneSchema.safeParse('0917<script>').success).toBe(false);
  });

  it('rejects malformed persisted cart quantities and product identifiers', () => {
    const product_id = '11111111-1111-4111-8111-111111111111';
    expect(cartSchema.safeParse([{ product_id, quantity: 1 }]).success).toBe(true);
    for (const quantity of [-1, 0, 1.5, 100, '2']) {
      expect(cartSchema.safeParse([{ product_id, quantity }]).success).toBe(false);
    }
    expect(cartSchema.safeParse([{ product_id: '../other-product', quantity: 1 }]).success).toBe(false);
    expect(cartSchema.safeParse(Array.from({ length: 31 }, () => ({ product_id, quantity: 1 }))).success).toBe(false);
  });
});

describe('payment proof restrictions', () => {
  it('accepts a small supported image and rejects unsupported or oversized uploads', () => {
    expect(proofSchema.safeParse(new File(['image'], 'proof.png', { type: 'image/png' })).success).toBe(true);
    expect(proofSchema.safeParse(new File(['script'], 'proof.svg', { type: 'image/svg+xml' })).success).toBe(false);
    expect(proofSchema.safeParse(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })).success).toBe(false);
  });
});

describe('delivery fee display', () => {
  it('matches the discounted-subtotal boundary and never charges pickup', () => {
    expect(deliveryFee(498.99, 'delivery')).toBe(60);
    expect(deliveryFee(499, 'delivery')).toBe(0);
    expect(deliveryFee(1, 'pickup')).toBe(0);
  });
});
