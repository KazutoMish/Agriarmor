import { ArrowUpRight, Plus } from 'lucide-react';
import { useShop } from '../context/ShopContext';
import { productSize } from '../lib/catalog';
import { formatMoney } from '../lib/utils';
import type { Product } from '../types';

export default function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const { add } = useShop();
  const isPhoto = /\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(product.image_url || '');
  return <article className="product-card"><div className={`product-visual product-tone-${index % 3}${isPhoto ? ' product-photo' : ''}`}><span className={`product-badge ${index === 1 ? 'popular' : ''}`}>{index === 0 ? 'THE EVERYDAY ESSENTIAL' : index === 1 ? 'THE WORKSHOP FAVORITE' : 'FOR THE BIGGER JOBS'}</span><img src={product.image_url || '/assets/redrevive-250.svg'} alt={`${product.name}, ${productSize(product)}`} loading="lazy" width="300" height="350" /><span className="product-size">{productSize(product)} <ArrowUpRight size={14} /></span></div><div className="product-info"><span className="product-category">BIO-BASED RUST REMOVAL GEL</span><div className="product-title"><h3>{product.name}</h3><span>{formatMoney(product.price)}</span></div><p>{product.description}</p><button className="add-to-cart" onClick={() => add(product.id)} disabled={product.stock <= 0}>{product.stock > 0 ? 'Add to cart' : 'Out of stock'}<Plus size={17} /></button></div></article>;
}
