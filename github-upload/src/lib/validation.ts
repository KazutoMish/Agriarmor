import { z } from 'zod';

export const phoneSchema = z.string().trim().min(10, 'Enter a valid phone number.').max(24).regex(/^\+?[\d\s()-]+$/, 'Use a valid phone number.').refine(v => { const p = v.replace(/\D/g, ''); return /^(09\d{9}|639\d{9})$/.test(p); }, 'Enter a Philippine mobile number, e.g. 0917 123 4567.');
export const checkoutSchema = z.object({
  customer_name: z.string().trim().min(2, 'Enter your full name.').max(120),
  phone: phoneSchema,
  email: z.union([z.string().trim().email('Enter a valid email address.').max(254), z.literal('')]),
  fulfillment_type: z.enum(['delivery', 'pickup']),
  address: z.string().trim().max(1000),
  scheduled_at: z.string().refine(v => !v || (!Number.isNaN(Date.parse(v)) && Date.parse(v) > Date.now() && Date.parse(v) <= Date.now() + 365 * 86400000), 'Choose a date and time within the next year.'),
  notes: z.string().trim().max(1500),
  payment_method: z.enum(['cod', 'gcash', 'bank_transfer', 'pay_on_pickup']),
  payment_reference: z.string().trim().max(120),
  website: z.string().max(0, 'Unable to submit this request.'),
}).superRefine((v, ctx) => {
  if (v.fulfillment_type === 'delivery' && v.address.length < 10) ctx.addIssue({ code: 'custom', path: ['address'], message: 'Enter your complete delivery address.' });
  if (v.fulfillment_type === 'delivery' && v.payment_method === 'pay_on_pickup') ctx.addIssue({ code: 'custom', path: ['payment_method'], message: 'Choose a delivery payment method.' });
  if (v.fulfillment_type === 'pickup' && v.payment_method === 'cod') ctx.addIssue({ code: 'custom', path: ['payment_method'], message: 'Choose pay on pickup instead.' });
  if ((v.payment_method === 'gcash' || v.payment_method === 'bank_transfer') && !v.payment_reference) ctx.addIssue({ code: 'custom', path: ['payment_reference'], message: 'Enter the GCash or bank transfer reference.' });
});
export const cartSchema = z.array(z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).max(30);
export const promoCodeSchema = z.string().trim().max(32, 'Promo codes can have up to 32 characters.').refine(value => value === '' || /^[A-Za-z0-9_-]{3,32}$/.test(value), 'Enter a valid promo code.');
export const proofSchema = z.custom<File>(v => typeof File !== 'undefined' && v instanceof File, 'Choose an image.').refine(v => v.size <= 5 * 1024 * 1024, 'Images must be 5 MB or smaller.').refine(v => ['image/jpeg', 'image/png', 'image/webp'].includes(v.type), 'Choose a JPG, PNG, or WebP image.');
export const trackingSchema = z.object({ order_number: z.string().trim().min(6).max(60), phone: phoneSchema });
