begin;

alter table agriarmor_private.proof_uploads
  alter column order_id drop not null,
  add column client_request_id uuid,
  add constraint proof_uploads_order_or_request_check
    check (order_id is not null or client_request_id is not null);

create function public.create_checkout_payment_proof_upload(p_request_id uuid, p_phone text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_phone text; v_path text;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Refresh checkout and try again.';
  end if;
  v_phone := agriarmor_private.normalize_phone(p_phone);
  perform agriarmor_private.consume_rate('checkout-proof', agriarmor_private.request_key(), 10, 900);
  perform agriarmor_private.consume_rate('checkout-proof-phone', v_phone, 10, 900);
  perform pg_advisory_xact_lock(hashtextextended('checkout-proof:' || p_request_id::text, 0));
  select path into v_path from agriarmor_private.proof_uploads
  where client_request_id = p_request_id and order_id is null
    and consumed_at is null and expires_at > now()
  order by created_at desc limit 1 for update;
  if v_path is null then
    if (select count(*) from agriarmor_private.proof_uploads
        where client_request_id = p_request_id) >= 3 then
      raise exception using errcode = '22023', message = 'Please contact AgriArmor for help uploading your receipt.';
    end if;
    v_path := 'checkout/' || p_request_id::text || '/' || gen_random_uuid()::text;
    insert into agriarmor_private.proof_uploads (path, client_request_id, expires_at)
    values (v_path, p_request_id, now() + interval '15 minutes');
  end if;
  return jsonb_build_object('path', v_path);
end;
$$;
revoke all on function public.create_checkout_payment_proof_upload(uuid, text) from public, anon, authenticated;
grant execute on function public.create_checkout_payment_proof_upload(uuid, text) to anon, authenticated;

create function public.checkout_payment_proof_ready(p_request_id uuid, p_phone text, p_path text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_phone text;
begin
  v_phone := agriarmor_private.normalize_phone(p_phone);
  return exists (
    select 1 from agriarmor_private.proof_uploads t
    join storage.objects o on o.bucket_id = 'payment-proofs' and o.name = t.path
    where t.path = p_path and t.client_request_id = p_request_id
      and t.order_id is null and t.consumed_at is null and t.expires_at > now()
      and o.metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
      and (o.metadata ->> 'size')::bigint between 1 and 5242880
  );
end;
$$;
revoke all on function public.checkout_payment_proof_ready(uuid, text, text) from public, anon, authenticated;
grant execute on function public.checkout_payment_proof_ready(uuid, text, text) to anon, authenticated;

create or replace function public.can_upload_payment_proof(p_path text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from agriarmor_private.proof_uploads t
    where t.path = p_path and t.expires_at > now() and t.consumed_at is null
      and (
        (t.order_id is null and t.client_request_id is not null)
        or exists (
          select 1 from public.orders o where o.id = t.order_id
            and o.payment_proof_url is null and o.status not in ('completed', 'cancelled')
            and o.payment_method in ('gcash', 'bank_transfer')
        )
      )
  );
$$;
revoke all on function public.can_upload_payment_proof(text) from public, anon, authenticated;
grant execute on function public.can_upload_payment_proof(text) to anon, authenticated;

create or replace function public.place_order(
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
  v_proof_path text;
  v_proof_ticket agriarmor_private.proof_uploads%rowtype;
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
  v_proof_path := nullif(p_order ->> 'payment_proof_path', '');
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
  if v_payment in ('gcash', 'bank_transfer') then
    if v_reference is null then
      raise exception using errcode = '22023', message = 'Enter your GCash or bank transfer reference.';
    end if;
    if v_request_id is null or v_proof_path is null or char_length(v_proof_path) > 100 then
      raise exception using errcode = '22023', message = 'Upload your payment receipt before placing the order.';
    end if;
    select * into v_proof_ticket from agriarmor_private.proof_uploads
    where path = v_proof_path and client_request_id = v_request_id
      and order_id is null and consumed_at is null and expires_at > now() for update;
    if not found or not exists (
      select 1 from storage.objects
      where bucket_id = 'payment-proofs' and name = v_proof_path
        and metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
        and (metadata ->> 'size')::bigint between 1 and 5242880
    ) then
      raise exception using errcode = '22023', message = 'Upload a valid payment receipt before placing the order.';
    end if;
  elsif v_proof_path is not null then
    raise exception using errcode = '22023', message = 'A payment receipt is only accepted for GCash or bank transfer.';
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
    notes, payment_method, payment_reference, payment_proof_url, promo_code, subtotal, discount, delivery_fee, total
  ) values (
    v_request_id, v_name, v_phone, v_email, v_fulfillment,
    case when v_fulfillment = 'delivery' then v_address else null end, v_scheduled,
    v_notes, v_payment, case when v_payment in ('gcash', 'bank_transfer') then v_reference else null end,
    v_proof_path,
    v_quote ->> 'promo_code', (v_quote ->> 'subtotal')::numeric, (v_quote ->> 'discount')::numeric,
    (v_quote ->> 'delivery_fee')::numeric, (v_quote ->> 'total')::numeric
  ) returning id into v_id;
  if v_proof_path is not null then
    update agriarmor_private.proof_uploads
    set order_id = v_id, consumed_at = now()
    where path = v_proof_ticket.path;
  end if;
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
comment on function public.place_order(jsonb, jsonb, text, text) is
  'Atomic checkout validates customer details, prices, and stock; GCash and bank transfer require a reference and verified pre-uploaded receipt.';

commit;
