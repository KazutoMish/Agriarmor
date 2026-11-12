-- Run after migrations/001_initial.sql. Safe to run again; existing inventory
-- and product edits are preserved. Prices reflect the current product catalog.
insert into public.products (id, name, description, price, image_url, category, stock, is_available)
values
  ('00000000-0000-4000-8000-000000000001', 'RedRevive Con · 250 ml',
   'The everyday bottle. A tomato and kamias based rust-removing gel for small tools and home projects. Made in the Philippines with agricultural surplus.',
   75, '/assets/redrevive-250-hd.png', 'Everyday care', 150, true),
  ('00000000-0000-4000-8000-000000000002', 'RedRevive Con · 500 ml',
   'More care for the tools you count on. A clinging rust-removing gel for regular maintenance in the workshop, garden, or farm.',
   150, '/assets/redrevive-500-hd.png', 'Everyday care', 100, true),
  ('00000000-0000-4000-8000-000000000003', 'RedRevive Pro · 1 L',
   'A generous refill for bigger projects and busy workshops. The same tomato and kamias based gel, made with surplus produce from Cordillera and Nueva Vizcaya.',
   300, '/assets/redrevive-1000.png', 'Workshop essentials', 80, true)
on conflict (id) do nothing;

-- Banner only: no unapproved discount is applied. Add codes in /admin.
insert into public.promos (id, code, banner_text, discount_type, discount_value, starts_at, ends_at, is_active)
values ('00000000-0000-4000-8000-000000000101', null,
  'Made from local surplus. Made for a fresh start. Free delivery on orders ₱499+ after discounts.',
  'percent', 0, '2020-01-01T00:00:00Z', null, true)
on conflict (id) do nothing;
