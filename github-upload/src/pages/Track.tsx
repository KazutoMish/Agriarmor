import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowRight, LoaderCircle, PackageSearch } from 'lucide-react';
import { trackingSchema } from '../lib/validation';
import { trackOrder } from '../lib/api';
import { errorMessage } from '../lib/utils';
import OrderDetails from '../components/OrderDetails';
import type { Order } from '../types';

export default function Track() {
  const { state } = useLocation();
  const [order, setOrder] = useState<Order | null>(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = trackingSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true); setError(''); setOrder(null);
    try { const result = await trackOrder(parsed.data.order_number, parsed.data.phone); if (!result) setError('We couldn’t find that combination. Check your order number and the phone number used at checkout.'); else { setOrder(result); setPhone(parsed.data.phone); } } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <div className="page-wrap narrow"><div className="page-title"><PackageSearch className="page-icon" size={39} strokeWidth={1.3} /><p className="eyebrow">FROM OUR HANDS TO YOURS.</p><h1>How’s your <em>fresh start?</em></h1><p>Find your order with just two little details. No account needed.</p></div><form className="panel tracking-form" onSubmit={submit}><div className="form-grid"><label className="field">Order number<input name="order_number" defaultValue={state?.number || ''} placeholder="Your RedRevive order number" maxLength={60} minLength={6} autoComplete="off" required /></label><label className="field">Checkout mobile number<input name="phone" type="tel" defaultValue={state?.phone || ''} placeholder="0917 123 4567" maxLength={24} autoComplete="tel" required /></label></div><button className="button full" disabled={busy}>{busy ? <><LoaderCircle size={17} className="spin" /> Finding your order…</> : <>Find my order <ArrowRight size={17} /></>}</button>{error && <p className="error-banner" role="alert">{error}</p>}<p className="fine-print">Only the matching order is returned. Your other orders stay private.</p></form>{order && <OrderDetails order={order} phone={phone} />}<p className="tracking-help">Need a hand? <a href="mailto:info.agriarmor@gmail.com">info.agriarmor@gmail.com <ArrowRight size={13} /></a></p></div>;
}
