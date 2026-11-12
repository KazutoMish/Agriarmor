import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const titles: Record<string, string> = { '/': 'A fresh start for rusty things.', '/products': 'Shop RedRevive', '/our-story': 'Our story', '/how-it-works': 'How it works', '/cart': 'Your cart', '/checkout': 'Checkout', '/track': 'Track your order', '/admin': 'Team dashboard' };
export default function RouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = `AgriArmor — ${titles[pathname] || (pathname.startsWith('/confirmation/') ? 'Order received' : 'A fresh start for rusty things.')}`;
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.appendChild(robots); }
    robots.content = ['/admin','/checkout','/cart','/track','/confirmation'].some(path => pathname.startsWith(path)) ? 'noindex, nofollow' : 'index, follow';
    const site = import.meta.env.VITE_SITE_URL;
    if (site && /^https:\/\//.test(site)) {
      const origin = new URL(site).origin;
      let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
      canonical.href = `${origin}${pathname}`;
      const image = document.querySelector<HTMLMetaElement>('meta[property="og:image"]');
      if (image) image.content = `${origin}/assets/og-image.png`;
      let url = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
      if (!url) { url = document.createElement('meta'); url.setAttribute('property','og:url'); document.head.appendChild(url); }
      url.content = `${origin}${pathname}`;
    }
  }, [pathname]);
  return null;
}
