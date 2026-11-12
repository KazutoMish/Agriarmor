import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Banknote, Building2, Check, ImagePlus, LoaderCircle, ShieldCheck, Smartphone, Store, Truck } from 'lucide-react';
import { useShop } from '../context/ShopContext';
import { cartSchema, checkoutSchema, proofSchema, promoCodeSchema } from '../lib/validation';
import { getQuote, placeOrder, uploadProof } from '../lib/api';
import { errorMessage, formatMoney } from '../lib/utils';
import PaymentInstructions from '../components/PaymentInstructions';
import type { Order, PaymentMethod, Quote } from '../types';

const pendingSchema = z.object({ details: z.record(z.unknown()), items: cartSchema, promo: promoCodeSchema });
type PendingRequest = z.infer<typeof pendingSchema>;
function readPending(): PendingRequest | null {
  try {
    const result = pendingSchema.safeParse(JSON.parse(sessionStorage.getItem('agriarmor-pending') || 'null'));
    if (!result.success || !z.string().uuid().safeParse(result.data.details.client_request_id).success) return null;
    const details = result.data.details;
    const valid = checkoutSchema.safeParse({ ...details, email: details.email || '', address: details.address || '', scheduled_at: '', notes: details.notes || '', payment_reference: details.payment_reference || '', website: '' });
    return valid.success ? result.data : null;
  } catch { return null; }
}

