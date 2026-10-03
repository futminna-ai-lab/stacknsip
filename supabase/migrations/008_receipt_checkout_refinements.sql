begin;

alter table public.shop_settings
  add column if not exists payment_instructions text not null default '' check (length(payment_instructions) <= 2000),
  add column if not exists settings_version integer not null default 1 check (settings_version >= 1);

alter table public.order_quotes
  add column if not exists bank_name text not null default '',
  add column if not exists account_name text not null default '',
  add column if not exists account_number text not null default '',
  add column if not exists payment_instructions text not null default '';

update public.order_quotes q set
  bank_name=s.bank_name,
  account_name=s.account_name,
  account_number=s.account_number,
  payment_instructions=s.payment_instructions
from public.shop_settings s
where s.id=true and q.bank_name='' and q.account_name='' and q.account_number='';

alter table public.quote_upload_intents
  drop constraint if exists quote_upload_intents_file_type_check;
alter table public.quote_upload_intents
  add constraint quote_upload_intents_file_type_check
    check (file_type in ('application/pdf','image/jpeg','image/png','image/webp'));

update storage.buckets set allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp'],
  public=false,file_size_limit=5242880 where id='payment-receipts';

revoke select on public.shop_settings from anon,authenticated;
grant select(id,delivery_area,delivery_fee,delivery_note,accepting_orders)
  on public.shop_settings to anon,authenticated;
revoke update(bank_name,account_name,account_number,payment_instructions) on public.shop_settings from authenticated;

create or replace function public.submit_payment_receipt(
  p_request_id uuid,p_payment_reference text,p_receipt_path text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.orders%rowtype; submission public.payment_submissions%rowtype;
begin
  if p_request_id is null or p_receipt_path is null or p_payment_reference is null or length(p_payment_reference)>120 then
    raise exception 'Invalid payment submission';
  end if;
  select * into saved from public.orders where request_id=p_request_id for update;
  if not found then raise exception 'Order not found'; end if;
  if saved.payment_method<>'bank_transfer' then raise exception 'Bank transfer is unavailable for this order'; end if;
  if saved.status='cancelled' then raise exception 'Cancelled orders cannot accept payment receipts'; end if;
  if saved.payment_status not in ('unpaid','rejected') then raise exception 'This order cannot accept another receipt'; end if;
  if p_receipt_path !~ ('^'||saved.id::text||'/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$') then raise exception 'Invalid receipt path'; end if;
  insert into public.payment_submissions(order_id,payment_reference,receipt_path)
  values(saved.id,trim(p_payment_reference),p_receipt_path) returning * into submission;
  update public.orders set payment_status='verification_pending',staff_visible=true,updated_at=now()
    where id=saved.id returning * into saved;
  return jsonb_build_object('id',submission.id,'order_id',saved.id,'payment_status',saved.payment_status,'submitted_at',submission.submitted_at);
end $$;
revoke all on function public.submit_payment_receipt(uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_payment_receipt(uuid,text,text) to service_role;

create or replace function public.track_order(p_request_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',o.id,'reference',o.reference,'created_at',o.created_at,'updated_at',o.updated_at,
    'fulfillment',o.fulfillment,'items',o.items,'subtotal',o.subtotal,'delivery_fee',o.delivery_fee,
    'total',o.subtotal+o.delivery_fee,'status',o.status,'payment_method',o.payment_method,
    'payment_status',o.payment_status,'payment_submission_id',latest.id,
    'payment_reference',latest.payment_reference,'payment_submitted_at',latest.submitted_at,
    'payment_verified_at',case when latest.status='verified' then latest.reviewed_at else null end,
    'payment_rejection_reason',case when latest.status='rejected' then latest.rejection_reason else '' end,
    'bank_name',settings.bank_name,'account_name',settings.account_name,
    'account_number',settings.account_number,'payment_instructions',settings.payment_instructions)
  from public.orders o
  left join lateral (
    select p.id,p.payment_reference,p.submitted_at,p.reviewed_at,p.status,p.rejection_reason
    from public.payment_submissions p where p.order_id=o.id order by p.submitted_at desc limit 1
  ) latest on true
  left join public.shop_settings settings on settings.id=true
  where o.request_id=p_request_id;
$$;
revoke all on function public.track_order(uuid) from public,anon,authenticated;
grant execute on function public.track_order(uuid) to service_role;

create or replace function public.settings_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.settings_version=old.settings_version+1;
 insert into public.audit_log(actor,action,entity_id,details)
 values(auth.uid(),'settings_updated','shop',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new)));
 return new;
end $$;

create or replace function public.get_payment_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings public.shop_settings%rowtype;
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  select * into settings from public.shop_settings where id=true;
  if not found then raise exception 'Shop settings are unavailable'; end if;
  return jsonb_build_object('bank_name',settings.bank_name,'account_name',settings.account_name,
    'account_number',settings.account_number,'payment_instructions',settings.payment_instructions,
    'settings_version',settings.settings_version);
end $$;
revoke all on function public.get_payment_settings() from public,anon;
grant execute on function public.get_payment_settings() to authenticated;

create or replace function public.save_payment_settings(
  p_bank_name text,p_account_name text,p_account_number text,p_payment_instructions text,p_expected_version integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.shop_settings%rowtype;
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  if p_bank_name is null or length(p_bank_name)>120
    or p_account_name is null or length(p_account_name)>120
    or p_account_number is null or length(p_account_number)>40
    or p_payment_instructions is null or length(p_payment_instructions)>2000
    or p_expected_version is null then raise exception 'Check the bank transfer settings'; end if;
  select * into settings from public.shop_settings where id=true for update;
  if not found then raise exception 'Shop settings are unavailable'; end if;
  if settings.settings_version<>p_expected_version then
    raise exception 'Payment settings changed in another session. Refresh before saving.';
  end if;
  update public.shop_settings set bank_name=trim(p_bank_name),account_name=trim(p_account_name),
    account_number=trim(p_account_number),payment_instructions=trim(p_payment_instructions)
    where id=true returning * into settings;
  return jsonb_build_object('settings_version',settings.settings_version);
end $$;
revoke all on function public.save_payment_settings(text,text,text,text,integer) from public,anon;
grant execute on function public.save_payment_settings(text,text,text,text,integer) to authenticated;

commit;
