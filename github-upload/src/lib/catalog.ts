import type { Product } from '../types';
export const sampleProducts: Product[] = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'RedRevive Con', description: 'Your everyday rust rescue. A handy 250 ml bottle for household tools and small touch-ups.', price: 75, image_url: '/assets/redrevive-250-hd.png', category: 'Home & DIY', stock: 100, is_available: true, created_at: '2026-01-01T00:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'RedRevive Con', description: 'A little more revival. 500 ml of surface-clinging gel for regular maintenance and DIY projects.', price: 150, image_url: '/assets/redrevive-500-hd.png', category: 'Workshop', stock: 100, is_available: true, created_at: '2026-01-01T00:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'RedRevive Pro', description: 'Made for the bigger jobs. A generous 1 L size for workshops and business maintenance.', price: 300, image_url: '/assets/redrevive-1000.png', category: 'Professional', stock: 100, is_available: true, created_at: '2026-01-01T00:00:00Z' },
];
export const productSize = (product: Product) => product.image_url?.includes('250') ? '250 ml' : product.image_url?.includes('500') ? '500 ml' : product.image_url?.includes('1000') ? '1 liter' : product.category;
