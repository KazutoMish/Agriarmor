-- AgriArmor / RedRevive. Run once in a new Supabase project as postgres.
-- Public writes are intentionally RPC-only: a direct insert policy would let a
-- caller forge totals, snapshot prices, inventory reservations, and order IDs.
-- All price, promotion, inventory, and delivery calculations happen below.
begin;

create schema if not exists agriarmor_private;
revoke all on schema agriarmor_private from public, anon, authenticated;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  price numeric(12,2) not null check (price >= 0 and price <= 1000000),
  image_url text check (char_length(image_url) <= 2000),
  category text not null default 'RedRevive' check (char_length(btrim(category)) between 1 and 80),
  stock integer not null default 0 check (stock between 0 and 1000000),
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.promos (
  id uuid primary key default gen_random_uuid(),
  code text check (code is null or code ~ '^[A-Za-z0-9_-]{3,32}$'),
  banner_text text check (char_length(banner_text) <= 240),
  discount_type text not null default 'percent' check (discount_type in ('percent', 'fixed')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (code is not null or coalesce(char_length(btrim(banner_text)), 0) > 0),
  check (ends_at is null or ends_at > starts_at),
  check (discount_type <> 'percent' or discount_value <= 100),
  check (discount_value <= 1000000)
);
create unique index promos_code_unique on public.promos (lower(code)) where code is not null;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid unique,
  order_number text not null unique default (
    'AA-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
    upper(left(replace(gen_random_uuid()::text, '-', ''), 16))
  ),
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 120),
  phone text not null check (phone ~ '^[0-9]{10,15}$'),
  email text check (char_length(email) <= 254),
  fulfillment_type text not null check (fulfillment_type in ('delivery', 'pickup')),
  address text check (char_length(address) <= 1000),
  scheduled_at timestamptz,
  notes text check (char_length(notes) <= 1500),
  payment_method text not null check (payment_method in ('cod', 'gcash', 'bank_transfer', 'pay_on_pickup')),
  payment_reference text check (char_length(payment_reference) <= 120),
  -- Private Storage path, never a public URL. Only an admin can create a signed URL.
  payment_proof_url text,
  promo_code text,
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0 and discount <= subtotal),
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  total numeric(12,2) not null check (total = subtotal - discount + delivery_fee),
  status text not null default 'pending' check (status in (
    'pending', 'confirmed', 'preparing', 'out_for_delivery', 'ready', 'completed', 'cancelled'
  )),
  created_at timestamptz not null default now(),
  check (fulfillment_type <> 'delivery' or coalesce(char_length(btrim(address)), 0) >= 10),
  check (payment_method <> 'cod' or fulfillment_type = 'delivery'),
  check (payment_method <> 'pay_on_pickup' or fulfillment_type = 'pickup')
);
create index orders_created_at_idx on public.orders (created_at desc);
create index orders_status_created_at_idx on public.orders (status, created_at desc);
create index orders_phone_created_at_idx on public.orders (phone, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name_snapshot text not null,
  price_snapshot numeric(12,2) not null check (price_snapshot >= 0),
  quantity integer not null check (quantity between 1 and 99)
);
create index order_items_order_id_idx on public.order_items (order_id);

