begin;

create table if not exists public.order_quotes (
  id uuid primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'quoted' check(status in ('quoted','submitted','expired')),
  customer jsonb not null,
  request_items jsonb not null,
  items jsonb not null,
  subtotal integer not null check(subtotal >= 0),
  delivery_fee integer not null check(delivery_fee >= 0),
  order_id uuid unique references public.orders(id) on delete restrict,
  fingerprint text not null check(length(fingerprint)=64)
);
create index if not exists order_quotes_expiry_idx on public.order_quotes(expires_at,status);
create table if not exists public.quote_upload_intents (
  id bigint generated always as identity primary key,
  quote_id uuid not null references public.order_quotes(id) on delete restrict,
  receipt_path text not null unique,
  file_type text not null check(file_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  issued_at timestamptz not null default now()
);
do $$ begin
  if to_regclass('public.expired_quote_receipts') is not null and to_regclass('public.quote_receipt_evidence') is null then
    alter table public.expired_quote_receipts rename to quote_receipt_evidence;
  end if;
end $$;
create table if not exists public.quote_receipt_evidence (
  quote_id uuid primary key references public.order_quotes(id) on delete restrict,
  receipt_path text not null unique,
  received_at timestamptz not null default now(),
  review_status text not null default 'awaiting_staff_review'
    check(review_status in ('awaiting_staff_review','resolved')),
  reason text not null default 'quote_expired' check(reason in ('quote_expired','item_unavailable')),
  resolution_note text not null default '' check(length(resolution_note)<=500),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict
);
alter table public.quote_receipt_evidence add column if not exists reason text not null default 'quote_expired';
alter table public.quote_receipt_evidence add column if not exists resolution_note text not null default '';
alter table public.quote_receipt_evidence add column if not exists reviewed_at timestamptz;
alter table public.quote_receipt_evidence add column if not exists reviewed_by uuid references auth.users(id) on delete restrict;
alter table public.order_quotes enable row level security;
alter table public.quote_upload_intents enable row level security;
alter table public.quote_receipt_evidence enable row level security;
revoke all on public.order_quotes,public.quote_upload_intents,public.quote_receipt_evidence from anon,authenticated;
grant select on public.quote_receipt_evidence to authenticated;
grant update(review_status,resolution_note,reviewed_at,reviewed_by) on public.quote_receipt_evidence to authenticated;
drop policy if exists expired_quote_evidence_staff_read on public.quote_receipt_evidence;
create policy expired_quote_evidence_staff_read on public.quote_receipt_evidence
  for select to authenticated using(public.is_staff());
grant usage,select on sequence public.quote_upload_intents_id_seq to service_role;

create or replace function public.create_order_quote(
  p_quote_id uuid,p_customer jsonb,p_items jsonb,p_fingerprint text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  previous public.order_quotes%rowtype; settings public.shop_settings%rowtype;
  item jsonb; option_input jsonb; choice_id_text text; group_row public.product_option_groups%rowtype;
  choice_row public.product_option_choices%rowtype; product_row public.products%rowtype;
  source_product_available boolean;
  item_options jsonb; group_choices jsonb; item_extras jsonb; quote_items jsonb='[]';
  selection_count integer; group_charge integer; unit_price integer;
  quantity integer; subtotal integer=0; fee integer=0; snapshot_item jsonb;
  v_name text=trim(coalesce(p_customer->>'name',''));
  v_phone text=trim(coalesce(p_customer->>'phone',''));
  v_fulfillment text=coalesce(p_customer->>'fulfillment','');
  v_address text=trim(coalesce(p_customer->>'address',''));
  v_notes text=trim(coalesce(p_customer->>'notes',''));
  v_payment_method text=coalesce(p_customer->>'payment_method','bank_transfer');
  v_email text=lower(trim(coalesce(p_customer->>'email','')));
begin
  if p_quote_id is null or p_fingerprint is null or length(p_fingerprint)<>64 then raise exception 'Invalid quote request'; end if;
  if length(v_name) not between 1 and 80 or v_phone !~ '^[+0-9() .-]{7,30}$'
     or v_fulfillment not in ('Pickup','Delivery') or length(v_address)>300 or length(v_notes)>500
     or (v_fulfillment='Delivery' and length(v_address)<5)
     or v_payment_method not in ('bank_transfer','paystack')
     or (v_payment_method='paystack' and v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$') then
    raise exception 'Check your customer details'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Choose between 1 and 50 different items'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_quote_id::text,0));
  select * into previous from public.order_quotes where id=p_quote_id for update;
  if found then
    if previous.customer<>p_customer or previous.request_items<>p_items then raise exception 'This quote reference was already used'; end if;
    if previous.status<>'quoted' or previous.expires_at<=now() then raise exception 'This quote has expired. Create a new quote before paying.'; end if;
    select * into settings from public.shop_settings where id=true;
    return jsonb_build_object('quote_id',previous.id,'expires_at',previous.expires_at,'items',previous.items,
      'subtotal',previous.subtotal,'delivery_fee',previous.delivery_fee,'total',previous.subtotal+previous.delivery_fee,
      'payment_method',v_payment_method,
      'bank_name',case when v_payment_method='bank_transfer' then coalesce(nullif(previous.bank_name,''),settings.bank_name) else null end,
      'account_name',case when v_payment_method='bank_transfer' then coalesce(nullif(previous.account_name,''),settings.account_name) else null end,
      'account_number',case when v_payment_method='bank_transfer' then coalesce(nullif(previous.account_number,''),settings.account_number) else null end,
      'payment_instructions',case when v_payment_method='bank_transfer' then coalesce(nullif(previous.payment_instructions,''),settings.payment_instructions) else null end);
  end if;
  select * into settings from public.shop_settings where id=true;
  if not found or not settings.accepting_orders then raise exception 'Online ordering is paused'; end if;
  if v_payment_method='bank_transfer' and (nullif(trim(settings.bank_name),'') is null or nullif(trim(settings.account_name),'') is null
    or nullif(trim(settings.account_number),'') is null or nullif(trim(settings.payment_instructions),'') is null) then
    raise exception 'Bank-transfer details and payment instructions are not configured. Contact the café before requesting payment.';
  end if;
  if v_fulfillment='Delivery' then fee=settings.delivery_fee; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'options')<>'array' then raise exception 'Invalid offer choices'; end if;
    quantity=(item->>'quantity')::integer;
    if quantity not between 1 and 99 then raise exception 'Invalid item quantity'; end if;
    select * into product_row from public.products where id=item->>'id' for share;
    if not found then raise exception 'Offer % is no longer on the menu. Remove it and refresh your cart.',item->>'id'; end if;
    if not product_row.available then raise exception 'Offer % is sold out. Remove it from your cart or choose another offer.',product_row.name; end if;
    unit_price=product_row.price; item_options='[]'; item_extras='[]';
    if (select count(*) from jsonb_array_elements(item->'options')) <>
       (select count(*) from public.product_option_groups g where g.product_id=product_row.id and g.available) then
      raise exception 'Options for % have changed. Refresh your cart and select its current options.',product_row.name;
    end if;
    for group_row in select * from public.product_option_groups where product_id=product_row.id and available order by sort_order,id for share loop
      select value into option_input from jsonb_array_elements(item->'options')
      where value->>'group_id'=group_row.id::text;
      if option_input is null or jsonb_typeof(option_input->'choice_ids')<>'array' then raise exception 'Options for % have changed. Refresh your cart and select its current options.',product_row.name; end if;
      selection_count=jsonb_array_length(option_input->'choice_ids');
      if selection_count<group_row.minimum_selections or selection_count>greatest(0,group_row.maximum_selections-group_row.included_selections)
        or (group_row.required and selection_count=0) then raise exception 'Choose the required number of paid % extras for %.',group_row.name,product_row.name; end if;
      if not group_row.allow_repeats and
         (select count(*) from (select value from jsonb_array_elements_text(option_input->'choice_ids') group by value) d)<>selection_count then
        raise exception 'Duplicate % choices are not allowed for %.',group_row.name,product_row.name;
      end if;
      group_charge=0; group_choices='[]';
      for choice_id_text in select value from jsonb_array_elements_text(option_input->'choice_ids') loop
        begin
          select c.* into choice_row from public.product_option_choices c
          where c.id=choice_id_text::uuid and c.group_id=group_row.id for share;
        exception when invalid_text_representation then raise exception 'An invalid choice was submitted for % on %.',group_row.name,product_row.name; end;
        if not found then raise exception 'A choice in % for % is no longer available. Remove or replace that choice.',group_row.name,product_row.name; end if;
        if not choice_row.available then raise exception '% in % for % is sold out. Remove or replace that choice.',choice_row.name,group_row.name,product_row.name; end if;
        if choice_row.source_product_id is not null then
          select available into source_product_available from public.products where id=choice_row.source_product_id for share;
          if not coalesce(source_product_available,false) then
            raise exception '% in % for % is sold out. Remove or replace that choice.',choice_row.name,group_row.name,product_row.name;
          end if;
        end if;
        if choice_row.additional_price is null then raise exception '% in % has no add-on price configured. Remove or replace that choice.',choice_row.name,group_row.name; end if;
        group_charge=group_charge+choice_row.additional_price;
        group_choices=group_choices||jsonb_build_array(jsonb_build_object(
          'id',choice_row.id,'name',choice_row.name,'price',choice_row.additional_price,
          'included',false,'color',choice_row.color_value));
        item_extras=item_extras||jsonb_build_array(jsonb_build_object(
          'id',choice_row.id,'group',group_row.name,'name',choice_row.name,
          'price',choice_row.additional_price,
          'included',false,'color',choice_row.color_value));
      end loop;
      unit_price=unit_price+group_charge;
      item_options=item_options||jsonb_build_array(jsonb_build_object(
        'group_id',group_row.id,'name',group_row.name,'included',group_row.included_selections,
        'choices',group_choices,'group_total',group_charge));
    end loop;
    if subtotal::bigint+unit_price::bigint*quantity>100000000 then raise exception 'Order exceeds the online limit. Contact the café.'; end if;
    select jsonb_build_object(
      'id',product_row.id,'name',product_row.name,'category',c.title,
      'base_price',product_row.price,'option_total',unit_price-product_row.price,
      'price',unit_price,'quantity',quantity,'line_total',unit_price*quantity,
      'options',item_options,'extras',item_extras)
    into snapshot_item from public.categories c where c.id=product_row.category_id;
    quote_items=quote_items||jsonb_build_array(snapshot_item);
    subtotal=subtotal+unit_price*quantity;
  end loop;
  insert into public.order_quotes(id,expires_at,customer,request_items,items,subtotal,delivery_fee,fingerprint,
    bank_name,account_name,account_number,payment_instructions)
  values(p_quote_id,now()+interval '30 minutes',p_customer,p_items,quote_items,subtotal,fee,p_fingerprint,
    settings.bank_name,settings.account_name,settings.account_number,settings.payment_instructions);
  insert into public.audit_log(actor,action,entity_id,details)
  values(null,'order_quote_created',p_quote_id::text,jsonb_build_object('subtotal',subtotal,'delivery_fee',fee,'expires_at',now()+interval '30 minutes'));
  return jsonb_build_object('quote_id',p_quote_id,'expires_at',now()+interval '30 minutes','items',quote_items,
    'subtotal',subtotal,'delivery_fee',fee,'total',subtotal+fee,
    'payment_method',v_payment_method,
    'bank_name',case when v_payment_method='bank_transfer' then settings.bank_name else null end,
    'account_name',case when v_payment_method='bank_transfer' then settings.account_name else null end,
    'account_number',case when v_payment_method='bank_transfer' then settings.account_number else null end,
    'payment_instructions',case when v_payment_method='bank_transfer' then settings.payment_instructions else null end);
end $$;
revoke all on function public.create_order_quote(uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_order_quote(uuid,jsonb,jsonb,text) to service_role;

create or replace function public.issue_quote_upload(p_quote_id uuid,p_path text,p_file_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare quote_row public.order_quotes%rowtype;
  replaced_paths jsonb;
begin
  select * into quote_row from public.order_quotes where id=p_quote_id for update;
  if not found or quote_row.status not in ('quoted','expired') then raise exception 'Quote not found or already submitted'; end if;
  if p_file_type not in ('application/pdf','image/jpeg','image/png','image/webp')
    or p_path !~ ('^'||p_quote_id::text||'/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$') then raise exception 'Invalid receipt upload'; end if;
  if exists(select 1 from public.quote_receipt_evidence where quote_id=p_quote_id) then
    raise exception 'Receipt evidence is already retained for staff review';
  end if;
  select coalesce(jsonb_agg(receipt_path),'[]'::jsonb) into replaced_paths
    from public.quote_upload_intents where quote_id=p_quote_id;
  delete from public.quote_upload_intents where quote_id=p_quote_id;
  insert into public.quote_upload_intents(quote_id,receipt_path,file_type) values(p_quote_id,p_path,p_file_type);
  if quote_row.expires_at<=now() then
    update public.order_quotes set status='expired' where id=p_quote_id and status='quoted';
    return jsonb_build_object('issued_at',now(),'expires_at',quote_row.expires_at,'quote_expired',true,'replaced_paths',replaced_paths);
  end if;
  if quote_row.status='expired' then raise exception 'Expired quote state is inconsistent'; end if;
  return jsonb_build_object('issued_at',now(),'expires_at',quote_row.expires_at,'quote_expired',false,'replaced_paths',replaced_paths);
end $$;
revoke all on function public.issue_quote_upload(uuid,text,text) from public,anon,authenticated;
grant execute on function public.issue_quote_upload(uuid,text,text) to service_role;

create or replace function public.validate_quote_receipt_upload(p_quote_id uuid,p_path text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare quote_row public.order_quotes%rowtype; intent public.quote_upload_intents%rowtype;
begin
  select * into quote_row from public.order_quotes where id=p_quote_id;
  if not found or quote_row.status not in ('quoted','expired') then raise exception 'Quote not found or already submitted'; end if;
  select * into intent from public.quote_upload_intents where quote_id=p_quote_id and receipt_path=p_path;
  if not found then raise exception 'Receipt upload was replaced or was not issued for this quote'; end if;
  return jsonb_build_object('file_type',intent.file_type,'quote_expired',quote_row.expires_at<=now() or quote_row.status='expired');
end $$;
revoke all on function public.validate_quote_receipt_upload(uuid,text) from public,anon,authenticated;
grant execute on function public.validate_quote_receipt_upload(uuid,text) to service_role;

create or replace function public.place_quoted_order(
  p_quote_id uuid,p_receipt_path text,p_payment_reference text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  quote_row public.order_quotes%rowtype; intent public.quote_upload_intents%rowtype;
  saved public.orders%rowtype; submission public.payment_submissions%rowtype;
  product_row public.products%rowtype; group_row public.product_option_groups%rowtype;
  choice_row public.product_option_choices%rowtype; source_product public.products%rowtype;
  item jsonb; option_input jsonb; choice jsonb;
  ref text; order_id uuid; request_payload jsonb; availability_message text;
begin
  select * into quote_row from public.order_quotes where id=p_quote_id for update;
  if not found then raise exception 'Quote not found'; end if;
  if quote_row.status='submitted' then
    select * into saved from public.orders where id=quote_row.order_id;
    return jsonb_build_object('reference',saved.reference,'tracking_token',saved.request_id,'items',saved.items,
      'subtotal',saved.subtotal,'delivery_fee',saved.delivery_fee,'total',saved.subtotal+saved.delivery_fee,'created_at',saved.created_at);
  end if;
  select * into intent from public.quote_upload_intents where quote_id=p_quote_id and receipt_path=p_receipt_path;
  if not found then raise exception 'Receipt upload was not issued for this quote'; end if;
  if p_payment_reference is null or length(p_payment_reference)>120 then raise exception 'Check the payment reference'; end if;
  if quote_row.expires_at<=now() then
    insert into public.quote_receipt_evidence(quote_id,receipt_path,reason)
    values(p_quote_id,p_receipt_path,'quote_expired')
    on conflict(quote_id) do update set receipt_path=excluded.receipt_path,received_at=now(),review_status='awaiting_staff_review',reason='quote_expired',resolution_note='',reviewed_at=null,reviewed_by=null;
    return jsonb_build_object('error_code','quote_expired','message','This quote expired before order placement. Your uploaded receipt is retained privately for café review; do not pay again. Contact the café with quote reference '||p_quote_id::text||'.');
  end if;
  if exists(select 1 from public.orders where request_id=p_quote_id) then
    select * into saved from public.orders where request_id=p_quote_id;
    return jsonb_build_object('reference',saved.reference,'tracking_token',saved.request_id,'items',saved.items,
      'subtotal',saved.subtotal,'delivery_fee',saved.delivery_fee,'total',saved.subtotal+saved.delivery_fee,'created_at',saved.created_at);
  end if;
  for item in select value from jsonb_array_elements(quote_row.items) loop
    select * into product_row from public.products where id=item->>'id' for share;
    if not found or not product_row.available then
      availability_message='Offer '||coalesce(product_row.name,item->>'name',item->>'id')||' became unavailable after your quote.';
      insert into public.quote_receipt_evidence(quote_id,receipt_path,reason)
      values(p_quote_id,p_receipt_path,'item_unavailable')
      on conflict(quote_id) do update set receipt_path=excluded.receipt_path,received_at=now(),review_status='awaiting_staff_review',reason='item_unavailable',resolution_note='',reviewed_at=null,reviewed_by=null;
      return jsonb_build_object('error_code','item_unavailable','message',availability_message||' Your receipt is retained privately for café review; do not pay again. Contact the café with quote reference '||p_quote_id::text||'.');
    end if;
    for option_input in select value from jsonb_array_elements(item->'options') loop
      select * into group_row from public.product_option_groups where id=(option_input->>'group_id')::uuid for share;
      if not found or not group_row.available then
        availability_message=coalesce(group_row.name,option_input->>'name','An option')||' options for '||product_row.name||' became unavailable after your quote.';
        insert into public.quote_receipt_evidence(quote_id,receipt_path,reason)
        values(p_quote_id,p_receipt_path,'item_unavailable')
        on conflict(quote_id) do update set receipt_path=excluded.receipt_path,received_at=now(),review_status='awaiting_staff_review',reason='item_unavailable',resolution_note='',reviewed_at=null,reviewed_by=null;
        return jsonb_build_object('error_code','item_unavailable','message',availability_message||' Your receipt is retained privately for café review; do not pay again. Contact the café with quote reference '||p_quote_id::text||'.');
      end if;
      for choice in select value from jsonb_array_elements(option_input->'choices') loop
        select * into choice_row from public.product_option_choices
        where id=(choice->>'id')::uuid and group_id=group_row.id for share;
        if not found or not choice_row.available then
          availability_message=coalesce(choice_row.name,choice->>'name','A selected choice')||' in '||group_row.name||' for '||product_row.name||' became unavailable after your quote.';
          insert into public.quote_receipt_evidence(quote_id,receipt_path,reason)
          values(p_quote_id,p_receipt_path,'item_unavailable')
          on conflict(quote_id) do update set receipt_path=excluded.receipt_path,received_at=now(),review_status='awaiting_staff_review',reason='item_unavailable',resolution_note='',reviewed_at=null,reviewed_by=null;
          return jsonb_build_object('error_code','item_unavailable','message',availability_message||' Your receipt is retained privately for café review; do not pay again. Contact the café with quote reference '||p_quote_id::text||'.');
        end if;
        if choice_row.source_product_id is not null then
          select * into source_product from public.products where id=choice_row.source_product_id for share;
          if not found or not source_product.available then
            availability_message=choice_row.name||' in '||group_row.name||' for '||product_row.name||' became unavailable after your quote.';
            insert into public.quote_receipt_evidence(quote_id,receipt_path,reason)
            values(p_quote_id,p_receipt_path,'item_unavailable')
            on conflict(quote_id) do update set receipt_path=excluded.receipt_path,received_at=now(),review_status='awaiting_staff_review',reason='item_unavailable',resolution_note='',reviewed_at=null,reviewed_by=null;
            return jsonb_build_object('error_code','item_unavailable','message',availability_message||' Your receipt is retained privately for café review; do not pay again. Contact the café with quote reference '||p_quote_id::text||'.');
          end if;
        end if;
      end loop;
    end loop;
  end loop;
  order_id=gen_random_uuid(); ref='SS-'||to_char(now() at time zone 'Africa/Lagos','YYYYMMDD')||'-'||upper(substr(replace(order_id::text,'-',''),1,8));
  request_payload=jsonb_build_object('customer',quote_row.customer,'items',quote_row.request_items,'quote_id',quote_row.id);
  insert into public.orders(id,request_id,reference,name,phone,fulfillment,address,notes,items,subtotal,delivery_fee,
    status,version,fingerprint,request_payload,payment_method,payment_status,staff_visible)
  values(order_id,p_quote_id,ref,quote_row.customer->>'name',quote_row.customer->>'phone',
    quote_row.customer->>'fulfillment',coalesce(quote_row.customer->>'address',''),coalesce(quote_row.customer->>'notes',''),
    quote_row.items,quote_row.subtotal,quote_row.delivery_fee,'pending',1,quote_row.fingerprint,request_payload,
    'bank_transfer','verification_pending',true)
  returning * into saved;
  insert into public.payment_submissions(order_id,payment_reference,receipt_path)
  values(saved.id,trim(p_payment_reference),p_receipt_path) returning * into submission;
  update public.order_quotes set status='submitted',order_id=saved.id where id=p_quote_id;
  insert into public.audit_log(actor,action,entity_id,details)
  values(null,'order_placed_after_receipt',saved.id::text,jsonb_build_object('quote_id',p_quote_id,'payment_submission_id',submission.id));
  return jsonb_build_object('reference',saved.reference,'tracking_token',saved.request_id,'items',saved.items,
    'subtotal',saved.subtotal,'delivery_fee',saved.delivery_fee,'total',saved.subtotal+saved.delivery_fee,'created_at',saved.created_at);
end $$;
revoke all on function public.place_quoted_order(uuid,text,text) from public,anon,authenticated;
grant execute on function public.place_quoted_order(uuid,text,text) to service_role;

create or replace function public.update_order(
  p_id uuid,p_version integer,p_status text,p_fee integer,p_note text,p_payment text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.orders%rowtype; updated public.orders%rowtype;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_version is null or p_status is null or p_fee is null or p_note is null or p_payment is null
    or p_status not in ('pending','confirmed','preparing','ready','completed','cancelled')
    or p_payment not in ('unpaid','verification_pending','paid','rejected','refunded')
    or p_fee not between 0 and 1000000 or length(p_note)>2000 then raise exception 'Invalid order update'; end if;
  select * into previous from public.orders where id=p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if previous.version<>p_version then raise exception 'This order changed. Refresh it before saving.'; end if;
  if p_status in ('confirmed','preparing','ready','completed') and previous.payment_status<>'paid'
    then raise exception 'Payment must be verified before fulfilment'; end if;
  if previous.payment_status='paid' and p_fee<>previous.delivery_fee then raise exception 'A verified order total cannot be changed'; end if;
  if previous.fulfillment='Pickup' and p_fee<>0 then raise exception 'Pickup cannot have a delivery fee'; end if;
  update public.orders set status=p_status,delivery_fee=p_fee,staff_note=p_note,version=version+1,updated_at=now()
    where id=p_id returning * into updated;
  insert into public.audit_log(actor,action,entity_id,details)
  values(auth.uid(),'order_updated',p_id::text,jsonb_build_object('before',jsonb_build_object('status',previous.status,'fee',previous.delivery_fee),
    'after',jsonb_build_object('status',updated.status,'fee',updated.delivery_fee)));
  return to_jsonb(updated)-'fingerprint'-'request_payload';
end $$;
revoke all on function public.update_order(uuid,integer,text,integer,text,text) from public,anon;
grant execute on function public.update_order(uuid,integer,text,integer,text,text) to authenticated;

create or replace function public.staff_expired_quote_receipt_path(p_quote_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare saved_path text;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  select receipt_path into saved_path from public.quote_receipt_evidence where quote_id=p_quote_id;
  if saved_path is null then raise exception 'Receipt not found'; end if;
  return saved_path;
end $$;
revoke all on function public.staff_expired_quote_receipt_path(uuid) from public,anon;
grant execute on function public.staff_expired_quote_receipt_path(uuid) to authenticated;

create or replace function public.resolve_expired_quote_receipt(p_quote_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare evidence public.quote_receipt_evidence%rowtype;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_note is null or length(trim(p_note)) not between 1 and 500 then raise exception 'Add a resolution note'; end if;
  update public.quote_receipt_evidence set review_status='resolved',resolution_note=trim(p_note),reviewed_at=now(),reviewed_by=auth.uid()
  where quote_id=p_quote_id and review_status='awaiting_staff_review' returning * into evidence;
  if not found then raise exception 'This receipt was already reviewed or not found'; end if;
  insert into public.audit_log(actor,action,entity_id,details)
  values(auth.uid(),'expired_quote_receipt_reviewed',p_quote_id::text,jsonb_build_object('resolution_note',evidence.resolution_note));
  return jsonb_build_object('quote_id',evidence.quote_id,'review_status',evidence.review_status,'reviewed_at',evidence.reviewed_at);
end $$;
revoke all on function public.resolve_expired_quote_receipt(uuid,text) from public,anon;
grant execute on function public.resolve_expired_quote_receipt(uuid,text) to authenticated;

revoke all on function public.submit_order(uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;

commit;
