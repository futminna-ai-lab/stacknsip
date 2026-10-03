-- Allow offers to include priced, in-stock syrup/sauce and topping selections.
-- Apply after install.sql/schema.sql and migrations 002-004.
create or replace function public.submit_order(p_request_id uuid,p_customer jsonb,p_items jsonb,p_fingerprint text) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 existing public.orders%rowtype; settings public.shop_settings%rowtype; product public.products%rowtype;
 product_extra public.products%rowtype; item jsonb; extra_item jsonb; extra_match text[];
 extra_snapshot jsonb; snapshot jsonb='[]'; payload jsonb; subtotal integer=0; qty integer; fee integer=0;
 extra_total integer; syrup_count integer; topping_count integer; unit_price integer;
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