-- Private helpers retain no plaintext IP or phone in rate-limit keys.
create table agriarmor_private.rate_limits (
  scope text not null,
  key_hash bigint not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (scope, key_hash)
);
create table agriarmor_private.proof_uploads (
  path text primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index proof_uploads_order_id_idx on agriarmor_private.proof_uploads (order_id);

alter table public.products enable row level security;
alter table public.promos enable row level security;
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table agriarmor_private.rate_limits enable row level security;
alter table agriarmor_private.proof_uploads enable row level security;

create function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

create function agriarmor_private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Never use user-editable auth metadata to assign roles.
  insert into public.profiles (id, role) values (new.id, 'customer') on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function agriarmor_private.handle_new_user() from public, anon, authenticated;
create trigger agriarmor_new_user after insert on auth.users
for each row execute function agriarmor_private.handle_new_user();
insert into public.profiles (id, role) select id, 'customer' from auth.users on conflict (id) do nothing;

create policy products_public_read on public.products for select to anon, authenticated
using (is_available or (select public.is_admin()));
create policy products_admin_insert on public.products for insert to authenticated
with check ((select public.is_admin()));
create policy products_admin_update on public.products for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy products_admin_delete on public.products for delete to authenticated
using ((select public.is_admin()));

create policy promos_public_read on public.promos for select to anon, authenticated
using ((is_active and starts_at <= now() and (ends_at is null or ends_at > now())) or (select public.is_admin()));
create policy promos_admin_insert on public.promos for insert to authenticated
with check ((select public.is_admin()));
create policy promos_admin_update on public.promos for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy promos_admin_delete on public.promos for delete to authenticated
using ((select public.is_admin()));

create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_admin_insert on public.profiles for insert to authenticated
with check ((select public.is_admin()));
create policy profiles_admin_update on public.profiles for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy profiles_admin_delete on public.profiles for delete to authenticated
using ((select public.is_admin()));

create policy orders_admin_read on public.orders for select to authenticated using ((select public.is_admin()));
create policy orders_admin_update on public.orders for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
create policy order_items_admin_read on public.order_items for select to authenticated using ((select public.is_admin()));

revoke all on table public.products, public.promos, public.profiles, public.orders, public.order_items from anon, authenticated;
grant select on public.products, public.promos to anon, authenticated;
grant insert, update, delete on public.products, public.promos to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select on public.orders, public.order_items to authenticated;
grant update (status) on public.orders to authenticated;
grant all on public.products, public.promos, public.profiles, public.orders, public.order_items to service_role;
revoke all on all tables in schema agriarmor_private from public, anon, authenticated;

create function agriarmor_private.normalize_phone(p_phone text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare v_phone text;
begin
  if p_phone is null or char_length(p_phone) > 32 or p_phone !~ '^[0-9+ ().-]+$' then
    raise exception using errcode = '22023', message = 'Enter a valid phone number.';
  end if;
  v_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
  if v_phone ~ '^09[0-9]{9}$' then v_phone := '63' || substr(v_phone, 2); end if;
  if v_phone !~ '^[0-9]{10,15}$' then
    raise exception using errcode = '22023', message = 'Enter a phone number with 10 to 15 digits.';
  end if;
  return v_phone;
end;
$$;
revoke all on function agriarmor_private.normalize_phone(text) from public, anon, authenticated;

create function agriarmor_private.consume_rate(p_scope text, p_key text, p_limit integer, p_seconds integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_hits integer;
begin
  insert into agriarmor_private.rate_limits (scope, key_hash, window_start, hits)
  values (p_scope, hashtextextended(p_key, 617), clock_timestamp(), 1)
  on conflict (scope, key_hash) do update set
    hits = case when agriarmor_private.rate_limits.window_start < clock_timestamp() - make_interval(secs => p_seconds)
      then 1 else agriarmor_private.rate_limits.hits + 1 end,
    window_start = case when agriarmor_private.rate_limits.window_start < clock_timestamp() - make_interval(secs => p_seconds)
      then clock_timestamp() else agriarmor_private.rate_limits.window_start end
  returning hits into v_hits;
  if v_hits > p_limit then
    raise exception using errcode = 'P0001', message = 'Too many requests. Please try again later.';
  end if;
end;
$$;
revoke all on function agriarmor_private.consume_rate(text, text, integer, integer) from public, anon, authenticated;

create function agriarmor_private.request_key()
returns text
language plpgsql stable set search_path = ''
as $$
declare v_headers jsonb;
begin
  v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  -- Supabase's reverse proxy provides these headers. No IP is stored verbatim.
  return coalesce(nullif(v_headers ->> 'cf-connecting-ip', ''),
    nullif(v_headers ->> 'x-real-ip', ''),
    nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''), 'local');
end;
$$;
revoke all on function agriarmor_private.request_key() from public, anon, authenticated;

create function agriarmor_private.calculate_quote(
  p_items jsonb, p_promo_code text, p_fulfillment_type text, p_lock boolean default false
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_item jsonb;
  v_product public.products%rowtype;
  v_promo public.promos%rowtype;
  v_id uuid;
  v_quantity integer;
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_fee numeric(12,2) := 0;
  v_lines jsonb := '[]'::jsonb;
  v_ids uuid[] := '{}'::uuid[];
begin
  if p_fulfillment_type is null or p_fulfillment_type not in ('delivery', 'pickup') then
    raise exception using errcode = '22023', message = 'Choose delivery or pickup.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or pg_column_size(p_items) > 16000 then
    raise exception using errcode = '22023', message = 'Your cart must contain a list of products.';
  end if;
  if jsonb_array_length(p_items) not between 1 and 32 then
    raise exception using errcode = '22023', message = 'Your cart must contain 1 to 32 products.';
  end if;
  -- Stable lock ordering prevents deadlocks when two carts share products.
  for v_item in select value from jsonb_array_elements(p_items) order by value ->> 'product_id'
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item -> 'product_id') is distinct from 'string'
      or coalesce(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_item -> 'quantity') is distinct from 'number'
      or coalesce(v_item ->> 'quantity', '') !~ '^[1-9][0-9]?$' then
      raise exception using errcode = '22023', message = 'Each cart item needs a product ID and quantity from 1 to 99.';
    end if;
    v_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_id = any(v_ids) then
      raise exception using errcode = '22023', message = 'Combine duplicate products into one cart item.';
    end if;
    v_ids := array_append(v_ids, v_id);
    if p_lock then
      select * into v_product from public.products where id = v_id for update;
    else
      select * into v_product from public.products where id = v_id;
    end if;
    if not found or not v_product.is_available then
      raise exception using errcode = '22023', message = 'A product in your cart is no longer available.';
    end if;
    if v_product.stock < v_quantity then
      raise exception using errcode = '22023', message = 'There is not enough stock for ' || v_product.name || '.';
    end if;
    v_subtotal := v_subtotal + v_product.price * v_quantity;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id, 'name_snapshot', v_product.name,
      'price_snapshot', v_product.price, 'quantity', v_quantity
    ));
  end loop;
  if char_length(coalesce(p_promo_code, '')) > 32 then
    raise exception using errcode = '22023', message = 'Enter a valid promo code.';
  end if;
  if nullif(btrim(p_promo_code), '') is not null then
    select * into v_promo from public.promos
    where lower(code) = lower(btrim(p_promo_code)) and is_active
      and starts_at <= now() and (ends_at is null or ends_at > now());
    if not found then
      raise exception using errcode = '22023', message = 'This promo code is invalid or has expired.';
    end if;
    v_discount := least(v_subtotal, round(case when v_promo.discount_type = 'percent'
      then v_subtotal * v_promo.discount_value / 100 else v_promo.discount_value end, 2));
  end if;
  -- PHP 60 delivery; free when the discounted merchandise subtotal is PHP 499+.
  if p_fulfillment_type = 'delivery' and v_subtotal - v_discount < 499 then v_fee := 60; end if;
  return jsonb_build_object('subtotal', v_subtotal, 'discount', v_discount,
    'delivery_fee', v_fee, 'total', v_subtotal - v_discount + v_fee,
    'order_items', v_lines, 'promo_code', v_promo.code);
