-- Existing installations: run this once to add customer tracking.
-- New installations: schema.sql already includes this function.
create or replace function public.track_order(p_request_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'reference',o.reference,'status',o.status,'fulfillment',o.fulfillment,
  'items',o.items,'subtotal',o.subtotal,'delivery_fee',o.delivery_fee,
  'total',o.subtotal+o.delivery_fee,'payment_status',o.payment_status,
  'created_at',o.created_at,'updated_at',o.updated_at
 ) from public.orders o where o.request_id=p_request_id;
$$;
-- Public clients cannot query orders or call this lookup directly.
-- Netlify validates the private UUID link and invokes it with its server key.
revoke all on function public.track_order(uuid) from public,anon,authenticated;
grant execute on function public.track_order(uuid) to service_role;
