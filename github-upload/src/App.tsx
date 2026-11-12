import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { ShopProvider } from './context/ShopContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import RouteMeta from './components/RouteMeta';
const Products = lazy(() => import('./pages/Products'));
const OurStory = lazy(() => import('./pages/OurStory'));
const HowItWorks = lazy(() => import('./pages/HowItWorks'));
const Cart = lazy(() => import('./pages/Cart'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Confirmation = lazy(() => import('./pages/Confirmation'));
const Track = lazy(() => import('./pages/Track'));
const Admin = lazy(() => import('./pages/Admin'));

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { if (import.meta.env.DEV) console.error(error, info.componentStack); }
  render() { return this.state.failed ? <div className="page-wrap empty-state"><h1>Let’s try a fresh start.</h1><p>Something interrupted this page. Refresh to try again, or email info.agriarmor@gmail.com.</p><button className="button" onClick={() => location.reload()}>Refresh the page</button></div> : this.props.children; }
}
export default function App() {
  return <ErrorBoundary><BrowserRouter><RouteMeta /><ShopProvider><Suspense fallback={<div className="page-wrap empty-state" role="status">Getting things ready…</div>}><Routes><Route element={<Layout />}><Route index element={<Home />} /><Route path="products" element={<Products />} /><Route path="our-story" element={<OurStory />} /><Route path="how-it-works" element={<HowItWorks />} /><Route path="cart" element={<Cart />} /><Route path="checkout" element={<Checkout />} /><Route path="confirmation/:number" element={<Confirmation />} /><Route path="track" element={<Track />} /><Route path="*" element={<div className="page-wrap empty-state"><p className="eyebrow">A LITTLE OFF THE BEATEN PATH.</p><h1>Let’s find a fresh start.</h1><Link className="button" to="/">Back to home</Link></div>} /></Route><Route path="admin/*" element={<Admin />} /></Routes></Suspense></ShopProvider></BrowserRouter></ErrorBoundary>;
}
