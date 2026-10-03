-- Keep new delivery orders out of the staff dashboard until their transfer receipt is saved.
-- Apply after 002_bank_transfer_payments.sql. Existing orders remain visible.
begin;

alter table public.orders
  add column if not exists staff_visible boolean not null default true;

-- RLS remains enabled; staff can read only orders released by pickup or payment submission.
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders
  for select to authenticated
  using (public.is_staff() and staff_visible);

-- Preserve whichever trusted submit_order implementation is installed (including optional card support).
create or replace function public.set_order_staff_visibility()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.staff_visible = not (new.fulfillment = 'Delivery' and new.payment_method = 'bank_transfer');
  return new;
end $$;
drop trigger if exists order_staff_visibility on public.orders;
create trigger order_staff_visibility before insert on public.orders
for each row execute function public.set_order_staff_visibility();

-- A valid receipt becomes the point at which a delivery order is sent to staff.
create or replace function public.submit_payment_receipt(
  p_request_id uuid, p_payment_reference text, p_receipt_path text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.orders%rowtype; submission public.payment_submissions%rowtype;
begin
  if p_request_id is null or p_receipt_path is null or p_payment_reference is null or length(p_payment_reference) > 120 then
    raise exception 'Invalid payment submission';
  end if;
  select * into saved from public.orders where request_id = p_request_id for update;
  if not found then raise exception 'Order not found'; end if;
  if saved.payment_method <> 'bank_transfer' then raise exception 'Bank transfer is unavailable for this order'; end if;
  if saved.status = 'cancelled' then raise exception 'Cancelled orders cannot accept payment receipts'; end if;
  if saved.payment_status not in ('unpaid', 'rejected') then raise exception 'This order cannot accept another receipt'; end if;
  if p_receipt_path !~ ('^' || saved.id::text || '/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$') then raise exception 'Invalid receipt path'; end if;
  insert into public.payment_submissions(order_id, payment_reference, receipt_path)
  values(saved.id, trim(p_payment_reference), p_receipt_path) returning * into submission;
  update public.orders set payment_status = 'verification_pending', staff_visible = true, updated_at = now()
  where id = saved.id returning * into saved;
  return jsonb_build_object('id', submission.id, 'order_id', saved.id, 'payment_status', saved.payment_status, 'submitted_at', submission.submitted_at);
end $$;
revoke all on function public.submit_payment_receipt(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_payment_receipt(uuid, text, text) to service_role;

create or replace function public.update_order(
  p_id uuid, p_version integer, p_status text, p_fee integer, p_note text, p_payment text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous public.orders%rowtype; updated public.orders%rowtype;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_version is null or p_status is null or p_fee is null or p_note is null or p_payment is null
     or p_status not in ('pending','confirmed','preparing','ready','completed','cancelled')
     or p_payment not in ('unpaid','verification_pending','paid','rejected','refunded')
     or p_fee not between 0 and 1000000 or length(p_note) > 2000 then
    raise exception 'Invalid order update';
  end if;
  select * into previous from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not previous.staff_visible then raise exception 'This delivery order is waiting for a customer payment receipt.'; end if;
  if previous.version <> p_version then raise exception 'This order changed. Refresh it before saving.'; end if;
  if p_payment <> previous.payment_status then raise exception 'Payment status must be changed through payment verification.'; end if;
  if previous.fulfillment = 'Pickup' and p_fee <> 0 then raise exception 'Pickup cannot have a delivery fee'; end if;
  update public.orders set status = p_status, delivery_fee = p_fee, staff_note = p_note,
    version = version + 1, updated_at = now()
  where id = p_id returning * into updated;
  insert into public.audit_log(actor, action, entity_id, details)
  values (auth.uid(), 'order_updated', p_id::text,
    jsonb_build_object('before', jsonb_build_object('status', previous.status, 'fee', previous.delivery_fee),
                       'after', jsonb_build_object('status', updated.status, 'fee', updated.delivery_fee)));
  return to_jsonb(updated) - 'fingerprint' - 'request_payload';
end $$;
revoke all on function public.update_order(uuid, integer, text, integer, text, text) from public, anon;
grant execute on function public.update_order(uuid, integer, text, integer, text, text) to authenticated;

commit;