async function requestIdentity(payload: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const signature = Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2,'0')).join('');
  try { const cached = JSON.parse(sessionStorage.getItem('agriarmor-request') || 'null'); if (cached?.signature === signature && typeof cached.id === 'string') return cached.id as string; } catch { /* A new request is safe. */ }
  const id = crypto.randomUUID();
  try { sessionStorage.setItem('agriarmor-request', JSON.stringify({ signature, id })); } catch { /* Browser storage may be unavailable. */ }
  return id;
}
export default function Checkout() {
  const { cart, products, ready, clear, refresh } = useShop();
  const navigate = useNavigate();
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery');
  const [payment, setPayment] = useState<PaymentMethod>('cod');
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<File | null>(null);
  const [pending, setPending] = useState<PendingRequest | null>(readPending);
  const submitting = useRef(false);
  function clearRejectedRequest(cause: unknown) {
    // SQL/PostgREST errors confirm the transaction did not commit. Transport
    // errors retain the request so a retry cannot create a duplicate order.
    if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' && cause.code) {
      setPending(null); try { sessionStorage.removeItem('agriarmor-pending'); } catch { /* Storage is optional. */ }
    }
  }
  function finish(order: Order, phone: string, proofWarning = '', clearCurrentCart = true) {
    try {
      sessionStorage.setItem('agriarmor-confirmation', JSON.stringify({ order, phone, proofWarning }));
      sessionStorage.removeItem('agriarmor-request'); sessionStorage.removeItem('agriarmor-pending');
    } catch { /* The in-memory confirmation still works. */ }
    setPending(null); if (clearCurrentCart) clear(); void refresh();
    navigate(`/confirmation/${encodeURIComponent(order.order_number)}`, { state: { order, phone, proofWarning }, replace: true });
  }
  async function recover() {
    if (!pending || submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const order = await placeOrder(pending.details, pending.items, pending.promo, '');
      finish(order, String(pending.details.phone), '', JSON.stringify(cart) === JSON.stringify(pending.items));
    } catch (e) { clearRejectedRequest(e); setError(errorMessage(e)); } finally { submitting.current = false; setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    if (!ready || !cart.length) return;
    setQuoteLoading(true); setQuoteError(''); setQuote(null);
    getQuote(cart, fulfillment, promo).then(value => { if (active) setQuote(value); }).catch(e => { if (active) setQuoteError(errorMessage(e)); }).finally(() => { if (active) setQuoteLoading(false); });
    return () => { active = false; };
  }, [cart, fulfillment, promo, ready]);
  function chooseFulfillment(next: 'delivery' | 'pickup') { setFulfillment(next); if (next === 'pickup' && payment === 'cod') setPayment('pay_on_pickup'); if (next === 'delivery' && payment === 'pay_on_pickup') setPayment('cod'); }
  function applyPromo() {
    const result = promoCodeSchema.safeParse(promoInput);
    if (!result.success) { setQuoteError(result.error.issues[0].message); return; }
    setPromo(result.data); setQuoteError('');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting.current || !ready || !quote || quoteLoading) return;
    const form = new FormData(event.currentTarget);
    const raw = Object.fromEntries(form.entries());
    const scheduled = String(raw.scheduled_at || '');
    const parsed = checkoutSchema.safeParse({ ...raw, fulfillment_type: fulfillment, payment_method: payment, address: String(raw.address || ''), scheduled_at: scheduled ? `${scheduled}:00+08:00` : '' });
    if (!parsed.success) { const fieldErrors: Record<string,string> = {}; for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ||= issue.message; setErrors(fieldErrors); setError('Check the highlighted details, then try again.'); return; }
    if (proof) { const validProof = proofSchema.safeParse(proof); if (!validProof.success) { setErrors({ proof: validProof.error.issues[0].message }); return; } }
    setErrors({}); setError(''); setBusy(true); submitting.current = true;
    try {
      const value = parsed.data;
      const { website, ...details } = value;
      const orderInput = { ...details, email: value.email || null, address: fulfillment === 'delivery' ? value.address : null, scheduled_at: value.scheduled_at ? new Date(value.scheduled_at).toISOString() : null, payment_reference: value.payment_reference || null, notes: value.notes || null };
      const client_request_id = await requestIdentity({ orderInput, cart, promo });
      const request = { details: { ...orderInput, client_request_id }, items: cart, promo };
      try { sessionStorage.setItem('agriarmor-pending', JSON.stringify(request)); } catch { /* In-memory retry still works. */ }
      setPending(request);
      const order = await placeOrder(request.details, cart, promo, website);
      let proofWarning = '';
      if (proof && (payment === 'gcash' || payment === 'bank_transfer')) { try { await uploadProof(order, value.phone, proof); order.has_payment_proof = true; } catch { proofWarning = 'Your order is saved, but the receipt upload did not finish. You can upload it again below or from order tracking.'; } }
      finish(order, value.phone, proofWarning);
    } catch (e) { clearRejectedRequest(e); setError(errorMessage(e)); void refresh(); } finally { setBusy(false); submitting.current = false; }
  }
  const fieldError = (name: string) => errors[name] ? <span className="error-text" role="alert">{errors[name]}</span> : null;
  if (!cart.length && !pending) return <div className="page-wrap empty-state"><h1>First, find your fresh start.</h1><p>Add a RedRevive to your cart before checking out.</p><Link className="button" to="/products">Shop RedRevive <ArrowUpRight size={17} /></Link></div>;
  return <div className="page-wrap"><Link to="/cart" className="text-link back-link"><ArrowLeft size={15} /> Back to your cart</Link><div className="page-title left"><p className="eyebrow">JUST A FEW DETAILS. THEN WE’LL TAKE IT FROM HERE.</p><h1>Let’s make it <em>a fresh start.</em></h1><p>Place your order online. Pay offline, whichever way works for you.</p></div><>{pending && <div className="info-banner" role="status"><p>A previous submission was interrupted. Retry it safely to recover or finish that order before placing another.</p><button type="button" className="button small" disabled={busy} onClick={() => void recover()}>{busy ? 'Checking your order…' : 'Retry previous order'}</button><p className="fine-print">Your previous details are kept only in this browser tab until the order is confirmed.</p>{error && <p className="error-text">{error}</p>}</div>}<form className="checkout-layout" onSubmit={submit} noValidate><div className="checkout-form">
    <section className="panel form-section"><h2><span className="form-step">01</span> A little about you</h2><div className="form-grid"><label className="field span-2">Full name <span className="required">*</span><input name="customer_name" autoComplete="name" placeholder="Juan dela Cruz" maxLength={120} required aria-invalid={!!errors.customer_name} />{fieldError('customer_name')}</label><label className="field">Mobile number <span className="required">*</span><input name="phone" type="tel" autoComplete="tel" placeholder="0917 123 4567" maxLength={24} required aria-invalid={!!errors.phone} />{fieldError('phone')}</label><label className="field">Email <span className="optional">(optional)</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} aria-invalid={!!errors.email} />{fieldError('email')}</label></div><p className="fine-print">We’ll use these details to confirm and fulfill your order.</p></section>
    <section className="panel form-section"><h2><span className="form-step">02</span> How would you like it?</h2><div className="choice-grid"><button type="button" className={`choice ${fulfillment === 'delivery' ? 'chosen' : ''}`} onClick={() => chooseFulfillment('delivery')} aria-pressed={fulfillment === 'delivery'}><Truck size={23} /><span><strong>Deliver to me</strong><small>₱60 · Free on ₱499+</small></span>{fulfillment === 'delivery' && <Check size={16} />}</button><button type="button" className={`choice ${fulfillment === 'pickup' ? 'chosen' : ''}`} onClick={() => chooseFulfillment('pickup')} aria-pressed={fulfillment === 'pickup'}><Store size={23} /><span><strong>I’ll pick it up</strong><small>San Jose del Monte · Free</small></span>{fulfillment === 'pickup' && <Check size={16} />}</button></div><div className="form-grid">{fulfillment === 'delivery' && <label className="field span-2">Complete delivery address <span className="required">*</span><textarea name="address" rows={3} autoComplete="street-address" placeholder="House / unit, street, barangay, city, province, postal code" maxLength={1000} required aria-invalid={!!errors.address} />{fieldError('address')}</label>}<label className="field span-2">Preferred date & time <span className="optional">(optional · Philippine time)</span><input name="scheduled_at" type="datetime-local" min={new Date(Date.now()+8*3600000).toISOString().slice(0,16)} aria-invalid={!!errors.scheduled_at} />{fieldError('scheduled_at')}<span className="fine-print">A preference for our team to confirm, subject to availability.</span></label><label className="field span-2">Anything else we should know? <span className="optional">(optional)</span><textarea name="notes" rows={2} maxLength={1500} placeholder="Delivery landmarks, pickup requests, or a little note…" />{fieldError('notes')}</label></div></section>
    <section className="panel form-section"><h2><span className="form-step">03</span> Pay your way</h2><div className="payment-grid">{([{value:fulfillment === 'delivery' ? 'cod' : 'pay_on_pickup',label:fulfillment === 'delivery' ? 'Cash on delivery' : 'Pay on pickup',icon:<Banknote size={20} />},{value:'gcash',label:'GCash',icon:<Smartphone size={20} />},{value:'bank_transfer',label:'Bank transfer',icon:<Building2 size={20} />}] as const).map(method => <button key={method.value} type="button" className={`payment-option ${payment === method.value ? 'chosen' : ''}`} aria-pressed={payment === method.value} onClick={() => setPayment(method.value)}>{method.icon}{method.label}<span className="radio-dot" /></button>)}</div><PaymentInstructions method={payment} />{fieldError('payment_method')}{(payment === 'gcash' || payment === 'bank_transfer') && <><label className="field">Transfer reference <span className="optional">(optional)</span><input name="payment_reference" placeholder="GCash or bank transaction reference" maxLength={120} />{fieldError('payment_reference')}</label><label className="upload-field"><ImagePlus size={23} /><strong>{proof?.name || 'Add a payment receipt (optional)'}</strong><small>JPG, PNG, or WebP · Up to 5 MB</small><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload payment receipt" onChange={e => { const file = e.target.files?.[0] || null; if (!file) { setProof(null); return; } const result = proofSchema.safeParse(file); if (result.success) { setProof(file); setErrors(current => ({ ...current, proof: '' })); } else { e.target.value=''; setProof(null); setErrors(current => ({ ...current, proof: result.error.issues[0].message })); } }} /></label>{fieldError('proof')}</>}{payment === 'cod' || payment === 'pay_on_pickup' ? <input type="hidden" name="payment_reference" value="" /> : null}</section>
    <div className="honeypot" aria-hidden="true"><label>Leave this field empty<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label></div>
    </div><aside className="order-summary panel checkout-summary"><p className="eyebrow">GOOD CHOICES, ALL TOGETHER.</p><h2>Your order</h2><div className="summary-products">{cart.map(item => { const p = products.find(v => v.id === item.product_id); return <div key={item.product_id}><img src={p?.image_url || '/assets/redrevive-250.svg'} alt="" width="45" height="55" /><span><strong>{p?.name || 'Unavailable product'}</strong><small>Qty {item.quantity}</small></span><b>{formatMoney((p?.price || 0) * item.quantity)}</b></div>; })}</div><div className="promo-form"><label className="sr-only" htmlFor="promo">Discount code</label><input id="promo" value={promoInput} onChange={e => setPromoInput(e.target.value.toUpperCase())} placeholder="Have a little promo code?" maxLength={32} /><button type="button" onClick={applyPromo} disabled={quoteLoading}>Apply</button></div>{promo && <p className="fine-print">Code: {promo} <button type="button" className="text-button" onClick={() => { setPromo(''); setPromoInput(''); }}>Remove</button></p>}{quoteError && <p className="error-text" role="alert">{quoteError}</p>}{quoteLoading && <p className="fine-print">Checking prices and availability…</p>}<div className="summary-row"><span>Subtotal</span><span>{quote ? formatMoney(quote.subtotal) : '—'}</span></div>{!!quote?.discount && <div className="summary-row discount"><span>A little saving</span><span>−{formatMoney(quote.discount)}</span></div>}<div className="summary-row"><span>{fulfillment === 'delivery' ? 'Delivery' : 'Pickup'}</span><span>{quote ? quote.delivery_fee ? formatMoney(quote.delivery_fee) : 'Free' : '—'}</span></div><div className="summary-row total"><span>Total</span><span>{quote ? formatMoney(quote.total) : '—'}</span></div><p className="fine-print">Nothing is charged online. Your order is subject to confirmation by the AgriArmor team.</p>{error && <div className="error-banner" role="alert">{error}</div>}{!ready && <div className="info-banner">Ordering is taking a little break. Please email info.agriarmor@gmail.com to arrange your order.</div>}<button className="button full" type="submit" disabled={busy || !ready || !quote || quoteLoading || !!pending}>{busy ? <><LoaderCircle size={17} className="spin" /> Placing your order…</> : <>Place my order <ArrowUpRight size={17} /></>}</button><span className="secure-note"><ShieldCheck size={14} /> Your fresh start. No online payment.</span></aside></form></></div>;
}
