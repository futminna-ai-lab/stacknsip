begin;

create or replace function public.set_order_staff_visibility()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.staff_visible = not (
    new.fulfillment = 'Delivery'
    and new.payment_method = 'bank_transfer'
    and new.payment_status = 'unpaid'
  );
  return new;
end $$;

update public.orders
set staff_visible = true
where fulfillment = 'Delivery'
  and payment_method = 'bank_transfer'
  and payment_status = 'verification_pending'
  and not staff_visible;

commit;
