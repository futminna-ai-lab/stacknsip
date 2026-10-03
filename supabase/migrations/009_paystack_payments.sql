begin;

do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid='public.orders'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%payment_method%'
  loop
    execute format('alter table public.orders drop constraint %I',constraint_name);
  end loop;
end $$;
alter table public.orders add constraint orders_payment_method_check
  check(payment_method in ('bank_transfer','paystack'));

create table if not exists public.paystack_transactions (
  reference text primary key check(length(reference) between 8 and 100),
  quote_id uuid not null references public.order_quotes(id) on delete restrict,
  customer_email text not null check(length(customer_email)<=254),
  amount_kobo bigint not null check(amount_kobo>0),
  currency text not null default 'NGN' check(currency='NGN'),
  status text not null default 'pending'
    check(status in ('pending','paid','paid_review','failed','resolved')),
  gateway_id text not null default '',
  order_id uuid unique references public.orders(id) on delete restrict,
  review_reason text not null default '',
  resolution_note text not null default '',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict
);
create index if not exists paystack_transactions_quote_idx on public.paystack_transactions(quote_id,created_at desc);
create index if not exists paystack_transactions_review_idx on public.paystack_transactions(status,created_at desc);
create unique index if not exists paystack_transactions_one_open_per_quote
  on public.paystack_transactions(quote_id) where status in ('pending','paid','paid_review');
alter table public.paystack_transactions enable row level security;
revoke all on public.paystack_transactions from anon,authenticated;
grant select on public.paystack_transactions to authenticated;
drop policy if exists paystack_transactions_staff_read on public.paystack_transactions;
create policy paystack_transactions_staff_read on public.paystack_transactions
  for select to authenticated using(public.is_staff());

create or replace function public.guard_quote_receipt_payment_method()
returns trigger language plpgsql security definer set search_path='' as $$
declare quote_customer jsonb;
begin
  select customer into quote_customer from public.order_quotes where id=new.quote_id;
  if coalesce(quote_customer->>'payment_method','bank_transfer')<>'bank_transfer' then
    raise exception 'A Paystack quote cannot submit a bank-transfer receipt';
  end if;
  return new;
end $$;
drop trigger if exists quote_receipt_bank_transfer_only on public.quote_upload_intents;
create trigger quote_receipt_bank_transfer_only before insert on public.quote_upload_intents
  for each row execute function public.guard_quote_receipt_payment_method();

