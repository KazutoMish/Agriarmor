import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { useShop } from '../context/ShopContext';
import OrderDetails from '../components/OrderDetails';
import PaymentInstructions from '../components/PaymentInstructions';
import type { Order } from '../types';

export default function Confirmation() {
  const { state } = useLocation();
  const { number } = useParams();
  const { toast } = useShop();
  let saved: { order?: Order; phone?: string; proofWarning?: string } = state || {};
  if (!saved.order) { try { saved = JSON.parse(sessionStorage.getItem('agriarmor-confirmation') || '{}'); } catch { /* Use tracking when unavailable. */ } }
  const order = saved.order?.order_number === number ? saved.order : null;
  if (!order) return <div className="page-wrap empty-state"><h1>Let’s find your order.</h1><p>Enter your order number and phone number to see your details.</p><Link className="button" to="/track">Track your order <ArrowUpRight size={16} /></Link></div>;
  const summary = `Hello AgriArmor! My order is ${order.order_number}: ${order.order_items.map(i => `${i.name_snapshot} x${i.quantity}`).join(', ')}. Please help confirm the details.`;
  return <div className="page-wrap narrow"><div className="page-title"><span className="confirmation-check"><Check size={32} /></span><p className="eyebrow">GOOD THINGS ARE ON THEIR WAY.</p><h1>A fresh start, <em>ordered.</em></h1><p>Thank you, {order.customer_name.split(' ')[0]}. Your order is in.<br />Our team will be in touch to confirm the details.</p><button className="order-number-copy" onClick={async () => { try { await navigator.clipboard.writeText(order.order_number); toast('Order number copied. Keep it for tracking.'); } catch { toast(`Your order number: ${order.order_number}`); } }}>{order.order_number}<Copy size={15} /></button><p className="fine-print">Keep this number and use your checkout phone number to track your order.</p></div>{saved.proofWarning && <div className="info-banner" role="status">{saved.proofWarning}</div>}<OrderDetails order={order} phone={saved.phone || order.phone} /><PaymentInstructions method={order.payment_method} /><div className="confirmation-actions"><Link className="button" to="/track" state={{ number: order.order_number, phone: saved.phone }}>Track my order <ArrowUpRight size={16} /></Link><Link to="/products" className="text-link">Back to fresh possibilities <ArrowUpRight size={16} /></Link>{import.meta.env.VITE_WHATSAPP_NUMBER && <a className="text-link" href={`https://wa.me/${String(import.meta.env.VITE_WHATSAPP_NUMBER).replace(/\D/g,'')}?text=${encodeURIComponent(summary)}`} target="_blank" rel="noreferrer">Message us about this order <ArrowUpRight size={16} /></a>}</div></div>;
}
