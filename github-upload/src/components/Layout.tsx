import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, Leaf, Menu, ShoppingBag, Truck, X, Instagram, Facebook, Mail } from 'lucide-react';
import Brand from './Brand';
import { useShop } from '../context/ShopContext';

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { count, promos, ready, loading } = useShop();
  const { pathname, hash } = useLocation();
  const closeNavigation = () => setOpen(false);
  useEffect(() => { setOpen(false); if (hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 50); else window.scrollTo(0, 0); }, [pathname, hash]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="announcement"><span><Leaf size={13} /> {promos.find(p => p.banner_text)?.banner_text || 'A fresh start for your metal. A better future for our harvest.'}</span><Link to="/products">Discover RedRevive <ArrowRight size={13} /></Link></div>
    <header className="site-header"><div className="header-inner"><Brand /><nav className={open ? 'navigation open' : 'navigation'} aria-label="Main navigation"><NavLink onClick={closeNavigation} end to="/">Home</NavLink><NavLink onClick={closeNavigation} to="/products">Shop RedRevive</NavLink><NavLink onClick={closeNavigation} to="/our-story">Our story</NavLink><NavLink onClick={closeNavigation} to="/how-it-works">How it works</NavLink><NavLink onClick={closeNavigation} to="/track">Track order</NavLink></nav><div className="header-actions"><Link to="/cart" className="cart-link" aria-label={`Shopping cart, ${count} items`}><ShoppingBag size={20} /><span className="cart-word">Cart</span><span className="cart-count">{count}</span></Link><Link to="/products" className="button small header-order">Order Now <ArrowUpRight size={15} /></Link><button className="mobile-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button></div></div></header>
    {!loading && !ready && !['/', '/our-story', '/how-it-works'].includes(pathname) && <div className="preview-notice">Sample catalog · Live ordering is available after Supabase setup. <a href="mailto:info.agriarmor@gmail.com">Contact us <ArrowUpRight size={12} /></a></div>}
    <main id="main"><Outlet /></main>
    <section className="service-strip"><span><Truck size={21} /><span><strong>Delivered to your door</strong><small>Free delivery on orders ₱499+</small></span></span><span><ShoppingBag size={21} /><span><strong>Pay your way</strong><small>COD, GCash, bank, or pickup</small></span></span><span><Check size={21} /><span><strong>Made with purpose</strong><small>Proudly made in the Philippines</small></span></span></section>
    <footer className="site-footer"><div className="footer-top"><div className="footer-about"><Brand light /><p>Good for your metal.<br />Purpose beyond the harvest.</p><div className="social-links"><a href="https://www.facebook.com/share/1GHZ1ZWkfN/" target="_blank" rel="noreferrer" aria-label="AgriArmor on Facebook"><Facebook size={17} /></a><a href="https://www.instagram.com/agriarmor.ph?dlrf=eXNuc29mN2o5Y2x2" target="_blank" rel="noreferrer" aria-label="AgriArmor on Instagram"><Instagram size={17} /></a><a href="mailto:info.agriarmor@gmail.com" aria-label="Email AgriArmor"><Mail size={17} /></a></div></div><div><h3>A fresh start</h3><Link to="/products">Shop RedRevive</Link><NavLink onClick={closeNavigation} to="/our-story">Our story</NavLink><Link to="/how-it-works">How to use</Link></div><div><h3>We’re here to help</h3><Link to="/track">Track your order</Link><Link to="/#faq">Frequently asked questions</Link><a href="mailto:info.agriarmor@gmail.com">Get in touch <ArrowUpRight size={12} /></a></div><div className="footer-contact"><h3>Rooted in the Philippines</h3><p>Brgy. Fatima III, San Jose del Monte<br />Bulacan, Philippines</p><a href="mailto:info.agriarmor@gmail.com">info.agriarmor@gmail.com</a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} AgriArmor. All rights reserved.</span><span>Saving crops. Shielding steels. <Leaf size={12} /></span><Link to="/admin">Team login <ArrowUpRight size={12} /></Link></div></footer>
  </>;
}
