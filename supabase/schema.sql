-- Run once in a new Supabase project's SQL Editor, then run seed.sql.
create table public.staff_members (
  email text primary key check(email = lower(email)),
  role text not null default 'staff' check(role in ('owner','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create function public.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.staff_members s join auth.users u on lower(u.email)=s.email where u.id=auth.uid() and u.email_confirmed_at is not null and s.active);
$$;
create function public.is_owner() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.staff_members s join auth.users u on lower(u.email)=s.email where u.id=auth.uid() and u.email_confirmed_at is not null and s.active and s.role='owner');
$$;
create table public.categories (
 id text primary key, title text not null, subtitle text not null default '', note text not null default '',
 photo text not null default '', photo_alt text not null default '', photo_generated boolean not null default false,
 sort_order integer not null default 0
);
create table public.products (
 id text primary key, category_id text not null references public.categories(id),
 name text not null check(length(trim(name)) between 1 and 160),
 description text not null default '' check(length(description)<=3000),
 price integer not null check(price between 0 and 10000000),
 available boolean not null default true,
 photo text not null default '' check(photo='' or photo like 'assets/%' or photo like 'https://%'),
 photo_alt text not null default '' check(length(photo_alt)<=300), photo_generated boolean not null default false,
 sort_order integer not null default 0, updated_at timestamptz not null default now(), version integer not null default 1
);
create table public.shop_settings (
 id boolean primary key default true check(id), delivery_area text not null default 'Abuja Municipal',
 delivery_fee integer not null default 6500 check(delivery_fee between 0 and 1000000),
 delivery_note text not null default 'Temporary estimate; final fee confirmed before acceptance.',
 accepting_orders boolean not null default true
);
create table public.orders (
 id uuid primary key default gen_random_uuid(), request_id uuid unique not null,
 reference text unique not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 name text not null, phone text not null, fulfillment text not null check(fulfillment in ('Pickup','Delivery')),
 address text not null default '', notes text not null default '',
 items jsonb not null, subtotal integer not null, delivery_fee integer not null,
 status text not null default 'pending' check(status in ('pending','confirmed','preparing','ready','completed','cancelled')),
 staff_note text not null default '', version integer not null default 1,
 fingerprint text not null, request_payload jsonb not null,
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','paid'))
);
create index orders_created_idx on public.orders(created_at desc);
create index orders_fingerprint_idx on public.orders(fingerprint,created_at);
create table public.audit_log (
 id bigint generated always as identity primary key, created_at timestamptz not null default now(),
 actor uuid, action text not null, entity_id text not null, details jsonb not null default '{}'
);
alter table public.staff_members enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.shop_settings enable row level security;
alter table public.orders enable row level security;
alter table public.audit_log enable row level security;
create policy staff_read on public.staff_members for select to authenticated using(public.is_staff());
create policy category_read on public.categories for select to anon,authenticated using(true);
create policy product_read on public.products for select to anon,authenticated using(true);
create policy product_change on public.products for update to authenticated using(public.is_staff()) with check(public.is_staff());
create policy settings_read on public.shop_settings for select to anon,authenticated using(true);
create policy settings_change on public.shop_settings for update to authenticated using(public.is_staff()) with check(public.is_staff());
create policy orders_read on public.orders for select to authenticated using(public.is_staff());
create policy audit_read on public.audit_log for select to authenticated using(public.is_staff());
-- Narrow grants: browser clients cannot insert orders or change staff permissions directly.
revoke all on public.staff_members,public.categories,public.products,public.shop_settings,public.orders,public.audit_log from anon,authenticated;
grant select on public.categories,public.products,public.shop_settings to anon,authenticated;
grant select on public.staff_members,public.orders,public.audit_log to authenticated;
grant update(name,description,price,available,photo,photo_alt,photo_generated) on public.products to authenticated;
grant update(delivery_fee,delivery_note,accepting_orders) on public.shop_settings to authenticated;
create function public.product_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.updated_at=now(); new.version=old.version+1;
 insert into public.audit_log(actor,action,entity_id,details) values(auth.uid(),'product_updated',new.id,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new)));
 return new;
end $$;
create trigger product_audit before update on public.products for each row execute function public.product_audit();
create function public.settings_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_log(actor,action,entity_id,details) values(auth.uid(),'settings_updated','shop',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new)));return new;
end $$;
create trigger settings_audit before update on public.shop_settings for each row execute function public.settings_audit();

