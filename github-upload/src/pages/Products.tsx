import { useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import ProductCard from '../components/ProductCard';
import { useShop } from '../context/ShopContext';

export default function Products() {
  const { products, loading } = useShop();
  const [category, setCategory] = useState('All products');
  const [search, setSearch] = useState('');
  const categories = ['All products', ...new Set(products.map(p => p.category))];
  const filtered = products.filter(p => (category === 'All products' || p.category === category) && `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page-wrap"><div className="page-title"><p className="eyebrow">GOOD THINGS COME IN THREE SIZES.</p><h1>A fresh start, <em>your size.</em></h1><p>From the kitchen drawer to the workshop floor. Meet your RedRevive.</p></div><div className="catalog-toolbar"><div className="category-tabs" aria-label="Filter products by category"><SlidersHorizontal size={17} />{categories.map(c => <button key={c} className={category === c ? 'selected' : ''} onClick={() => setCategory(c)} aria-pressed={category === c}>{c}</button>)}</div><label className="search-field"><Search size={17} /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find your fresh start…" aria-label="Search products" /></label></div><div className="product-grid">{filtered.map((p,i) => <ProductCard key={p.id} product={p} index={i} />)}</div>{!filtered.length && <div className="empty-state">{loading ? 'Getting the collection ready…' : 'No products match. Try another search or category.'}</div>}<p className="catalog-footnote">All prices in Philippine pesos. Delivery and discounts are calculated at checkout.</p></div>;
}