create or replace function public.start_paystack_transaction(p_quote_id uuid,p_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare quote_row public.order_quotes%rowtype; transaction_row public.paystack_transactions%rowtype;
begin
  if p_reference !~ '^SS-[A-Fa-f0-9-]{36}$' then raise exception 'Invalid Paystack reference'; end if;
  select * into quote_row from public.order_quotes where id=p_quote_id for update;
  if not found or quote_row.status<>'quoted' then raise exception 'Quote not found or already submitted'; end if;
  if quote_row.expires_at<=now() then raise exception 'This quote expired. Prepare a new quote before paying.'; end if;
  if quote_row.customer->>'payment_method'<>'paystack' then raise exception 'This quote did not select Paystack'; end if;
  if quote_row.customer->>'email' is null or length(quote_row.customer->>'email')>254 then raise exception 'A valid email is required for Paystack'; end if;
  select * into transaction_row from public.paystack_transactions
    where quote_id=p_quote_id and status in ('pending','paid','paid_review')
    order by created_at desc limit 1 for update;
  if found then
    if transaction_row.status='pending' then
      return jsonb_build_object('reference',transaction_row.reference,'email',transaction_row.customer_email,
        'amount_kobo',transaction_row.amount_kobo,'currency',transaction_row.currency);
    end if;
    raise exception 'A payment has already been received for this quote and needs café review';
  end if;
  insert into public.paystack_transactions(reference,quote_id,customer_email,amount_kobo,status)
    values(p_reference,p_quote_id,quote_row.customer->>'email',(quote_row.subtotal::bigint+quote_row.delivery_fee::bigint)*100,'pending')
    returning * into transaction_row;
  return jsonb_build_object('reference',transaction_row.reference,'email',transaction_row.customer_email,
    'amount_kobo',transaction_row.amount_kobo,'currency',transaction_row.currency);
end $$;
revoke all on function public.start_paystack_transaction(uuid,text) from public,anon,authenticated;
grant execute on function public.start_paystack_transaction(uuid,text) to service_role;

create or replace function public.list_paystack_reviews()
returns setof public.paystack_transactions language sql stable security definer set search_path='' as $$
  select t.* from public.paystack_transactions t
  where public.is_staff() and t.status='paid_review'
  order by t.paid_at desc nulls last,t.created_at desc;
$$;
revoke all on function public.list_paystack_reviews() from public,anon;
grant execute on function public.list_paystack_reviews() to authenticated;

create or replace function public.complete_paystack_transaction(
  p_reference text,p_gateway_status text,p_amount_kobo bigint,p_currency text,p_gateway_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  transaction_row public.paystack_transactions%rowtype;
  quote_row public.order_quotes%rowtype;
  product_row public.products%rowtype;
  group_row public.product_option_groups%rowtype;
  choice_row public.product_option_choices%rowtype;
  source_product public.products%rowtype;
  item jsonb; option_row jsonb; choice jsonb;
  order_row public.orders%rowtype;
  order_id uuid; order_reference text; request_payload jsonb; unavailable text;
begin
  select * into transaction_row from public.paystack_transactions where reference=p_reference for update;
  if not found then raise exception 'Paystack reference was not issued for checkout'; end if;
  if transaction_row.status in ('paid','resolved') and transaction_row.order_id is not null then
    select * into order_row from public.orders where id=transaction_row.order_id;
    return jsonb_build_object('status','paid','reference',order_row.reference,'tracking_token',order_row.request_id,
      'total',order_row.subtotal+order_row.delivery_fee);
  end if;
  if transaction_row.status in ('paid_review','resolved') then
    return jsonb_build_object('status',transaction_row.status,'review_reason',transaction_row.review_reason);
  end if;
  if transaction_row.status<>'pending' then raise exception 'Paystack transaction is not awaiting verification'; end if;
  if lower(coalesce(p_gateway_status,''))<>'success' then
    update public.paystack_transactions set status='failed',gateway_id=coalesce(p_gateway_id,'')
      where reference=p_reference;
    return jsonb_build_object('status','failed');
  end if;
  if p_amount_kobo is distinct from transaction_row.amount_kobo or upper(coalesce(p_currency,''))<>'NGN' then
    update public.paystack_transactions set status='paid_review',gateway_id=coalesce(p_gateway_id,''),
      paid_at=now(),review_reason='Verified Paystack payment amount or currency does not match the quote.'
      where reference=p_reference;
    return jsonb_build_object('status','paid_review','review_reason','Payment details did not match the quoted total.');
  end if;
  select * into quote_row from public.order_quotes where id=transaction_row.quote_id for update;
  if not found or quote_row.status<>'quoted' or quote_row.expires_at<=now() then
    update public.paystack_transactions set status='paid_review',gateway_id=coalesce(p_gateway_id,''),
      paid_at=now(),review_reason='Payment succeeded after the quote expired or was submitted.'
      where reference=p_reference;
    return jsonb_build_object('status','paid_review','review_reason','Quote expired before payment confirmation.');
  end if;
  if exists(select 1 from public.orders where request_id=quote_row.id) then
    select * into order_row from public.orders where request_id=quote_row.id;
    update public.paystack_transactions set status='paid',gateway_id=coalesce(p_gateway_id,''),
      paid_at=coalesce(paid_at,now()),order_id=order_row.id where reference=p_reference;
    return jsonb_build_object('status','paid','reference',order_row.reference,'tracking_token',order_row.request_id,
      'total',order_row.subtotal+order_row.delivery_fee);
  end if;
  for item in select value from jsonb_array_elements(quote_row.items) loop
    select * into product_row from public.products where id=item->>'id' for share;
    if not found or not product_row.available then
      unavailable='Offer '||coalesce(product_row.name,item->>'name',item->>'id')||' became unavailable after payment.';
      exit;
    end if;
    for option_row in select value from jsonb_array_elements(item->'options') loop
      select * into group_row from public.product_option_groups where id=(option_row->>'group_id')::uuid for share;
      if not found or not group_row.available then
        unavailable=coalesce(group_row.name,option_row->>'name','An option')||' for '||product_row.name||' became unavailable after payment.';
        exit;
      end if;
      for choice in select value from jsonb_array_elements(option_row->'choices') loop
        select * into choice_row from public.product_option_choices
          where id=(choice->>'id')::uuid and group_id=group_row.id for share;
        if not found or not choice_row.available then
          unavailable=coalesce(choice_row.name,choice->>'name','A selected choice')||' in '||group_row.name||' for '||product_row.name||' became unavailable after payment.';
          exit;
        end if;
        if choice_row.source_product_id is not null then
          select * into source_product from public.products where id=choice_row.source_product_id for share;
          if not found or not source_product.available then
            unavailable=choice_row.name||' in '||group_row.name||' for '||product_row.name||' became unavailable after payment.';
            exit;
          end if;
        end if;
      end loop;
      exit when unavailable is not null;
    end loop;
    exit when unavailable is not null;
  end loop;
  if unavailable is not null then
    update public.paystack_transactions set status='paid_review',gateway_id=coalesce(p_gateway_id,''),
      paid_at=now(),review_reason=unavailable where reference=p_reference;
    return jsonb_build_object('status','paid_review','review_reason',unavailable);
  end if;
  order_id=gen_random_uuid();
  order_reference='SS-'||to_char(now() at time zone 'Africa/Lagos','YYYYMMDD')||'-'||upper(substr(replace(order_id::text,'-',''),1,8));
  request_payload=jsonb_build_object('customer',quote_row.customer,'items',quote_row.request_items,'quote_id',quote_row.id,'paystack_reference',p_reference);
  insert into public.orders(id,request_id,reference,name,phone,fulfillment,address,notes,items,subtotal,delivery_fee,
    status,version,fingerprint,request_payload,payment_method,payment_status,staff_visible)
  values(order_id,quote_row.id,order_reference,quote_row.customer->>'name',quote_row.customer->>'phone',
    quote_row.customer->>'fulfillment',coalesce(quote_row.customer->>'address',''),coalesce(quote_row.customer->>'notes',''),
    quote_row.items,quote_row.subtotal,quote_row.delivery_fee,'pending',1,quote_row.fingerprint,request_payload,
    'paystack','paid',true)
  returning * into order_row;
  update public.order_quotes set status='submitted',order_id=order_row.id where id=quote_row.id;
  update public.paystack_transactions set status='paid',gateway_id=coalesce(p_gateway_id,''),
    paid_at=now(),order_id=order_row.id where reference=p_reference;
  insert into public.audit_log(actor,action,entity_id,details)
  values(null,'paystack_order_paid',order_row.id::text,jsonb_build_object('quote_id',quote_row.id,'paystack_reference',p_reference));
  return jsonb_build_object('status','paid','reference',order_row.reference,'tracking_token',order_row.request_id,
    'total',order_row.subtotal+order_row.delivery_fee);
end $$;
revoke all on function public.complete_paystack_transaction(text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.complete_paystack_transaction(text,text,bigint,text,text) to service_role;

create or replace function public.resolve_paystack_review(p_reference text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_note is null or length(trim(p_note)) not between 1 and 500 then raise exception 'Add a resolution note'; end if;
  update public.paystack_transactions set status='resolved',resolution_note=trim(p_note),reviewed_at=now(),reviewed_by=auth.uid()
    where reference=p_reference and status='paid_review';
  if not found then raise exception 'This Paystack payment was already reviewed or not found'; end if;
  insert into public.audit_log(actor,action,entity_id,details)
    values(auth.uid(),'paystack_payment_reviewed',p_reference,jsonb_build_object('resolution_note',trim(p_note)));
end $$;
revoke all on function public.resolve_paystack_review(text,text) from public,anon;
grant execute on function public.resolve_paystack_review(text,text) to authenticated;

commit;
