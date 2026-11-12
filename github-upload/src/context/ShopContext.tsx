import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CartItem, Product, Promo } from '../types';
import { sampleProducts } from '../lib/catalog';
import { cartSchema } from '../lib/validation';
import { supabase } from '../lib/supabase';

interface ShopState {
  products: Product[]; promos: Promo[]; cart: CartItem[]; ready: boolean; loading: boolean; count: number;
  add: (id: string) => void; update: (id: string, quantity: number) => void; clear: () => void;
  toast: (message: string) => void; refresh: () => Promise<void>;
}
const ShopContext = createContext<ShopState | null>(null);
function readCart(): CartItem[] {
  try { const data = cartSchema.safeParse(JSON.parse(localStorage.getItem('agriarmor-cart') || '[]')); return data.success ? data.data : []; } catch { return []; }
}
export function ShopProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>(sampleProducts);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [cart, setCart] = useState<CartItem[]>(readCart);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const toast = useCallback((value: string) => setMessage(value), []);
  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    try {
      const [catalog, banners] = await Promise.all([
        supabase.from('products').select('*').eq('is_available', true).order('price'),
        supabase.from('promos').select('*').eq('is_active', true),
      ]);
      if (catalog.error) throw catalog.error;
      setProducts(catalog.data as Product[]);
      setReady(true);
      if (!banners.error) setPromos((banners.data as Promo[]).filter(p => (!p.starts_at || new Date(p.starts_at).getTime() <= Date.now()) && (!p.ends_at || new Date(p.ends_at).getTime() > Date.now())));
    } catch { setReady(false); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { try { localStorage.setItem('agriarmor-cart', JSON.stringify(cart)); } catch { /* The cart still works when browser storage is disabled. */ } }, [cart]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 3500); return () => clearTimeout(timer); }, [message]);
  function update(id: string, quantity: number) {
    const product = products.find(p => p.id === id);
    const next = Math.min(99, product?.stock || 0, Math.max(0, Math.floor(quantity)));
    setCart(current => next <= 0 ? current.filter(c => c.product_id !== id) : current.some(c => c.product_id === id) ? current.map(c => c.product_id === id ? { ...c, quantity: next } : c) : [...current, { product_id: id, quantity: next }]);
  }
  function add(id: string) {
    const product = products.find(p => p.id === id);
    const quantity = cart.find(c => c.product_id === id)?.quantity || 0;
    if (!product || quantity >= Math.min(product.stock, 99)) { toast('You have reached the available quantity.'); return; }
    update(id, quantity + 1); toast(`${product.name} added to your cart.`);
  }
  return <ShopContext.Provider value={{ products, promos, cart, ready, loading, count: cart.reduce((s, i) => s + i.quantity, 0), add, update, clear: () => setCart([]), toast, refresh }}>
    {children}<div className={`toast ${message ? 'visible' : ''}`} role="status">{message}</div>
  </ShopContext.Provider>;
}
export function useShop() { const value = useContext(ShopContext); if (!value) throw new Error('ShopProvider is required'); return value; }
