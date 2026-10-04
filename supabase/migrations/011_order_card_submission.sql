begin;

create or replace function public.submit_order_card(
  p_request_id uuid,p_customer jsonb,p_items jsonb,p_fingerprint text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  existing public.orders%rowtype; saved public.orders%rowtype; settings public.shop_settings%rowtype;
  product_row public.products%rowtype; group_row public.product_option_groups%rowtype;
  choice_row public.product_option_choices%rowtype; source_product public.products%rowtype;
  item jsonb; option_input jsonb; choice_id_text text;
  item_options jsonb; group_choices jsonb; item_extras jsonb; snapshot jsonb='[]'; snapshot_item jsonb;
  request_payload jsonb; quantity integer; selection_count integer; group_charge integer;
  unit_price integer; subtotal integer=0; fee integer=0; reference_value text; order_id uuid;
  group_count integer; option_count integer; category_name text;
  v_name text=trim(coalesce(p_customer->>'name',''));
  v_phone text=trim(coalesce(p_customer->>'phone',''));
  v_fulfillment text=coalesce(p_customer->>'fulfillment','');
  v_address text=trim(coalesce(p_customer->>'address',''));
  v_notes text=trim(coalesce(p_customer->>'notes',''));
begin
  if p_request_id is null or p_fingerprint is null or length(p_fingerprint)<>64 then raise exception 'Invalid order request'; end if;
  if length(v_name) not between 1 and 80 or v_phone !~ '^[+0-9() .-]{7,30}$'
     or v_fulfillment not in ('Pickup','Delivery') or length(v_address)>300 or length(v_notes)>500
     or (v_fulfillment='Delivery' and length(v_address)<5) then raise exception 'Check your customer details'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Choose between 1 and 50 different items'; end if;
  request_payload=jsonb_build_object('customer',p_customer,'items',p_items);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into existing from public.orders where request_id=p_request_id for update;
  if found then
    if existing.request_payload<>request_payload then raise exception 'Order details changed; generate a new order card'; end if;
    return jsonb_build_object('reference',existing.reference,'tracking_token',existing.request_id,'items',existing.items,
      'subtotal',existing.subtotal,'delivery_fee',existing.delivery_fee,'total',existing.subtotal+existing.delivery_fee,
      'created_at',existing.created_at);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_fingerprint,1));
  if (select count(*) from public.orders where fingerprint=p_fingerprint and created_at>now()-interval '1 hour')>=10 then
    raise exception 'Too many order requests. Please contact the cafe.';
  end if;
  select * into settings from public.shop_settings where id=true for share;
  if not found or not settings.accepting_orders then raise exception 'Online orders are paused. Please contact the cafe.'; end if;
  if (select count(distinct (value->>'id')||'|'||coalesce(value->'options','[]'::jsonb)::text) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then
    raise exception 'Duplicate items'; end if;

  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'id','')='' or coalesce(item->>'quantity','') !~ '^[0-9]{1,2}$'
       or jsonb_typeof(item->'options') is distinct from 'array' then raise exception 'Invalid item or option choices'; end if;
    quantity=(item->>'quantity')::integer;
    if quantity not between 1 and 99 then raise exception 'Invalid item quantity'; end if;
    select * into product_row from public.products where id=item->>'id' for share;
    if not found then raise exception 'Offer % is no longer on the menu. Refresh your cart.',item->>'id'; end if;
    if not product_row.available then raise exception 'Offer % is sold out. Remove it or choose another offer.',product_row.name; end if;

    select count(*) into group_count from public.product_option_groups where product_id=product_row.id and available;
    select count(*),count(distinct value->>'group_id') into option_count,selection_count from jsonb_array_elements(item->'options');
    if option_count<>group_count or selection_count<>group_count then
      raise exception 'Options for % have changed. Refresh your cart and choose its current options.',product_row.name;
    end if;

    unit_price=product_row.price;item_options='[]';item_extras='[]';
    for group_row in select * from public.product_option_groups where product_id=product_row.id and available order by sort_order,id for share loop
      select value into option_input from jsonb_array_elements(item->'options') where value->>'group_id'=group_row.id::text;
      if option_input is null or jsonb_typeof(option_input->'choice_ids') is distinct from 'array' then
        raise exception 'Options for % have changed. Refresh your cart and choose its current options.',product_row.name;
      end if;
      selection_count=jsonb_array_length(option_input->'choice_ids');
      if selection_count<group_row.minimum_selections or selection_count>greatest(0,group_row.maximum_selections-group_row.included_selections)
        or (group_row.required and selection_count=0) then
        raise exception 'Choose the required number of paid % extras for %.',group_row.name,product_row.name;
      end if;
      if exists(select 1 from jsonb_array_elements(option_input->'choice_ids') selected(value) where jsonb_typeof(value)<>'string') then
        raise exception 'Invalid choice in % for %.',group_row.name,product_row.name;
      end if;
      if not group_row.allow_repeats and
         (select count(*) from (select value from jsonb_array_elements_text(option_input->'choice_ids') group by value) duplicates)<>selection_count then
        raise exception 'Duplicate % choices are not allowed for %.',group_row.name,product_row.name;
      end if;
      group_charge=0;group_choices='[]';
      for choice_id_text in select value from jsonb_array_elements_text(option_input->'choice_ids') loop
        begin
          select * into choice_row from public.product_option_choices
          where id=choice_id_text::uuid and group_id=group_row.id for share;
        exception when invalid_text_representation then
          raise exception 'An invalid choice was submitted for % on %.',group_row.name,product_row.name;
        end;
        if not found then raise exception 'A choice in % for % is no longer available.',group_row.name,product_row.name; end if;
        if not choice_row.available then raise exception '% in % for % is sold out.',choice_row.name,group_row.name,product_row.name; end if;
        if choice_row.source_product_id is not null then
          select * into source_product from public.products where id=choice_row.source_product_id for share;
          if not found or not source_product.available then raise exception '% in % for % is sold out.',choice_row.name,group_row.name,product_row.name; end if;
        end if;
        group_charge=group_charge+coalesce(choice_row.additional_price,0);
        group_choices=group_choices||jsonb_build_array(jsonb_build_object(
          'id',choice_row.id,'name',choice_row.name,'price',coalesce(choice_row.additional_price,0),
          'included',false,'color',choice_row.color_value));
        item_extras=item_extras||jsonb_build_array(jsonb_build_object(
          'id',choice_row.id,'group',group_row.name,'name',choice_row.name,
          'price',coalesce(choice_row.additional_price,0),'included',false,'color',choice_row.color_value));
      end loop;
      unit_price=unit_price+group_charge;
      item_options=item_options||jsonb_build_array(jsonb_build_object(
        'group_id',group_row.id,'name',group_row.name,'included',group_row.included_selections,
        'choices',group_choices,'group_total',group_charge));
    end loop;
    if subtotal::bigint+unit_price::bigint*quantity>100000000 then raise exception 'Order exceeds the online limit. Contact the cafe.'; end if;
    select title into category_name from public.categories where id=product_row.category_id;
    if category_name is null then raise exception 'Offer category is no longer available. Refresh your cart.'; end if;
    snapshot_item=jsonb_build_object(
      'id',product_row.id,'name',product_row.name,'category',category_name,
      'base_price',product_row.price,'option_total',unit_price-product_row.price,
      'price',unit_price,'quantity',quantity,'line_total',unit_price*quantity,
      'options',item_options,'extras',item_extras);
    snapshot=snapshot||jsonb_build_array(snapshot_item);
    subtotal=subtotal+unit_price*quantity;
  end loop;
  if v_fulfillment='Delivery' then fee=settings.delivery_fee; end if;
  order_id=gen_random_uuid();
  reference_value='SS-'||to_char(now() at time zone 'Africa/Lagos','YYYYMMDD')||'-'||upper(substr(replace(order_id::text,'-',''),1,12));
  insert into public.orders(id,request_id,reference,name,phone,fulfillment,address,notes,items,subtotal,delivery_fee,
    status,version,fingerprint,request_payload,payment_method,payment_status,staff_visible)
  values(order_id,p_request_id,reference_value,v_name,v_phone,v_fulfillment,
    case when v_fulfillment='Delivery' then v_address else '' end,v_notes,snapshot,subtotal,fee,
    'pending',1,p_fingerprint,request_payload,'bank_transfer','unpaid',true)
  returning * into saved;
  insert into public.audit_log(actor,action,entity_id,details)
  values(null,'order_card_submitted',saved.id::text,jsonb_build_object('subtotal',subtotal,'delivery_fee',fee));
  return jsonb_build_object('reference',saved.reference,'tracking_token',saved.request_id,'items',saved.items,
    'subtotal',saved.subtotal,'delivery_fee',saved.delivery_fee,'total',saved.subtotal+saved.delivery_fee,
    'created_at',saved.created_at);
end $$;
revoke all on function public.submit_order_card(uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.submit_order_card(uuid,jsonb,jsonb,text) to service_role;

commit;
