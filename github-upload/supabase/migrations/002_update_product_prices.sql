-- Current RedRevive prices in Philippine pesos. Apply after the initial seed.
begin;

update public.products as product
set price = updated.price
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 75::numeric),
  ('00000000-0000-4000-8000-000000000002'::uuid, 150::numeric),
  ('00000000-0000-4000-8000-000000000003'::uuid, 300::numeric)
) as updated(id, price)
where product.id = updated.id;

commit;
