import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, Download, Leaf, LogOut, Package, Pencil, Plus, RefreshCw, Search, ShieldCheck, ShoppingBag, Sprout, Tag, Trash2, Upload, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useShop } from '../context/ShopContext';
import { formatDate, formatMoney, statusLabel } from '../lib/utils';
import type { Order, Product, Promo } from '../types';
import '../admin.css';

const PAGE_SIZE = 20;
const FETCH_SIZE = 500;
const STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'ready', 'completed', 'cancelled'] as const;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
type Tab = 'overview' | 'orders' | 'products' | 'promos';
type Filters = { search: string; status: string; from: string; to: string };
type ProductDraft = { name: string; description: string; price: string; image_url: string; category: string; stock: string; is_available: boolean };
type PromoDraft = { code: string; banner_text: string; discount_type: 'percent' | 'fixed'; discount_value: string; starts_at: string; ends_at: string; is_active: boolean };
type Summary = { ordersToday: number; pending: number; sales: number; availableProducts: number; topProducts: { name: string; quantity: number }[] };
const emptyProduct = (): ProductDraft => ({ name: '', description: '', price: '', image_url: '', category: 'Home & DIY', stock: '0', is_available: true });
const emptyPromo = (): PromoDraft => ({ code: '', banner_text: '', discount_type: 'percent', discount_value: '10', starts_at: '', ends_at: '', is_active: true });
const emptyFilters: Filters = { search: '', status: '', from: '', to: '' };
const loginSchema = z.object({ email: z.string().trim().email('Enter a valid email address.'), password: z.string().min(1, 'Enter your password.').max(200) });
const productSchema = z.object({
  name: z.string().trim().min(2, 'Give the product a name of at least 2 characters.').max(120),
  description: z.string().trim().max(2000),
  price: z.coerce.number().finite().min(0).max(1000000),
  image_url: z.string().trim().max(2000).refine(value => value === '' || (!/[\u0000-\u001f\u007f]/.test(value) && (/^\/(?![/\\])/.test(value) || (/^https?:\/\//i.test(value) && z.string().url().safeParse(value).success))), 'Use a root-relative path or a valid http or https image URL.'),
  category: z.string().trim().min(1, 'Enter a category.').max(80),
  stock: z.coerce.number().int('Stock must be a whole number.').min(0).max(1000000),
  is_available: z.boolean(),
});
const promoSchema = z.object({
  code: z.string().trim().max(32).refine(value => value === '' || /^[a-z0-9_-]{3,32}$/i.test(value), 'Codes need 3–32 letters, numbers, underscores, or hyphens.'),
  banner_text: z.string().trim().max(240),
  discount_type: z.enum(['percent', 'fixed']),
  discount_value: z.coerce.number().finite().min(0).max(1000000),
  starts_at: z.string(), ends_at: z.string(), is_active: z.boolean(),
}).superRefine((value, ctx) => {
  if (!value.code && !value.banner_text) ctx.addIssue({ code: 'custom', path: ['banner_text'], message: 'Add a discount code or banner text.' });
  if (value.code && value.discount_value <= 0) ctx.addIssue({ code: 'custom', path: ['discount_value'], message: 'A discount code needs a value greater than zero.' });
  if (value.discount_type === 'percent' && value.discount_value > 100) ctx.addIssue({ code: 'custom', path: ['discount_value'], message: 'A percentage discount cannot exceed 100.' });
  for (const key of ['starts_at', 'ends_at'] as const) {
    if (value[key] && !Number.isFinite(Date.parse(`${value[key]}:00+08:00`))) ctx.addIssue({ code: 'custom', path: [key], message: 'Enter a valid date and time.' });
  }
  if (value.starts_at && value.ends_at && value.ends_at <= value.starts_at) ctx.addIssue({ code: 'custom', path: ['ends_at'], message: 'The end must be after the start.' });
  if (!value.starts_at && value.ends_at && Date.parse(`${value.ends_at}:00+08:00`) <= Date.now()) ctx.addIssue({ code: 'custom', path: ['ends_at'], message: 'A promotion starting now needs a future end date.' });
});
const dateFilter = z.string().refine(value => value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00+08:00`))), 'Enter a valid date.');
const filterSchema = z.object({ search: z.string().trim().max(100), status: z.enum(['', ...STATUSES]), from: dateFilter, to: dateFilter }).refine(value => !value.from || !value.to || value.from <= value.to, { message: 'Choose an end date on or after the start date.' });

function errorMessage(error: unknown) { return error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.'; }
function firstIssue(result: { error: { issues: { message: string }[] } }) { return result.error.issues[0]?.message || 'Please check the form.'; }
function dayStart(value: string) { return new Date(`${value}T00:00:00+08:00`).toISOString(); }
function dayEnd(value: string) { return new Date(Date.parse(dayStart(value)) + 86_400_000).toISOString(); }
function manilaToday() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-'); }
function manilaInput(value: string | null | undefined) { return value ? new Date(Date.parse(value) + 28_800_000).toISOString().slice(0, 16) : ''; }
function promoIso(value: string) { return value ? new Date(`${value}:00+08:00`).toISOString() : null; }
function nextStatuses(order: Order): string[] {
  switch (order.status) {
    case 'pending': return ['confirmed', 'cancelled'];
    case 'confirmed': return ['preparing', 'cancelled'];
    case 'preparing': return [order.fulfillment_type === 'pickup' ? 'ready' : 'out_for_delivery', 'cancelled'];
    case 'ready': case 'out_for_delivery': return ['completed', 'cancelled'];
    default: return [];
  }
}
function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  const leadingTrimmed = text.replace(/^[\u0000-\u0020\u00a0\ufeff]+/, '').trimStart();
  const safe = /^[=+\-@]/.test(leadingTrimmed) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
async function everyRow<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; count: number | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, count, error } = await fetchPage(offset, offset + FETCH_SIZE - 1);
    if (error) throw error;
    if (count === null) throw new Error('The database did not provide a total. Refresh to avoid an incomplete result.');
    const batch = data || [];
    rows.push(...batch);
    offset += batch.length;
    if (offset >= count) return rows;
    if (batch.length === 0) throw new Error('The database returned an incomplete result. Refresh and try again.');
  }
}
function StatusBadge({ status }: { status: string }) { return <span className={`admin-status admin-status-${status}`}>{statusLabel(status)}</span>; }

export default function Admin() {
  const { refresh: refreshShop } = useShop();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [access, setAccess] = useState<'checking' | 'admin' | 'denied'>('checking');
  const [accessError, setAccessError] = useState('');
  const [login, setLogin] = useState({ email: '', password: '' });
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderCount, setOrderCount] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [filterDraft, setFilterDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selected, setSelected] = useState<Order | null>(null);
  const [nextStatus, setNextStatus] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productEditor, setProductEditor] = useState<string | 'new' | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyProduct);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState('');
  const [promos, setPromos] = useState<Promo[]>([]);
  const [promosLoading, setPromosLoading] = useState(false);
  const [promoEditor, setPromoEditor] = useState<string | 'new' | null>(null);
  const [promoDraft, setPromoDraft] = useState<PromoDraft>(emptyPromo);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const orderRequest = useRef(0);
  const proofRequest = useRef(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let alive = true;
    client.auth.getSession().then(({ data, error: authError }) => {
      if (!alive) return;
      if (authError) setError(authError.message);
      setSession(data.session); setAuthLoading(false);
    }).catch(cause => { if (alive) { setError(errorMessage(cause)); setAuthLoading(false); } });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (alive) { setSession(nextSession); setAuthLoading(false); }
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client || authLoading || !session) { setAccess('checking'); return; }
    let alive = true;
    setAccess('checking'); setAccessError('');
    Promise.resolve(client.from('profiles').select('role').eq('id', session.user.id).maybeSingle()).then(({ data, error: profileError }) => {
      if (!alive) return;
      if (profileError) setAccessError(profileError.message);
      setAccess(!profileError && data?.role === 'admin' ? 'admin' : 'denied');
    }).catch((cause: unknown) => { if (alive) { setAccessError(errorMessage(cause)); setAccess('denied'); } });
    return () => { alive = false; };
  }, [authLoading, session?.user.id, session?.access_token]);

  useEffect(() => {
    if (!productFile) { setFilePreview(''); return; }
    const url = URL.createObjectURL(productFile);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [productFile]);

  useEffect(() => { proofRequest.current += 1; setProofUrl(''); }, [selected?.id]);

  const queryOrders = useCallback((applied: Filters) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    let query = supabase.from('orders').select('*, order_items(*)', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false });
    if (applied.status) query = query.eq('status', applied.status);
    if (applied.from) query = query.gte('created_at', dayStart(applied.from));
    if (applied.to) query = query.lt('created_at', dayEnd(applied.to));
    const term = applied.search.replace(/[\\,%_()"']/g, ' ').trim();
    if (term) query = query.or(`order_number.ilike.%${term}%,customer_name.ilike.%${term}%,phone.ilike.%${term}%`);
    return query;
  }, []);

  const loadOrders = useCallback(async () => {
    if (!supabase || access !== 'admin') return;
    const request = ++orderRequest.current;
    setOrdersLoading(true);
    try {
      const { data, count, error: queryError } = await queryOrders(filters).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (queryError) throw queryError;
      if (request !== orderRequest.current) return;
      setOrders((data || []) as Order[]); setOrderCount(count || 0);
      if (page > 0 && page * PAGE_SIZE >= (count || 0)) setPage(Math.max(0, Math.ceil((count || 0) / PAGE_SIZE) - 1));
    } catch (cause) { if (request === orderRequest.current) setError(errorMessage(cause)); }
    finally { if (request === orderRequest.current) setOrdersLoading(false); }
  }, [access, filters, page, queryOrders]);

  const loadProducts = useCallback(async () => {
    const client = supabase;
    if (!client || access !== 'admin') return;
    setProductsLoading(true);
    try {
      const rows = await everyRow<Product>((from, to) => client.from('products').select('*', { count: 'exact' }).order('name').order('id').range(from, to));
      setProducts(rows);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setProductsLoading(false); }
  }, [access]);

  const loadPromos = useCallback(async () => {
    const client = supabase;
    if (!client || access !== 'admin') return;
    setPromosLoading(true);
    try {
      const rows = await everyRow<Promo>((from, to) => client.from('promos').select('*', { count: 'exact' }).order('starts_at', { ascending: false, nullsFirst: true }).order('id').range(from, to));
      setPromos(rows);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setPromosLoading(false); }
  }, [access]);

  const loadSummary = useCallback(async () => {
    const client = supabase;
    if (!client || access !== 'admin') return;
    setSummaryLoading(true);
    try {
      const today = manilaToday();
      const [todayResult, pendingResult, availableResult] = await Promise.all([
        client.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', dayStart(today)).lt('created_at', dayEnd(today)),
        client.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        client.from('products').select('id', { count: 'exact', head: true }).eq('is_available', true),
      ]);
      for (const result of [todayResult, pendingResult, availableResult]) if (result.error) throw result.error;
      let sales = 0;
      const productTotals = new Map<string, { name: string; quantity: number }>();
      const completed = await everyRow<{ id: string; total: number; order_items: { product_id: string | null; name_snapshot: string; quantity: number }[] }>((from, to) => client.from('orders').select('id,total,order_items(product_id,name_snapshot,quantity)', { count: 'exact' }).eq('status', 'completed').order('id').range(from, to));
      for (const order of completed) {
        sales += Number(order.total);
        for (const item of order.order_items || []) {
          const key = item.product_id || item.name_snapshot;
          const current = productTotals.get(key) || { name: item.name_snapshot, quantity: 0 };
          current.quantity += item.quantity;
          productTotals.set(key, current);
        }
      }
      setSummary({ ordersToday: todayResult.count || 0, pending: pendingResult.count || 0, availableProducts: availableResult.count || 0, sales, topProducts: [...productTotals.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5) });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSummaryLoading(false); }
  }, [access]);

  useEffect(() => { if (access === 'admin') void loadOrders(); }, [access, loadOrders]);
  useEffect(() => {
    if (access === 'admin') { void loadProducts(); void loadPromos(); void loadSummary(); }
    else { setOrders([]); setProducts([]); setPromos([]); setSelected(null); setSummary(null); }
  }, [access, loadProducts, loadPromos, loadSummary]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    const parsed = loginSchema.safeParse(login);
    if (!parsed.success) { setError(firstIssue(parsed)); return; }
    if (!supabase) return;
    setBusy('login'); setError('');
    try {
      const { error: authError } = await supabase.auth.signInWithPassword(parsed.data);
      if (authError) throw authError;
      setLogin(value => ({ ...value, password: '' }));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  }

  async function signOut() {
    if (!supabase) return;
    setBusy('logout'); setError('');
    const { error: authError } = await supabase.auth.signOut();
    if (authError) setError(authError.message);
    else { setSession(null); setSelected(null); setNotice(''); }
    setBusy('');
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const parsed = filterSchema.safeParse(filterDraft);
    if (!parsed.success) { setError(firstIssue(parsed)); return; }
    setError(''); setFilters(parsed.data); setPage(0); setSelected(null);
  }

  async function exportOrders() {
    setBusy('export'); setError('');
    try {
      const rows = await everyRow<Order>((from, to) => queryOrders(filters).range(from, to));
      const headers = ['Order number', 'Created at (UTC)', 'Customer', 'Phone', 'Email', 'Fulfillment', 'Address', 'Scheduled at (UTC)', 'Payment method', 'Payment reference', 'Status', 'Items', 'Subtotal (PHP)', 'Discount (PHP)', 'Delivery fee (PHP)', 'Total (PHP)', 'Notes'];
      const records = rows.map(order => [order.order_number, order.created_at, order.customer_name, order.phone, order.email, order.fulfillment_type, order.address, order.scheduled_at, order.payment_method, order.payment_reference, order.status, (order.order_items || []).map(item => `${item.quantity} × ${item.name_snapshot} @ ${item.price_snapshot}`).join('; '), order.subtotal, order.discount, order.delivery_fee, order.total, order.notes]);
      const csv = '\uFEFF' + [headers, ...records].map(row => row.map(csvCell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `agriarmor-orders-${filters.from || 'all'}-${filters.to || manilaToday()}.csv`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Exported ${rows.length} ${rows.length === 1 ? 'order' : 'orders'} using the applied filters.`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  }

  async function updateStatus(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selected) return;
    if (!z.enum(STATUSES).safeParse(nextStatus).success || !nextStatuses(selected).includes(nextStatus)) { setError('Choose an allowed next status.'); return; }
    if (nextStatus === 'cancelled' && !window.confirm(`Cancel ${selected.order_number}? Reserved stock will be returned.`)) return;
    setBusy('status'); setError('');
    try {
      const { data, error: updateError } = await supabase.from('orders').update({ status: nextStatus }).eq('id', selected.id).eq('status', selected.status).select('*, order_items(*)').single();
      if (updateError) throw new Error(`Could not update this order. It may have changed in another session. Refresh and try again. ${updateError.message}`);
      setSelected(data as Order); setNextStatus('');
      setNotice(`${selected.order_number} is now ${statusLabel(nextStatus).toLowerCase()}.`);
      await Promise.all([loadOrders(), loadSummary(), loadProducts(), refreshShop()]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  }

  async function showProof() {
    if (!supabase || !selected?.payment_proof_url) return;
    const request = ++proofRequest.current;
    setBusy('proof'); setError('');
    try {
      const path = selected.payment_proof_url;
      if (/^https?:|^\//i.test(path) || path.includes('..')) throw new Error('The payment proof has an invalid storage path.');
      const { data, error: storageError } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 3600);
      if (storageError) throw storageError;
      if (request === proofRequest.current) setProofUrl(data.signedUrl);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  }

  function editProduct(product?: Product) {
    setProductEditor(product?.id || 'new'); setProductFile(null); setError('');
    setProductDraft(product ? { name: product.name, description: product.description || '', price: String(product.price), image_url: product.image_url || '', category: product.category, stock: String(product.stock), is_available: product.is_available } : emptyProduct());
  }

  function chooseProductImage(file?: File) {
    if (!file) { setProductFile(null); return; }
    if (!IMAGE_TYPES.includes(file.type)) { setError('Choose a JPG, PNG, or WebP image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Product images must be 5 MB or smaller.'); return; }
    setError(''); setProductFile(file);
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    const parsed = productSchema.safeParse(productDraft);
    if (!parsed.success) { setError(firstIssue(parsed)); return; }
    if (!supabase || !productEditor) return;
    setBusy('product'); setError('');
    let uploadedPath = '';
    try {
      let imageUrl = parsed.data.image_url;
      if (productFile) {
        if (!IMAGE_TYPES.includes(productFile.type) || productFile.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP image no larger than 5 MB.');
        const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[productFile.type];
        uploadedPath = `${crypto.randomUUID()}.${extension}`;
        const { error: storageError } = await supabase.storage.from('product-images').upload(uploadedPath, productFile, { contentType: productFile.type, upsert: false });
        if (storageError) throw storageError;
        imageUrl = supabase.storage.from('product-images').getPublicUrl(uploadedPath).data.publicUrl;
      }
      const payload = { ...parsed.data, image_url: imageUrl || null };
      const result = productEditor === 'new' ? await supabase.from('products').insert(payload) : await supabase.from('products').update(payload).eq('id', productEditor);
      if (result.error) throw result.error;
      setProductEditor(null); setProductFile(null); setNotice('Product saved. The storefront will show the updated information.');
      await Promise.all([loadProducts(), loadSummary(), refreshShop()]);
    } catch (cause) {
      if (uploadedPath) await supabase.storage.from('product-images').remove([uploadedPath]);
      setError(errorMessage(cause));
    } finally { setBusy(''); }
  }

  async function deleteProduct(product: Product) {
    if (!supabase || !window.confirm(`Delete “${product.name}”? You can turn off availability instead to preserve it.`)) return;
    setBusy(`delete-product-${product.id}`); setError('');
    try {
      const { error: deleteError } = await supabase.from('products').delete().eq('id', product.id);
      if (deleteError) throw new Error(deleteError.code === '23503' ? 'This product appears in an order and cannot be deleted. Edit it and turn off availability instead.' : deleteError.message);
      setNotice('Product deleted.'); await Promise.all([loadProducts(), loadSummary(), refreshShop()]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  }

  async function toggleAvailability(product: Product) {
    if (!supabase) return;
    setBusy(`toggle-${product.id}`); setError('');
    try {
      const { error: updateError } = await supabase.from('products').update({ is_available: !product.is_available }).eq('id', product.id);
      if (updateError) throw updateError;
      await Promise.all([loadProducts(), loadSummary(), refreshShop()]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  }

  function editPromo(promo?: Promo) {
    setPromoEditor(promo?.id || 'new'); setError('');
    setPromoDraft(promo ? { code: promo.code || '', banner_text: promo.banner_text || '', discount_type: promo.discount_type, discount_value: String(promo.discount_value), starts_at: manilaInput(promo.starts_at), ends_at: manilaInput(promo.ends_at), is_active: promo.is_active } : emptyPromo());
  }

  async function savePromo(event: FormEvent) {
    event.preventDefault();
    const parsed = promoSchema.safeParse(promoDraft);
    if (!parsed.success) { setError(firstIssue(parsed)); return; }
    if (!supabase || !promoEditor) return;
    setBusy('promo'); setError('');
    try {
      const value = parsed.data;
      const payload = { code: value.code.toUpperCase() || null, banner_text: value.banner_text || null, discount_type: value.code ? value.discount_type : 'fixed', discount_value: value.code ? value.discount_value : 0, starts_at: promoIso(value.starts_at) || new Date().toISOString(), ends_at: promoIso(value.ends_at), is_active: value.is_active };
      const result = promoEditor === 'new' ? await supabase.from('promos').insert(payload) : await supabase.from('promos').update(payload).eq('id', promoEditor);
      if (result.error) throw result.error;
      setPromoEditor(null); setNotice('Promotion saved.'); await Promise.all([loadPromos(), refreshShop()]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  }

  async function deletePromo(promo: Promo) {
    if (!supabase || !window.confirm(`Delete promotion “${promo.code || promo.banner_text}”?`)) return;
    setBusy(`delete-promo-${promo.id}`); setError('');
    try {
      const { error: deleteError } = await supabase.from('promos').delete().eq('id', promo.id);
      if (deleteError) throw deleteError;
      setNotice('Promotion deleted.'); await Promise.all([loadPromos(), refreshShop()]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  }

  const tabs = useMemo(() => [{ key: 'overview' as Tab, label: 'Overview', icon: Sprout }, { key: 'orders' as Tab, label: 'Orders', icon: ShoppingBag }, { key: 'products' as Tab, label: 'Products', icon: Package }, { key: 'promos' as Tab, label: 'Promotions', icon: Tag }], []);
  const alerts = <>{error && <div className="admin-alert admin-alert-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={18} /></button></div>}{notice && <div className="admin-alert admin-alert-success" role="status"><Check size={18} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={18} /></button></div>}</>;

  if (!supabase) return <main className="admin-page page-wrap"><section className="admin-login-card panel"><ShieldCheck size={32} /><p className="admin-eyebrow">AgriArmor administration</p><h1>Connect your growing room.</h1><p>Add your Supabase URL and publishable key to the environment, then follow the database and admin setup in the README. The dashboard becomes available when Supabase is configured.</p><Link className="button admin-btn" to="/">Back to the storefront <ArrowUpRight size={17} /></Link></section></main>;
  if (authLoading || (session && access === 'checking')) return <main className="admin-page page-wrap"><div className="admin-empty" role="status"><RefreshCw className="admin-spin" size={25} /><p>Checking your admin access…</p></div></main>;
  if (!session) return <main className="admin-page page-wrap"><div className="admin-login-layout"><div className="admin-login-intro"><span className="admin-icon-block"><Leaf size={29} /></span><p className="admin-eyebrow">The growing room</p><h1>A little care.<br />A lot of growth.</h1><p>Your orders, products, and promotions — together in one place.</p><Link to="/" className="admin-text-link">Visit the storefront <ArrowUpRight size={16} /></Link></div><section className="admin-login-card panel"><ShieldCheck size={28} /><h2>Welcome back.</h2><p>Sign in with your AgriArmor admin account.</p>{alerts}<form onSubmit={signIn} className="admin-form"><label>Email address<input className="field" type="email" autoComplete="username" value={login.email} onChange={event => setLogin({ ...login, email: event.target.value })} required maxLength={254} /></label><label>Password<input className="field" type="password" autoComplete="current-password" value={login.password} onChange={event => setLogin({ ...login, password: event.target.value })} required maxLength={200} /></label><button className="button admin-btn" disabled={Boolean(busy)}>{busy === 'login' ? 'Signing in…' : 'Sign in'}<ArrowUpRight size={17} /></button></form><p className="admin-small">Admin accounts are created by the store owner. Customer ordering does not require an account.</p></section></div></main>;
  if (access === 'denied') return <main className="admin-page page-wrap"><section className="admin-login-card panel"><ShieldCheck size={30} /><h1>Admin access required.</h1><p>This account does not have permission to open the dashboard. Ask the store owner to assign the admin role to your account.</p>{accessError && <p className="admin-small">Access check: {accessError}</p>}{alerts}<button className="button admin-btn" onClick={signOut} disabled={Boolean(busy)}>Sign out <LogOut size={17} /></button><Link className="admin-text-link" to="/">Back to the storefront <ArrowUpRight size={16} /></Link></section></main>;

  return <main className="admin-page page-wrap">
    <header className="admin-header"><div><p className="admin-eyebrow"><Sprout size={15} /> The growing room</p><h1>Your business, in bloom.</h1><p>A little overview of what's growing at AgriArmor.</p></div><div className="admin-header-actions"><Link to="/" className="admin-text-link">View store <ArrowUpRight size={16} /></Link><button className="button-outline admin-btn admin-btn-muted" onClick={signOut} disabled={Boolean(busy)}><LogOut size={16} /> Sign out</button></div></header>
    <nav className="admin-tabs" aria-label="Admin sections">{tabs.map(({ key, label, icon: Icon }) => <button type="button" key={key} onClick={() => setTab(key)} className={tab === key ? 'is-active' : ''} aria-current={tab === key ? 'page' : undefined}><Icon size={17} />{label}{key === 'orders' && summary && summary.pending > 0 && <span className="admin-tab-count">{summary.pending}</span>}</button>)}</nav>
    {alerts}

    {tab === 'overview' && <div className="admin-overview"><div className="admin-section-heading"><div><h2>A fresh perspective.</h2><p>All dates and times use Asia/Manila.</p></div><button className="admin-icon-button" onClick={loadSummary} disabled={summaryLoading} aria-label="Refresh statistics"><RefreshCw size={18} className={summaryLoading ? 'admin-spin' : ''} /></button></div><div className="admin-stat-grid">{[
      { label: 'Orders today', value: summary?.ordersToday, icon: ShoppingBag, detail: 'From midnight in Manila' },
      { label: 'Completed sales', value: summary ? formatMoney(summary.sales) : undefined, icon: CircleDollarSign, detail: 'All-time completed order totals' },
      { label: 'Awaiting confirmation', value: summary?.pending, icon: ClipboardList, detail: 'Pending orders to review' },
      { label: 'Available products', value: summary?.availableProducts, icon: Sprout, detail: 'Visible on the storefront' },
    ].map(({ label, value, icon: Icon, detail }) => <article className="admin-stat-card panel" key={label}><div><span>{label}</span><Icon size={19} /></div><strong>{value === undefined ? '—' : value}</strong><p>{detail}</p></article>)}</div><div className="admin-overview-grid"><section className="panel admin-overview-panel"><div className="admin-section-heading"><div><p className="admin-eyebrow">Growing favorites</p><h3>Your top products.</h3></div><Package size={23} /></div>{summary?.topProducts.length ? <ol className="admin-top-products">{summary.topProducts.map((product, index) => <li key={product.name}><span className="admin-rank">0{index + 1}</span><span>{product.name}</span><strong>{product.quantity} <small>sold</small></strong></li>)}</ol> : <div className="admin-empty"><Sprout size={30} /><p>{summaryLoading ? 'Loading product performance…' : 'Your bestsellers will appear after your first completed order.'}</p></div>}<p className="admin-small">Ranked by units in all completed orders.</p></section><section className="admin-todo-card"><span className="admin-icon-block"><Leaf size={27} /></span><p className="admin-eyebrow">Small steps, strong roots</p><h3>Good things grow with a little attention.</h3><p>{summary?.pending ? `You have ${summary.pending} ${summary.pending === 1 ? 'order waiting' : 'orders waiting'} for confirmation. Give your next customer's tools a fresh start.` : 'Review orders, keep your stock up to date, and make room for the next season of growth.'}</p><button className="button admin-btn" onClick={() => setTab('orders')}>Take a look at orders <ArrowUpRight size={17} /></button></section></div></div>}

    {tab === 'orders' && <section className="admin-orders"><div className="admin-section-heading"><div><h2>Every order, cared for.</h2><p>Review requests and keep customers in the loop.</p></div><button className="button-outline admin-btn admin-btn-muted" onClick={exportOrders} disabled={Boolean(busy)}><Download size={16} />{busy === 'export' ? 'Exporting…' : 'Export filtered CSV'}</button></div><form className="admin-order-filters panel" onSubmit={applyFilters}><label className="admin-search">Search orders<div><Search size={17} /><input className="field" value={filterDraft.search} onChange={event => setFilterDraft({ ...filterDraft, search: event.target.value })} placeholder="Order number, customer, phone" maxLength={100} /></div></label><label>Status<select className="field" value={filterDraft.status} onChange={event => setFilterDraft({ ...filterDraft, status: event.target.value })}><option value="">All statuses</option>{STATUSES.map(status => <option value={status} key={status}>{statusLabel(status)}</option>)}</select></label><label>From · Manila<input className="field" type="date" value={filterDraft.from} onChange={event => setFilterDraft({ ...filterDraft, from: event.target.value })} /></label><label>To · Manila<input className="field" type="date" value={filterDraft.to} onChange={event => setFilterDraft({ ...filterDraft, to: event.target.value })} /></label><button className="button admin-btn" type="submit" disabled={ordersLoading}>Apply</button><button className="admin-text-link" type="button" onClick={() => { setFilterDraft(emptyFilters); setFilters(emptyFilters); setPage(0); setSelected(null); }}>Reset</button></form><p className="admin-small admin-filter-note">CSV includes every order matching the applied filters, across all pages. Blank dates include all dates.</p>
      {selected && <section className="admin-order-detail panel" aria-label={`Details for ${selected.order_number}`}><div className="admin-section-heading"><div><p className="admin-eyebrow">Order details</p><h3>{selected.order_number}</h3><p>{formatDate(selected.created_at)}</p></div><div className="admin-detail-actions"><StatusBadge status={selected.status} /><button className="admin-icon-button" aria-label="Close order details" onClick={() => { setSelected(null); setProofUrl(''); }}><X size={19} /></button></div></div><div className="admin-detail-grid"><div><h4>Customer & fulfillment</h4><dl><dt>Customer</dt><dd>{selected.customer_name}</dd><dt>Phone</dt><dd><a href={`tel:${selected.phone.replace(/[^+\d]/g, '')}`}>{selected.phone}</a></dd>{selected.email && <><dt>Email</dt><dd>{selected.email}</dd></>}<dt>Method</dt><dd>{selected.fulfillment_type === 'pickup' ? 'Pickup' : 'Delivery'}</dd>{selected.address && <><dt>Address</dt><dd>{selected.address}</dd></>}{selected.scheduled_at && <><dt>Preferred time</dt><dd>{formatDate(selected.scheduled_at)}</dd></>}{selected.notes && <><dt>Notes</dt><dd className="admin-preserve-lines">{selected.notes}</dd></>}</dl></div><div><h4>Payment & order summary</h4><p className="admin-payment-method">{selected.payment_method.replace(/_/g, ' ')} <span>· Offline payment</span></p>{selected.payment_reference && <p className="admin-small">Reference: <strong>{selected.payment_reference}</strong></p>}<ul className="admin-line-items">{(selected.order_items || []).map(item => <li key={item.id}><span>{item.quantity} × {item.name_snapshot}</span><strong>{formatMoney(Number(item.price_snapshot) * item.quantity)}</strong></li>)}</ul><dl className="admin-order-totals"><dt>Subtotal</dt><dd>{formatMoney(selected.subtotal)}</dd><dt>Discount</dt><dd>−{formatMoney(selected.discount)}</dd><dt>Delivery</dt><dd>{formatMoney(selected.delivery_fee)}</dd><dt className="admin-total">Total</dt><dd className="admin-total">{formatMoney(selected.total)}</dd></dl>{selected.payment_proof_url && <div className="admin-proof">{proofUrl ? <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="admin-text-link">Open payment proof <ArrowUpRight size={15} /></a> : <button type="button" onClick={showProof} disabled={Boolean(busy)} className="admin-text-link">{busy === 'proof' ? 'Preparing private link…' : 'View payment proof'} <ArrowUpRight size={15} /></button>}<p className="admin-small">Private image. Access links expire after one hour. Verify transfers separately before confirming payment.</p></div>}</div></div>{nextStatuses(selected).length > 0 ? <form className="admin-status-form" onSubmit={updateStatus}><label>Move this order forward<select className="field" value={nextStatus} onChange={event => setNextStatus(event.target.value)} required><option value="">Choose next status</option>{nextStatuses(selected).map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label><button className="button admin-btn" disabled={!nextStatus || Boolean(busy)}>{busy === 'status' ? 'Updating…' : 'Update status'}<Check size={16} /></button></form> : <p className="admin-small admin-terminal-note">This order is {statusLabel(selected.status).toLowerCase()} and has no further status changes.</p>}</section>}
      <div className="admin-table-wrap panel" aria-busy={ordersLoading}><table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Fulfillment</th><th>Total</th><th>Status</th><th><span className="admin-sr-only">Details</span></th></tr></thead><tbody>{orders.map(order => <tr key={order.id} className={selected?.id === order.id ? 'admin-selected-row' : ''}><td><strong>{order.order_number}</strong><small>{formatDate(order.created_at)}</small></td><td><span>{order.customer_name}</span><small>{order.phone}</small></td><td><span>{order.fulfillment_type === 'pickup' ? 'Pickup' : 'Delivery'}</span><small>{order.payment_method.replace(/_/g, ' ')}</small></td><td><strong>{formatMoney(order.total)}</strong></td><td><StatusBadge status={order.status} /></td><td><button className="admin-icon-button" aria-label={`View ${order.order_number}`} onClick={() => { setSelected(order); setNextStatus(''); setProofUrl(''); }}><ArrowUpRight size={18} /></button></td></tr>)}</tbody></table>{ordersLoading && <div className="admin-table-loading" role="status">Loading orders…</div>}{!ordersLoading && orders.length === 0 && <div className="admin-empty"><ShoppingBag size={30} /><h3>No orders here yet.</h3><p>{filters.search || filters.status || filters.from || filters.to ? 'Try a different search or date range.' : 'New orders will appear here as customers place them.'}</p></div>}<div className="admin-pagination"><span>{orderCount ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, orderCount)} of ${orderCount} orders` : '0 orders'}</span><div><button className="admin-icon-button" onClick={() => { setPage(value => Math.max(0, value - 1)); setSelected(null); }} disabled={page === 0 || ordersLoading} aria-label="Previous order page"><ChevronLeft size={18} /></button><span>Page {page + 1}</span><button className="admin-icon-button" onClick={() => { setPage(value => value + 1); setSelected(null); }} disabled={(page + 1) * PAGE_SIZE >= orderCount || ordersLoading} aria-label="Next order page"><ChevronRight size={18} /></button></div></div></div>
    </section>}

    {tab === 'products' && <section><div className="admin-section-heading"><div><h2>Rooted in good products.</h2><p>Keep your collection fresh and your stock accurate.</p></div><button className="button admin-btn" onClick={() => editProduct()}><Plus size={17} /> Add product</button></div>{productEditor && <section className="panel admin-editor"><div className="admin-section-heading"><h3>{productEditor === 'new' ? 'A new addition.' : 'Edit product.'}</h3><button className="admin-icon-button" aria-label="Close product editor" onClick={() => { setProductEditor(null); setProductFile(null); }} disabled={busy === 'product'}><X size={19} /></button></div><form className="admin-form" onSubmit={saveProduct}><div className="admin-form-grid"><label>Product name<input className="field" value={productDraft.name} onChange={event => setProductDraft({ ...productDraft, name: event.target.value })} required maxLength={120} /></label><label>Category<input className="field" value={productDraft.category} onChange={event => setProductDraft({ ...productDraft, category: event.target.value })} required maxLength={80} /></label><label>Price · PHP<input className="field" type="number" min="0" max="1000000" step="0.01" value={productDraft.price} onChange={event => setProductDraft({ ...productDraft, price: event.target.value })} required /></label><label>Units in stock<input className="field" type="number" min="0" max="1000000" step="1" value={productDraft.stock} onChange={event => setProductDraft({ ...productDraft, stock: event.target.value })} required /></label><label className="admin-span-two">Description<textarea className="field" rows={3} value={productDraft.description} onChange={event => setProductDraft({ ...productDraft, description: event.target.value })} maxLength={2000} /></label><label className="admin-span-two">Image URL <span className="admin-optional">optional if uploading</span><input className="field" type="text" inputMode="url" value={productDraft.image_url} onChange={event => setProductDraft({ ...productDraft, image_url: event.target.value })} placeholder="/assets/product.svg or https://…" maxLength={2000} /></label></div><div className="admin-upload-row">{(filePreview || productDraft.image_url) && <img src={filePreview || productDraft.image_url} className="admin-upload-preview" alt="Product preview" />}<label className="admin-upload"><Upload size={19} /><span>Upload product image</span><small>JPG, PNG, WebP · up to 5 MB</small><input type="file" accept={IMAGE_TYPES.join(',')} onChange={event => chooseProductImage(event.target.files?.[0])} />{productFile && <strong>{productFile.name}</strong>}</label>{productFile && <button className="admin-text-link" type="button" onClick={() => setProductFile(null)}>Clear upload</button>}</div><label className="admin-checkbox"><input type="checkbox" checked={productDraft.is_available} onChange={event => setProductDraft({ ...productDraft, is_available: event.target.checked })} /><span>Available on the storefront</span></label><p className="admin-small">Stock is reserved when an order is placed and returned when it is cancelled. Products in past orders should be made unavailable instead of deleted.</p><div className="admin-form-actions"><button className="button admin-btn" disabled={Boolean(busy)}>{busy === 'product' ? 'Saving product…' : 'Save product'}<Check size={16} /></button><button className="button-outline admin-btn admin-btn-muted" type="button" onClick={() => { setProductEditor(null); setProductFile(null); }} disabled={Boolean(busy)}>Cancel</button></div></form></section>}{productsLoading && <p className="admin-small" role="status">Refreshing products…</p>}<div className="admin-product-grid">{products.map(product => <article className="admin-product-card panel" key={product.id}><div className="admin-product-image">{product.image_url ? <img src={product.image_url} alt={product.name} loading="lazy" /> : <Sprout size={48} />}<span className={`admin-status ${product.is_available ? 'admin-status-completed' : 'admin-status-cancelled'}`}>{product.is_available ? 'Available' : 'Hidden'}</span></div><div className="admin-product-body"><p className="admin-eyebrow">{product.category}</p><h3>{product.name}</h3><p className="admin-product-description">{product.description}</p><div className="admin-product-meta"><strong>{formatMoney(product.price)}</strong><span className={product.stock < 5 ? 'admin-stock-low' : ''}>{product.stock} in stock</span></div><div className="admin-product-actions"><button className="admin-text-link" onClick={() => editProduct(product)}><Pencil size={15} />Edit</button><button className="admin-text-link" onClick={() => toggleAvailability(product)} disabled={Boolean(busy)}>{product.is_available ? 'Hide product' : 'Make available'}</button><button className="admin-icon-button admin-danger-button" onClick={() => deleteProduct(product)} disabled={Boolean(busy)} aria-label={`Delete ${product.name}`}><Trash2 size={16} /></button></div></div></article>)}</div>{!productsLoading && products.length === 0 && <div className="admin-empty panel"><Package size={31} /><h3>Let's plant the first seed.</h3><p>Add your first product to bring the storefront to life.</p></div>}</section>}

    {tab === 'promos' && <section><div className="admin-section-heading"><div><h2>A little extra encouragement.</h2><p>Give your next campaign a place to grow.</p></div><button className="button admin-btn" onClick={() => editPromo()}><Plus size={17} /> Add promotion</button></div>{promoEditor && <section className="panel admin-editor"><div className="admin-section-heading"><h3>{promoEditor === 'new' ? 'Create a promotion.' : 'Edit promotion.'}</h3><button className="admin-icon-button" aria-label="Close promotion editor" onClick={() => setPromoEditor(null)} disabled={busy === 'promo'}><X size={19} /></button></div><form className="admin-form" onSubmit={savePromo}><div className="admin-form-grid"><label>Discount code <span className="admin-optional">leave blank for a banner only</span><input className="field admin-code-input" value={promoDraft.code} onChange={event => setPromoDraft({ ...promoDraft, code: event.target.value.toUpperCase() })} maxLength={32} placeholder="GROWTOGETHER" /></label><label>Discount type<select className="field" value={promoDraft.discount_type} onChange={event => setPromoDraft({ ...promoDraft, discount_type: event.target.value as 'percent' | 'fixed' })}><option value="percent">Percentage (%)</option><option value="fixed">Fixed amount (PHP)</option></select></label><label>Discount value<input className="field" type="number" min="0" step="0.01" max={promoDraft.discount_type === 'percent' ? 100 : 1000000} value={promoDraft.discount_value} onChange={event => setPromoDraft({ ...promoDraft, discount_value: event.target.value })} required disabled={!promoDraft.code.trim()} /></label><label>Starts at · Manila<input className="field" type="datetime-local" value={promoDraft.starts_at} onChange={event => setPromoDraft({ ...promoDraft, starts_at: event.target.value })} /></label><label>Ends at · Manila<input className="field" type="datetime-local" value={promoDraft.ends_at} onChange={event => setPromoDraft({ ...promoDraft, ends_at: event.target.value })} /></label><label className="admin-span-two">Storefront banner text<textarea className="field" rows={2} value={promoDraft.banner_text} onChange={event => setPromoDraft({ ...promoDraft, banner_text: event.target.value })} maxLength={240} placeholder="A fresh start for your tools. Save 10% with GROWTOGETHER." /></label></div><label className="admin-checkbox"><input type="checkbox" checked={promoDraft.is_active} onChange={event => setPromoDraft({ ...promoDraft, is_active: event.target.checked })} /><span>Promotion is active</span></label><p className="admin-small">A blank start begins now; a blank end has no time restriction. Discount codes are validated by the database at checkout. Banner-only promotions do not apply a discount.</p><div className="admin-form-actions"><button className="button admin-btn" disabled={Boolean(busy)}>{busy === 'promo' ? 'Saving promotion…' : 'Save promotion'}<Check size={16} /></button><button type="button" className="button-outline admin-btn admin-btn-muted" onClick={() => setPromoEditor(null)} disabled={Boolean(busy)}>Cancel</button></div></form></section>}{promosLoading && <p className="admin-small" role="status">Refreshing promotions…</p>}<div className="admin-promo-grid">{promos.map(promo => { const upcoming = promo.starts_at && Date.parse(promo.starts_at) > Date.now(); const expired = promo.ends_at && Date.parse(promo.ends_at) <= Date.now(); return <article className="admin-promo-card panel" key={promo.id}><div className="admin-promo-top"><span className="admin-icon-block"><Tag size={22} /></span><span className={`admin-status admin-status-${!promo.is_active ? 'cancelled' : expired ? 'completed' : upcoming ? 'pending' : 'confirmed'}`}>{!promo.is_active ? 'Inactive' : expired ? 'Ended' : upcoming ? 'Scheduled' : 'Active'}</span></div><p className="admin-eyebrow">{!promo.is_active ? 'Inactive' : expired ? 'Ended' : upcoming ? 'Scheduled' : 'Active now'}</p><h3>{promo.code || 'A message for your customers.'}</h3>{promo.code && <strong className="admin-promo-value">{promo.discount_type === 'percent' ? `${promo.discount_value}%` : formatMoney(promo.discount_value)} off</strong>}<p>{promo.banner_text || 'Discount code only — no storefront banner.'}</p><div className="admin-promo-dates"><CalendarDays size={16} /><span>{promo.starts_at ? formatDate(promo.starts_at) : 'Any start date'}<br />{promo.ends_at ? `Until ${formatDate(promo.ends_at)}` : 'No end date'}</span></div><div className="admin-product-actions"><button className="admin-text-link" onClick={() => editPromo(promo)}><Pencil size={15} />Edit promotion</button><button className="admin-icon-button admin-danger-button" aria-label={`Delete ${promo.code || 'banner'}`} onClick={() => deletePromo(promo)} disabled={Boolean(busy)}><Trash2 size={16} /></button></div></article>; })}</div>{!promosLoading && promos.length === 0 && <div className="admin-empty panel"><Tag size={31} /><h3>Make someone's next order special.</h3><p>Create a banner or discount code to start a promotion.</p></div>}</section>}
    <footer className="admin-footer"><span><Leaf size={14} /> AgriArmor · Grow with care.</span><span>Signed in as {session.user.email}</span></footer>
  </main>;
}
