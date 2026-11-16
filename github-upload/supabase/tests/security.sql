-- Run AFTER the migration and seed in Supabase SQL Editor (postgres), or:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
-- Every fixture and storage metadata row rolls back. No real blobs are written.
-- Any failed assertion aborts the transaction; a successful run prints notices.
begin;
set local statement_timeout = '30s';
set local request.headers = '{"x-real-ip":"agriarmor-security-test"}';

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000091', 'agriarmor-security-customer@example.invalid'),
  ('10000000-0000-4000-8000-000000000092', 'agriarmor-security-admin@example.invalid');
update public.profiles set role = 'admin' where id = '10000000-0000-4000-8000-000000000092';
insert into public.products (id, name, price, stock, is_available) values
  ('10000000-0000-4000-8000-000000000001', 'Security test product', 100, 8, true),
  ('10000000-0000-4000-8000-000000000002', 'Hidden test product', 200, 10, false);
insert into public.promos (id, code, discount_type, discount_value, starts_at, ends_at) values
  ('10000000-0000-4000-8000-000000000011', 'AGTEST_TEN', 'percent', 10, now() - interval '1 day', now() + interval '1 day'),
  ('10000000-0000-4000-8000-000000000012', 'AGTEST_EXPIRED', 'fixed', 30, now() - interval '2 days', now() - interval '1 day');

create temporary table agriarmor_test_context (delivery jsonb, pickup jsonb, proof_path text) on commit drop;
insert into agriarmor_test_context default values;
grant select, update on agriarmor_test_context to anon, authenticated;

set local role anon;
do $$
declare
  v_quote jsonb;
  v_order jsonb;
  v_retried jsonb;
  v_tracking jsonb;
  v_path text;
  v_request_id uuid := '10000000-0000-4000-8000-000000000083';
  v_cart jsonb := '[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":2}]';
  v_input jsonb := '{"client_request_id":"10000000-0000-4000-8000-000000000081","customer_name":"Security Test Customer","phone":"09123456001","fulfillment_type":"delivery","address":"100 Test Street, Manila","payment_method":"cod","subtotal":0,"total":0,"status":"completed"}';