end;
$$;
revoke all on function agriarmor_private.calculate_quote(jsonb, text, text, boolean) from public, anon, authenticated;

create function public.quote_order(
  p_items jsonb, p_promo_code text default null, p_fulfillment_type text default 'delivery'
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_quote jsonb;
begin
  perform agriarmor_private.consume_rate('quote', agriarmor_private.request_key(), 120, 60);
  v_quote := agriarmor_private.calculate_quote(p_items, p_promo_code, p_fulfillment_type, false);
  return v_quote - 'order_items' - 'promo_code';
end;
$$;
revoke all on function public.quote_order(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.quote_order(jsonb, text, text) to anon, authenticated;

create function agriarmor_private.order_dto(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select (to_jsonb(o) - 'client_request_id' - 'payment_proof_url') ||
    jsonb_build_object('has_payment_proof', o.payment_proof_url is not null, 'order_items',
      coalesce((select jsonb_agg(to_jsonb(i) order by i.name_snapshot) from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o where o.id = p_id;
$$;
revoke all on function agriarmor_private.order_dto(uuid) from public, anon, authenticated;

create function public.place_order(
  p_order jsonb, p_items jsonb, p_promo_code text default null, p_honeypot text default ''
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text;
  v_name text;
  v_email text;
  v_fulfillment text;
  v_payment text;
  v_address text;
  v_notes text;
  v_reference text;
  v_scheduled timestamptz;
  v_request_id uuid;
  v_quote jsonb;
  v_id uuid;
  v_existing_phone text;
  v_line jsonb;
begin
  if p_honeypot is null or p_honeypot <> '' then
    raise exception using errcode = '22023', message = 'Unable to submit this order.';
  end if;
  if jsonb_typeof(p_order) is distinct from 'object' or pg_column_size(p_order) > 16000 then
    raise exception using errcode = '22023', message = 'Enter valid order details.';
  end if;
  v_phone := agriarmor_private.normalize_phone(p_order ->> 'phone');
  if nullif(p_order ->> 'client_request_id', '') is not null then
    if (p_order ->> 'client_request_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'Invalid order request. Please refresh and try again.';
    end if;
    v_request_id := (p_order ->> 'client_request_id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('order-request:' || v_request_id::text, 0));
    select id, phone into v_id, v_existing_phone from public.orders where client_request_id = v_request_id;
    if found then
      if v_existing_phone <> v_phone then
        raise exception using errcode = '22023', message = 'Invalid order request. Please refresh and try again.';
      end if;
      return agriarmor_private.order_dto(v_id);
    end if;
  end if;
  v_name := btrim(p_order ->> 'customer_name');
  v_email := nullif(btrim(p_order ->> 'email'), '');
  v_fulfillment := p_order ->> 'fulfillment_type';
  v_payment := p_order ->> 'payment_method';
  v_address := nullif(btrim(p_order ->> 'address'), '');
  v_notes := nullif(btrim(p_order ->> 'notes'), '');
  v_reference := nullif(btrim(p_order ->> 'payment_reference'), '');
  if v_name is null or char_length(v_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Enter your full name (2 to 120 characters).';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception using errcode = '22023', message = 'Enter a valid email address.';
  end if;
  if v_fulfillment is null or v_fulfillment not in ('delivery', 'pickup') then
    raise exception using errcode = '22023', message = 'Choose delivery or pickup.';
  end if;
  if v_fulfillment = 'delivery' and (v_address is null or char_length(v_address) not between 10 and 1000) then
    raise exception using errcode = '22023', message = 'Enter a complete delivery address (10 to 1000 characters).';
  end if;
  if char_length(coalesce(v_notes, '')) > 1500 or char_length(coalesce(v_reference, '')) > 120 then
    raise exception using errcode = '22023', message = 'Your notes or payment reference are too long.';
  end if;
  if v_payment is null or v_payment not in ('cod', 'gcash', 'bank_transfer', 'pay_on_pickup')
    or (v_payment = 'cod' and v_fulfillment <> 'delivery')
    or (v_payment = 'pay_on_pickup' and v_fulfillment <> 'pickup') then
    raise exception using errcode = '22023', message = 'Choose a payment method that matches your delivery or pickup choice.';
  end if;
  if nullif(p_order ->> 'scheduled_at', '') is not null then
    begin
      v_scheduled := (p_order ->> 'scheduled_at')::timestamptz;
    exception when others then
      raise exception using errcode = '22023', message = 'Enter a valid preferred date and time.';
    end;
    if v_scheduled < now() - interval '5 minutes' or v_scheduled > now() + interval '365 days' then
      raise exception using errcode = '22023', message = 'Choose a preferred date within the next year.';
    end if;
  end if;
  perform agriarmor_private.consume_rate('checkout-ip', agriarmor_private.request_key(), 15, 900);
  perform agriarmor_private.consume_rate('checkout-phone', v_phone, 3, 900);
  v_quote := agriarmor_private.calculate_quote(p_items, p_promo_code, v_fulfillment, true);
  insert into public.orders (
    client_request_id, customer_name, phone, email, fulfillment_type, address, scheduled_at,
    notes, payment_method, payment_reference, promo_code, subtotal, discount, delivery_fee, total
  ) values (
    v_request_id, v_name, v_phone, v_email, v_fulfillment,
    case when v_fulfillment = 'delivery' then v_address else null end, v_scheduled,
    v_notes, v_payment, case when v_payment in ('gcash', 'bank_transfer') then v_reference else null end,
    v_quote ->> 'promo_code', (v_quote ->> 'subtotal')::numeric, (v_quote ->> 'discount')::numeric,
    (v_quote ->> 'delivery_fee')::numeric, (v_quote ->> 'total')::numeric
  ) returning id into v_id;
  for v_line in select value from jsonb_array_elements(v_quote -> 'order_items') loop
    insert into public.order_items (order_id, product_id, name_snapshot, price_snapshot, quantity)
    values (v_id, (v_line ->> 'product_id')::uuid, v_line ->> 'name_snapshot',
      (v_line ->> 'price_snapshot')::numeric, (v_line ->> 'quantity')::integer);
    update public.products set stock = stock - (v_line ->> 'quantity')::integer
    where id = (v_line ->> 'product_id')::uuid;
  end loop;
  return agriarmor_private.order_dto(v_id);
end;
$$;
revoke all on function public.place_order(jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.place_order(jsonb, jsonb, text, text) to anon, authenticated;

create function public.track_order(p_order_number text, p_phone text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_phone text; v_id uuid;
begin
  perform agriarmor_private.consume_rate('tracking', agriarmor_private.request_key(), 30, 600);
  if p_order_number is null or char_length(p_order_number) > 64 then return null; end if;
  v_phone := agriarmor_private.normalize_phone(p_phone);
  select id into v_id from public.orders
  where order_number = upper(btrim(p_order_number)) and phone = v_phone;
  if not found then return null; end if;
  return agriarmor_private.order_dto(v_id);
end;
$$;
revoke all on function public.track_order(text, text) from public, anon, authenticated;
grant execute on function public.track_order(text, text) to anon, authenticated;

-- Defense in depth: clients can change only status, along valid transitions.
-- SECURITY INVOKER preserves current_user: internal SECURITY DEFINER RPCs run
-- as postgres, while API table updates run as authenticated.
create function agriarmor_private.guard_order_update()
returns trigger
language plpgsql set search_path = ''
as $$
declare v_item record;
begin
  if current_user in ('anon', 'authenticated') then
    if not public.is_admin() then
      raise exception using errcode = '42501', message = 'Only administrators can update orders.';
    end if;
    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception using errcode = '42501', message = 'Order details and totals are immutable.';
    end if;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  if not (
    (old.status = 'pending' and new.status in ('confirmed', 'cancelled')) or
    (old.status = 'confirmed' and new.status in ('preparing', 'cancelled')) or
    (old.status = 'preparing' and (new.status = 'cancelled'
      or (new.fulfillment_type = 'delivery' and new.status = 'out_for_delivery')
      or (new.fulfillment_type = 'pickup' and new.status = 'ready'))) or
    (old.status in ('ready', 'out_for_delivery') and new.status in ('completed', 'cancelled'))
  ) then
    raise exception using errcode = '22023', message = 'This order status transition is not allowed.';
  end if;
  if new.status = 'cancelled' then
    -- The order row lock serializes concurrent cancellation. Terminal states
    -- cannot transition again, so stock is restored exactly once.
    for v_item in select product_id, quantity from public.order_items
      where order_id = old.id and product_id is not null order by product_id loop
      update public.products set stock = stock + v_item.quantity where id = v_item.product_id;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function agriarmor_private.guard_order_update() from public, anon, authenticated;
create trigger orders_guard_update before update on public.orders
for each row execute function agriarmor_private.guard_order_update();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function public.create_payment_proof_upload(p_order_number text, p_phone text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_order public.orders%rowtype; v_phone text; v_path text;
begin
  perform agriarmor_private.consume_rate('proof-ticket', agriarmor_private.request_key(), 10, 900);
  v_phone := agriarmor_private.normalize_phone(p_phone);
  if p_order_number is null or char_length(p_order_number) > 64 then
    raise exception using errcode = '22023', message = 'Order not found or proof upload is unavailable.';
  end if;
  select * into v_order from public.orders
    where order_number = upper(btrim(p_order_number)) and phone = v_phone for update;
  if not found or v_order.payment_method not in ('gcash', 'bank_transfer')
    or v_order.status in ('completed', 'cancelled') or v_order.payment_proof_url is not null then
    raise exception using errcode = '22023', message = 'Order not found or proof upload is unavailable.';
  end if;
  select path into v_path from agriarmor_private.proof_uploads
  where order_id = v_order.id and consumed_at is null and expires_at > now()
  order by created_at desc limit 1;
  if v_path is null then
    if (select count(*) from agriarmor_private.proof_uploads where order_id = v_order.id) >= 3 then
      raise exception using errcode = '22023', message = 'Please contact AgriArmor for help uploading payment proof.';
    end if;
    v_path := v_order.id::text || '/' || gen_random_uuid()::text;
    insert into agriarmor_private.proof_uploads (path, order_id, expires_at)
    values (v_path, v_order.id, now() + interval '15 minutes');
  end if;
  return jsonb_build_object('path', v_path);
end;
$$;
revoke all on function public.create_payment_proof_upload(text, text) from public, anon, authenticated;
grant execute on function public.create_payment_proof_upload(text, text) to anon, authenticated;

-- An unguessable, expiring, single-object write capability. This reveals no
-- order details and grants no listing, reading, overwriting, or deletion.
create function public.can_upload_payment_proof(p_path text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from agriarmor_private.proof_uploads t
    join public.orders o on o.id = t.order_id
    where t.path = p_path and t.expires_at > now() and t.consumed_at is null
      and o.payment_proof_url is null and o.status not in ('completed', 'cancelled')
      and o.payment_method in ('gcash', 'bank_transfer')
  );
$$;
revoke all on function public.can_upload_payment_proof(text) from public, anon, authenticated;
grant execute on function public.can_upload_payment_proof(text) to anon, authenticated;

create function public.attach_payment_proof(p_order_number text, p_phone text, p_path text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_order public.orders%rowtype; v_phone text; v_ticket agriarmor_private.proof_uploads%rowtype;
begin
  perform agriarmor_private.consume_rate('proof-attach', agriarmor_private.request_key(), 15, 900);
  v_phone := agriarmor_private.normalize_phone(p_phone);
  if p_path is null or char_length(p_path) > 100 or p_order_number is null or char_length(p_order_number) > 64 then
    raise exception using errcode = '22023', message = 'Unable to attach payment proof.';
  end if;
  select * into v_order from public.orders
  where order_number = upper(btrim(p_order_number)) and phone = v_phone for update;
  if not found or v_order.payment_method not in ('gcash', 'bank_transfer')
    or v_order.status in ('completed', 'cancelled') then
    raise exception using errcode = '22023', message = 'Unable to attach payment proof.';
  end if;
  -- Retrying a successful attachment is safe after a lost network response.
  if v_order.payment_proof_url = p_path then return true; end if;
  if v_order.payment_proof_url is not null then
    raise exception using errcode = '22023', message = 'Payment proof is already attached.';
  end if;
  select * into v_ticket from agriarmor_private.proof_uploads
  where path = p_path and order_id = v_order.id and consumed_at is null and expires_at > now() for update;
  if not found or not exists (select 1 from storage.objects
    where bucket_id = 'payment-proofs' and name = p_path
      and metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
      and (metadata ->> 'size')::bigint between 1 and 5242880) then
    raise exception using errcode = '22023', message = 'Upload an image before attaching payment proof.';
  end if;
  update public.orders set payment_proof_url = p_path where id = v_order.id;
  update agriarmor_private.proof_uploads set consumed_at = now() where path = p_path;
  return true;
end;
$$;
revoke all on function public.attach_payment_proof(text, text, text) from public, anon, authenticated;
grant execute on function public.attach_payment_proof(text, text, text) to anon, authenticated;

create policy agriarmor_product_images_read on storage.objects for select to anon, authenticated
using (bucket_id = 'product-images');
create policy agriarmor_storage_admin_read on storage.objects for select to authenticated
using (bucket_id in ('product-images', 'payment-proofs') and (select public.is_admin()));
create policy agriarmor_storage_admin_insert on storage.objects for insert to authenticated
with check (bucket_id in ('product-images', 'payment-proofs') and (select public.is_admin()));
create policy agriarmor_storage_admin_update on storage.objects for update to authenticated
using (bucket_id in ('product-images', 'payment-proofs') and (select public.is_admin()))
with check (bucket_id in ('product-images', 'payment-proofs') and (select public.is_admin()));
create policy agriarmor_storage_admin_delete on storage.objects for delete to authenticated
using (bucket_id in ('product-images', 'payment-proofs') and (select public.is_admin()));
create policy agriarmor_payment_proof_capability_insert on storage.objects for insert to anon, authenticated
with check (bucket_id = 'payment-proofs' and public.can_upload_payment_proof(name));

comment on function public.place_order(jsonb, jsonb, text, text) is
  'Atomic checkout: validates inputs, locks stock, calculates totals, reserves inventory, snapshots items. Client totals are ignored.';
comment on function public.track_order(text, text) is
  'Guest tracking using an unguessable order number and normalized phone. No public table SELECT is allowed.';
comment on column public.orders.payment_proof_url is 'Private payment-proofs bucket path. Never expose a public proof URL.';

commit;
