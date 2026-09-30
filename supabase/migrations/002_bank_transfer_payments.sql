-- Bank-transfer evidence and staff review for the existing guest-order workflow.
-- Safe to run after schema.sql/install.sql; rerunnable on an existing project.
begin;
alter table public.shop_settings
  add column if not exists bank_name text not null default '' check (length(bank_name) <= 120),
  add column if not exists account_name text not null default '' check (length(account_name) <= 120),
  add column if not exists account_number text not null default '' check (length(account_number) <= 40);

alter table public.orders
  add column if not exists payment_method text not null default 'bank_transfer' check (payment_method in ('bank_transfer'));

do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%payment_status%'
  loop
    execute format('alter table public.orders drop constraint %I', constraint_name);
  end loop;
end $$;
alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('unpaid', 'verification_pending', 'paid', 'rejected', 'refunded'));

create table if not exists public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_reference text not null default '' check (length(payment_reference) <= 120),
  receipt_path text not null unique,
  status text not null default 'verification_pending'
    check (status in ('verification_pending', 'verified', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  rejection_reason text not null default '' check (length(rejection_reason) <= 500),
  constraint payment_submission_review_check check (
    (status = 'verification_pending' and reviewed_at is null and reviewed_by is null and rejection_reason = '')
    or (status = 'verified' and reviewed_at is not null and reviewed_by is not null and rejection_reason = '')
    or (status = 'rejected' and reviewed_at is not null and reviewed_by is not null and length(trim(rejection_reason)) > 0)
  )
);
create index if not exists payment_submissions_order_idx
  on public.payment_submissions(order_id, submitted_at desc);
create index if not exists payment_submissions_status_idx
  on public.payment_submissions(status, submitted_at desc);

alter table public.payment_submissions enable row level security;
revoke all on public.payment_submissions from anon, authenticated;
grant select on public.payment_submissions to authenticated;
grant update(bank_name, account_name, account_number) on public.shop_settings to authenticated;
drop policy if exists payment_submissions_staff_read on public.payment_submissions;
create policy payment_submissions_staff_read on public.payment_submissions
  for select to authenticated using (public.is_staff());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('payment-receipts', 'payment-receipts', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];
-- No anon/authenticated storage policies: Netlify uses the server key to mint
-- one-object, short-lived upload/download URLs after checking the order token
-- or staff JWT. The bucket is never public.

create or replace function public.track_order(p_request_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id,
    'reference', o.reference,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'fulfillment', o.fulfillment,
    'items', o.items,
    'subtotal', o.subtotal,
    'delivery_fee', o.delivery_fee,
    'total', o.subtotal + o.delivery_fee,
    'status', o.status,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'payment_submission_id', latest.id,
    'payment_reference', latest.payment_reference,
    'payment_submitted_at', latest.submitted_at,
    'payment_verified_at', case when latest.status = 'verified' then latest.reviewed_at else null end,
    'payment_rejection_reason', case when latest.status = 'rejected' then latest.rejection_reason else '' end,
    'bank_name', settings.bank_name,
    'account_name', settings.account_name,
    'account_number', settings.account_number
  )
  from public.orders o
  left join lateral (
    select p.id, p.payment_reference, p.submitted_at, p.reviewed_at, p.status, p.rejection_reason
    from public.payment_submissions p
    where p.order_id = o.id
    order by p.submitted_at desc
    limit 1
  ) latest on true
  left join public.shop_settings settings on settings.id = true
  where o.request_id = p_request_id;
$$;
revoke all on function public.track_order(uuid) from public, anon, authenticated;
grant execute on function public.track_order(uuid) to service_role;

create or replace function public.customer_order_receipt(p_request_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reference', o.reference,
    'created_at', o.created_at,
    'name', o.name,
    'phone', o.phone,
    'fulfillment', o.fulfillment,
    'address', o.address,
    'items', o.items,
    'subtotal', o.subtotal,
    'delivery_fee', o.delivery_fee,
    'total', o.subtotal + o.delivery_fee,
    'status', o.status,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'payment_reference', latest.payment_reference,
    'payment_verified_at', case when latest.status = 'verified' then latest.reviewed_at else null end
  )
  from public.orders o
  left join lateral (
    select p.payment_reference, p.status, p.reviewed_at
    from public.payment_submissions p
    where p.order_id = o.id
    order by p.submitted_at desc
    limit 1
  ) latest on true
  where o.request_id = p_request_id;
$$;
revoke all on function public.customer_order_receipt(uuid) from public, anon, authenticated;
grant execute on function public.customer_order_receipt(uuid) to service_role;

-- Customer access is the unguessable private tracking token, not a customer
-- account (the current checkout has no auth.users/customer_id relationship).
create or replace function public.submit_payment_receipt(
  p_request_id uuid, p_payment_reference text, p_receipt_path text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.orders%rowtype; submission public.payment_submissions%rowtype;
begin
  if p_request_id is null or p_receipt_path is null
     or p_payment_reference is null or length(p_payment_reference) > 120 then
    raise exception 'Invalid payment submission';
  end if;
  select * into saved from public.orders where request_id = p_request_id for update;
  if not found then raise exception 'Order not found'; end if;
  if saved.payment_method <> 'bank_transfer' then raise exception 'Bank transfer is unavailable for this order'; end if;
  if saved.status = 'cancelled' then raise exception 'Cancelled orders cannot accept payment receipts'; end if;
  if saved.payment_status not in ('unpaid', 'rejected') then raise exception 'This order cannot accept another receipt'; end if;
  if p_receipt_path !~ ('^' || saved.id::text || '/[0-9a-f-]{36}\.(pdf|jpg|png)$') then
    raise exception 'Invalid receipt path';
  end if;
  insert into public.payment_submissions(order_id, payment_reference, receipt_path)
  values (saved.id, trim(p_payment_reference), p_receipt_path)
  returning * into submission;
  update public.orders set payment_status = 'verification_pending', updated_at = now()
  where id = saved.id returning * into saved;
  return jsonb_build_object(
    'id', submission.id,
    'order_id', saved.id,
    'payment_status', saved.payment_status,
    'submitted_at', submission.submitted_at
  );
end $$;
revoke all on function public.submit_payment_receipt(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_payment_receipt(uuid, text, text) to service_role;

create or replace function public.customer_payment_receipt_path(p_request_id uuid, p_submission_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare saved_path text;
begin
  select p.receipt_path into saved_path
  from public.orders o join public.payment_submissions p on p.order_id = o.id
  where o.request_id = p_request_id and p.id = p_submission_id;
  if saved_path is null then raise exception 'Receipt not found'; end if;
  return saved_path;
end $$;
revoke all on function public.customer_payment_receipt_path(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_payment_receipt_path(uuid, uuid) to service_role;

create or replace function public.staff_payment_receipt_path(p_submission_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare saved_path text;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  select receipt_path into saved_path from public.payment_submissions where id = p_submission_id;
  if saved_path is null then raise exception 'Receipt not found'; end if;
  return saved_path;
end $$;
revoke all on function public.staff_payment_receipt_path(uuid) from public, anon;
grant execute on function public.staff_payment_receipt_path(uuid) to authenticated;

create or replace function public.review_payment(
  p_submission_id uuid, p_decision text, p_reason text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare submission public.payment_submissions%rowtype; saved public.orders%rowtype;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_decision is null or p_decision not in ('verify', 'reject') or p_reason is null or length(p_reason) > 500 then
    raise exception 'Invalid payment review';
  end if;
  select * into submission from public.payment_submissions where id = p_submission_id for update;
  if not found then raise exception 'Payment submission not found'; end if;
  select * into saved from public.orders where id = submission.order_id for update;
  if submission.status <> 'verification_pending' or saved.payment_status <> 'verification_pending' then
    raise exception 'This payment has already been reviewed';
  end if;
  if p_decision = 'reject' and length(trim(p_reason)) = 0 then
    raise exception 'Enter a reason for rejecting this payment';
  end if;
  update public.payment_submissions set
    status = case when p_decision = 'verify' then 'verified' else 'rejected' end,
    reviewed_at = now(), reviewed_by = auth.uid(),
    rejection_reason = case when p_decision = 'reject' then trim(p_reason) else '' end
  where id = submission.id;
  update public.orders set
    payment_status = case when p_decision = 'verify' then 'paid' else 'rejected' end,
    updated_at = now()
  where id = saved.id returning * into saved;
  return jsonb_build_object(
    'order_id', saved.id,
    'payment_status', saved.payment_status,
    'reviewed_at', now(),
    'reviewed_by', auth.uid(),
    'rejection_reason', case when p_decision = 'reject' then trim(p_reason) else '' end
  );
end $$;
revoke all on function public.review_payment(uuid, text, text) from public, anon;
grant execute on function public.review_payment(uuid, text, text) to authenticated;

-- Preserve the existing staff order-status RPC while making payment fields
-- unmodifiable through it. Paid status can only come from review_payment.
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
  if previous.version <> p_version then raise exception 'This order changed. Refresh it before saving.'; end if;
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