begin
  if exists (select 1 from public.products where id = '10000000-0000-4000-8000-000000000002') then
    raise exception 'FAIL: unavailable products are publicly readable';
  end if;
  if exists (select 1 from public.promos where code = 'AGTEST_EXPIRED') then
    raise exception 'FAIL: expired promos are publicly readable';
  end if;
  begin
    perform 1 from public.orders;
    raise exception 'FAIL: anon has direct orders SELECT';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.orders (customer_name) values ('Forged order');
    raise exception 'FAIL: anon has direct orders INSERT';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.order_items (name_snapshot) values ('Forged item');
    raise exception 'FAIL: anon has direct order_items INSERT';
  exception when insufficient_privilege then null; end;
  begin
    perform agriarmor_private.order_dto('10000000-0000-4000-8000-000000000081');
    raise exception 'FAIL: anon can call private helpers';
  exception when insufficient_privilege then null; end;
  begin
    update public.products set price = 0;
    raise exception 'FAIL: anon can edit products';
  exception when insufficient_privilege then null; end;

  v_quote := public.quote_order(v_cart, 'agtest_ten', 'delivery');
  if (v_quote ->> 'subtotal')::numeric <> 200 or (v_quote ->> 'discount')::numeric <> 20
    or (v_quote ->> 'delivery_fee')::numeric <> 60 or (v_quote ->> 'total')::numeric <> 240 then
    raise exception 'FAIL: server quote calculation: %', v_quote;
  end if;
  v_quote := public.quote_order('[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":5}]', null, 'delivery');
  if (v_quote ->> 'delivery_fee')::numeric <> 0 then raise exception 'FAIL: free delivery threshold'; end if;
  v_quote := public.quote_order('[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":5}]', 'AGTEST_TEN', 'delivery');
  if (v_quote ->> 'delivery_fee')::numeric <> 60 then raise exception 'FAIL: threshold must use discounted subtotal'; end if;
  v_quote := public.quote_order(v_cart, null, 'pickup');
  if (v_quote ->> 'delivery_fee')::numeric <> 0 then raise exception 'FAIL: pickup must be free'; end if;
  begin
    perform public.quote_order(v_cart, 'AGTEST_EXPIRED', 'delivery');
    raise exception 'FAIL: expired promo was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.quote_order('[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":99}]');
    raise exception 'FAIL: insufficient stock was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.quote_order(v_cart || v_cart);
    raise exception 'FAIL: duplicate cart lines were accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.place_order(v_input, v_cart, null, 'spam bot');
    raise exception 'FAIL: honeypot did not reject order';
  exception when invalid_parameter_value then null; end;

  v_order := public.place_order(v_input, v_cart, 'AGTEST_TEN');
  if (v_order ->> 'total')::numeric <> 240 or v_order ->> 'status' <> 'pending'
    or v_order ->> 'phone' <> '639123456001'
    or jsonb_array_length(v_order -> 'order_items') <> 1 then
    raise exception 'FAIL: checkout trusted client totals/status or lost snapshots: %', v_order;
  end if;
  if v_order ? 'client_request_id' or v_order ? 'payment_proof_url' then
    raise exception 'FAIL: private fields leaked in customer DTO';
  end if;
  v_retried := public.place_order(v_input, v_cart, 'AGTEST_TEN');
  if v_retried ->> 'id' <> v_order ->> 'id' then raise exception 'FAIL: checkout retry created another order'; end if;
  if (select stock from public.products where id = '10000000-0000-4000-8000-000000000001') <> 6 then
    raise exception 'FAIL: inventory reservation or retry idempotency';
  end if;
  v_tracking := public.track_order(v_order ->> 'order_number', '+63 912 345 6001');
  if v_tracking ->> 'id' <> v_order ->> 'id' then raise exception 'FAIL: phone-normalized tracking'; end if;
  if public.track_order(v_order ->> 'order_number', '09123456999') is not null then
    raise exception 'FAIL: another phone could track an order';
  end if;
  begin
    perform public.create_payment_proof_upload(v_order ->> 'order_number', '09123456001');
    raise exception 'FAIL: COD order could request proof upload';
  exception when invalid_parameter_value then null; end;
  update agriarmor_test_context set delivery = v_order;

  begin
    perform public.place_order(
      '{"client_request_id":"10000000-0000-4000-8000-000000000083","customer_name":"Security Test Transfer","phone":"09123456002","fulfillment_type":"pickup","payment_method":"gcash","payment_reference":"TEST-REFERENCE"}',
      '[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":1}]'
    );
    raise exception 'FAIL: GCash order accepted without a receipt';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.place_order(
      '{"client_request_id":"10000000-0000-4000-8000-000000000084","customer_name":"Security Test Transfer","phone":"09123456002","fulfillment_type":"pickup","payment_method":"bank_transfer","payment_proof_path":"checkout/invalid"}',
      '[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":1}]'
    );
    raise exception 'FAIL: bank transfer order accepted without a reference';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.place_order(
      '{"client_request_id":"10000000-0000-4000-8000-000000000085","customer_name":"Security Test Transfer","phone":"09123456002","fulfillment_type":"pickup","payment_method":"bank_transfer","payment_reference":"TEST-REFERENCE"}',
      '[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":1}]'
    );
    raise exception 'FAIL: bank transfer order accepted without a receipt';
  exception when invalid_parameter_value then null; end;
  v_path := public.create_checkout_payment_proof_upload(v_request_id, '09123456002') ->> 'path';
  insert into storage.objects (bucket_id, name, metadata)
  values ('payment-proofs', v_path, '{"mimetype":"image/png","size":100}'::jsonb);
  if not public.checkout_payment_proof_ready(v_request_id, '09123456002', v_path)
    or not public.can_upload_payment_proof(v_path) then
    raise exception 'FAIL: upload capability not issued';
  end if;
  if public.can_upload_payment_proof('not-an-issued-capability') then
    raise exception 'FAIL: arbitrary upload paths accepted';
  end if;
  v_order := public.place_order(
    jsonb_build_object(
      'client_request_id', v_request_id, 'customer_name', 'Security Test Pickup',
      'phone', '09123456002', 'fulfillment_type', 'pickup',
      'payment_method', 'gcash', 'payment_reference', 'TEST-REFERENCE',
      'payment_proof_path', v_path
    ),
    '[{"product_id":"10000000-0000-4000-8000-000000000001","quantity":1}]'
  );
  if (v_order ->> 'total')::numeric <> 100 or not (v_order ->> 'has_payment_proof')::boolean then
    raise exception 'FAIL: transfer order was not created with its verified receipt';
  end if;
  if public.can_upload_payment_proof(v_path) then raise exception 'FAIL: consumed checkout upload capability remains valid'; end if;
  update agriarmor_test_context set pickup = v_order, proof_path = v_path;
  raise notice 'PASS: public RLS, server totals, promos, inventory, idempotency, tracking, honeypot, proof ownership';
end;
$$;

reset role;
set local role anon;
do $$
declare v_order jsonb; v_path text;
begin
  select pickup, proof_path into v_order, v_path from agriarmor_test_context;
  if exists (select 1 from storage.objects where bucket_id = 'payment-proofs' and name = v_path) then
    raise exception 'FAIL: anonymous users can read private proof metadata';
  end if;
  if not (public.track_order(v_order ->> 'order_number', '09123456002') ->> 'has_payment_proof')::boolean then
    raise exception 'FAIL: pre-uploaded receipt missing from order tracking';
  end if;
  raise notice 'PASS: private proof access and verified checkout receipt';
end;
$$;

reset role;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000091","role":"authenticated"}';
set local role authenticated;
do $$
declare v_count integer;
begin
  if public.is_admin() then raise exception 'FAIL: ordinary user is admin'; end if;
  update public.profiles set role = 'admin' where id = '10000000-0000-4000-8000-000000000091';
  if public.is_admin() then raise exception 'FAIL: ordinary user self-escalated'; end if;
  if exists (select 1 from public.orders) then raise exception 'FAIL: ordinary user can read orders'; end if;
  update public.orders set status = 'cancelled';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: ordinary user can update orders'; end if;
  update public.products set price = 0 where id = '10000000-0000-4000-8000-000000000001';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: ordinary user can update products'; end if;
  raise notice 'PASS: no role self-escalation or customer access to admin data';
end;
$$;

reset role;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000092","role":"authenticated"}';
set local role authenticated;
do $$
declare v_delivery uuid; v_pickup uuid; v_path text;
begin
  select (delivery ->> 'id')::uuid, (pickup ->> 'id')::uuid, proof_path
    into v_delivery, v_pickup, v_path from agriarmor_test_context;
  if not public.is_admin() then raise exception 'FAIL: admin role lookup'; end if;
  if not exists (select 1 from public.orders where id = v_delivery) then raise exception 'FAIL: admin cannot read orders'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'payment-proofs' and name = v_path) then
    raise exception 'FAIL: admin cannot read proof metadata';
  end if;
  begin
    update public.orders set total = 0 where id = v_delivery;
    raise exception 'FAIL: admin client can overwrite totals';
  exception when insufficient_privilege then null; end;
  begin
    update public.orders set status = 'completed' where id = v_delivery;
    raise exception 'FAIL: pending order can skip to completed';
  exception when invalid_parameter_value then null; end;
  update public.orders set status = 'confirmed' where id = v_delivery;
  update public.orders set status = 'preparing' where id = v_delivery;
  begin
    update public.orders set status = 'ready' where id = v_delivery;
    raise exception 'FAIL: delivery order can use pickup-ready status';
  exception when invalid_parameter_value then null; end;
  update public.orders set status = 'out_for_delivery' where id = v_delivery;
  update public.orders set status = 'completed' where id = v_delivery;

  update public.orders set status = 'confirmed' where id = v_pickup;
  update public.orders set status = 'preparing' where id = v_pickup;
  begin
    update public.orders set status = 'out_for_delivery' where id = v_pickup;
    raise exception 'FAIL: pickup order can use delivery status';
  exception when invalid_parameter_value then null; end;
  update public.orders set status = 'ready' where id = v_pickup;
  update public.orders set status = 'cancelled' where id = v_pickup;
  if (select stock from public.products where id = '10000000-0000-4000-8000-000000000001') <> 6 then
    raise exception 'FAIL: cancellation did not restore reserved stock';
  end if;
  update public.orders set status = 'cancelled' where id = v_pickup;
  if (select stock from public.products where id = '10000000-0000-4000-8000-000000000001') <> 6 then
    raise exception 'FAIL: duplicate cancellation restored stock twice';
  end if;
  begin
    update public.orders set status = 'confirmed' where id = v_pickup;
    raise exception 'FAIL: cancelled order can reopen';
  exception when invalid_parameter_value then null; end;
  raise notice 'PASS: admin privileges, immutable totals, fulfillment transitions, exactly-once cancellation restock';
end;
$$;

reset role;
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where (n.nspname = 'public' and c.relname in ('products','promos','profiles','orders','order_items')
      or n.nspname = 'agriarmor_private' and c.relname in ('rate_limits','proof_uploads'))
      and not c.relrowsecurity
  ) then raise exception 'FAIL: RLS disabled on an application table'; end if;
  raise notice 'PASS: RLS enabled on every application table. All fixtures will now roll back.';
end;
$$;
rollback;