-- Only the trusted Netlify function can invoke this. Prices are read from the database, never from the customer.
create function public.submit_order(p_request_id uuid,p_customer jsonb,p_items jsonb,p_fingerprint text) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 existing public.orders%rowtype; settings public.shop_settings%rowtype; product public.products%rowtype;
 item jsonb; extra_item jsonb; product_extra public.products%rowtype;
 extra_snapshot jsonb; extra_match text[]; extra_total integer;
 syrup_count integer; topping_count integer; unit_price integer;
 snapshot jsonb='[]'; payload jsonb; subtotal integer=0; qty integer; fee integer=0;
 v_name text=trim(coalesce(p_customer->>'name','')); v_phone text=trim(coalesce(p_customer->>'phone',''));
 v_type text=coalesce(p_customer->>'fulfillment',''); v_address text=trim(coalesce(p_customer->>'address',''));
 v_notes text=trim(coalesce(p_customer->>'notes','')); ref text; new_id uuid;
begin
 if p_request_id is null or p_fingerprint is null or length(p_fingerprint)<>64 then raise exception 'Invalid request';end if;
 if length(v_name) not between 1 and 80 or v_phone !~ '^[+0-9() .-]{7,30}$' or v_type not in ('Pickup','Delivery') or length(v_address)>300 or length(v_notes)>500 or (v_type='Delivery' and length(v_address)<5) then raise exception 'Check your customer details';end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Choose between 1 and 50 different items';end if;
 payload=jsonb_build_object('customer',p_customer,'items',p_items);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into existing from public.orders where request_id=p_request_id;
 if found then
   if existing.request_payload<>payload then raise exception 'Order details changed; generate a new request';end if;
   return jsonb_build_object('reference',existing.reference,'items',existing.items,'subtotal',existing.subtotal,'delivery_fee',existing.delivery_fee,'total',existing.subtotal+existing.delivery_fee,'created_at',existing.created_at);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_fingerprint,1));
 if (select count(*) from public.orders where fingerprint=p_fingerprint and created_at>now()-interval '1 hour')>=10 then raise exception 'Too many order requests. Please contact the café.';end if;
 select * into settings from public.shop_settings where id=true;
 if not found or not settings.accepting_orders then raise exception 'Online orders are paused. Please contact the café.';end if;
 if (select count(distinct (value->>'id')||'|'||coalesce(value->'extras','[]'::jsonb)::text) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Duplicate items';end if;
 for item in select value from jsonb_array_elements(p_items) loop
   if jsonb_typeof(item)<>'object' or item->>'id' is null or coalesce(item->>'quantity','') !~ '^[0-9]{1,2}$' then raise exception 'Invalid quantity';end if;
   if item ? 'extras' and jsonb_typeof(item->'extras')<>'array' then raise exception 'Invalid extras';end if;
   if jsonb_typeof(coalesce(item->'extras','[]'::jsonb))='array' and jsonb_array_length(coalesce(item->'extras','[]'::jsonb))>8 then raise exception 'Invalid extras';end if;
   qty=(item->>'quantity')::integer; if qty not between 1 and 99 then raise exception 'Invalid quantity';end if;
   select * into product from public.products where id=item->>'id' for share;
   if not found or not product.available then raise exception 'An item is unavailable. Refresh the menu.';end if;
   extra_total=0;syrup_count=0;topping_count=0;extra_snapshot='[]';
   if exists(select 1 from jsonb_array_elements_text(coalesce(item->'extras','[]'::jsonb)) selected(id) group by id having count(*)>1) then raise exception 'Invalid extras';end if;
   for extra_item in select value from jsonb_array_elements(coalesce(item->'extras','[]'::jsonb)) loop
     if jsonb_typeof(extra_item)<>'string' then raise exception 'Invalid extras';end if;
     select * into product_extra from public.products where id=extra_item#>>'{}' for share;
     if not found or not product_extra.available or product_extra.category_id<>'extras' then raise exception 'An item is unavailable. Refresh the menu.';end if;
     if product_extra.description='Sauces' then
       extra_match=regexp_match(lower(product.description),'([0-9]+)\s+(syrups?|sauces?)');
       if extra_match is null then raise exception 'Invalid extras';end if;
       syrup_count=syrup_count+1;
       if syrup_count>extra_match[1]::integer then raise exception 'Invalid extras';end if;
     elsif product_extra.description='Toppings' then
       extra_match=regexp_match(lower(product.description),'([0-9]+)\s+toppings?');
       if extra_match is null then raise exception 'Invalid extras';end if;
       topping_count=topping_count+1;
       if topping_count>extra_match[1]::integer then raise exception 'Invalid extras';end if;
     else raise exception 'Invalid extras';
     end if;
     extra_total=extra_total+product_extra.price;
     extra_snapshot=extra_snapshot||jsonb_build_array(jsonb_build_object('id',product_extra.id,'name',product_extra.name,'price',product_extra.price));
   end loop;
   extra_match=regexp_match(lower(product.description),'([0-9]+)\s+(syrups?|sauces?)');
   if syrup_count>coalesce(extra_match[1]::integer,0) then raise exception 'Invalid extras';end if;
   extra_match=regexp_match(lower(product.description),'([0-9]+)\s+toppings?');
   if topping_count>coalesce(extra_match[1]::integer,0) then raise exception 'Invalid extras';end if;
   unit_price=product.price+extra_total;
   if subtotal::bigint+unit_price::bigint*qty>100000000 then raise exception 'Order exceeds the online limit. Contact the café.';end if;
   subtotal=subtotal+unit_price*qty;
   snapshot=snapshot||jsonb_build_array(jsonb_build_object('id',product.id,'name',product.name,'category',(select title from public.categories where id=product.category_id),'price',unit_price,'quantity',qty,'extras',extra_snapshot));
 end loop;
 if v_type='Delivery' then fee=settings.delivery_fee;end if;
 new_id=gen_random_uuid();ref='SS-'||to_char(now() at time zone 'Africa/Lagos','YYYYMMDD')||'-'||upper(substr(replace(new_id::text,'-',''),1,12));
 insert into public.orders(id,request_id,reference,name,phone,fulfillment,address,notes,items,subtotal,delivery_fee,fingerprint,request_payload) values(new_id,p_request_id,ref,v_name,v_phone,v_type,case when v_type='Delivery' then v_address else '' end,v_notes,snapshot,subtotal,fee,p_fingerprint,payload);
 return jsonb_build_object('reference',ref,'items',snapshot,'subtotal',subtotal,'delivery_fee',fee,'total',subtotal+fee,'created_at',now());
end $$;
revoke all on function public.submit_order(uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.submit_order(uuid,jsonb,jsonb,text) to service_role;

-- Optimistic version check prevents one staff member silently overwriting another.
create function public.update_order(p_id uuid,p_version integer,p_status text,p_fee integer,p_note text,p_payment text) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.orders%rowtype; updated public.orders%rowtype;
begin
 if not public.is_staff() then raise exception 'Staff access required';end if;
 if p_version is null or p_status is null or p_fee is null or p_note is null or p_payment is null or p_status not in ('pending','confirmed','preparing','ready','completed','cancelled') or p_payment not in ('unpaid','paid') or p_fee not between 0 and 1000000 or length(p_note)>2000 then raise exception 'Invalid order update';end if;
 select * into previous from public.orders where id=p_id for update;
 if not found then raise exception 'Order not found';end if;
 if previous.version<>p_version then raise exception 'This order changed. Refresh it before saving.';end if;
 if previous.fulfillment='Pickup' and p_fee<>0 then raise exception 'Pickup cannot have a delivery fee';end if;
 update public.orders set status=p_status,delivery_fee=p_fee,staff_note=p_note,payment_status=p_payment,version=version+1,updated_at=now() where id=p_id returning * into updated;
 insert into public.audit_log(actor,action,entity_id,details) values(auth.uid(),'order_updated',p_id::text,jsonb_build_object('before',jsonb_build_object('status',previous.status,'fee',previous.delivery_fee,'payment',previous.payment_status),'after',jsonb_build_object('status',updated.status,'fee',updated.delivery_fee,'payment',updated.payment_status)));
 return to_jsonb(updated)-'fingerprint'-'request_payload';
end $$;
revoke all on function public.update_order(uuid,integer,text,integer,text,text) from public,anon;
grant execute on function public.update_order(uuid,integer,text,integer,text,text) to authenticated;
create function public.set_staff(p_email text,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare v_email text=lower(trim(p_email));
begin
 if not public.is_owner() then raise exception 'Owner access required';end if;
 if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Invalid email';end if;
 if exists(select 1 from public.staff_members where staff_members.email=v_email and role='owner') then raise exception 'Owner access is managed in Supabase';end if;
 insert into public.staff_members(email,role,active) values(v_email,'staff',p_active) on conflict(email) do update set active=excluded.active;
 insert into public.audit_log(actor,action,entity_id,details) values(auth.uid(),'staff_access_updated',v_email,jsonb_build_object('active',p_active));
end $$;
revoke all on function public.set_staff(text,boolean) from public,anon;
grant execute on function public.set_staff(text,boolean) to authenticated;
revoke all on function public.is_staff(),public.is_owner() from public,anon;
grant execute on function public.is_staff(),public.is_owner() to authenticated;
-- Public product pictures; writes restricted to verified staff. No SVG/HTML uploads.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('menu-images','menu-images',true,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy menu_image_insert on storage.objects for insert to authenticated with check(bucket_id='menu-images' and public.is_staff());
-- No delete permission: changing a photo cannot permanently delete another staff member's asset.
insert into public.staff_members(email,role) values('umar.umar@st.futminna.edu.ng','owner');
insert into public.shop_settings(id) values(true);

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
