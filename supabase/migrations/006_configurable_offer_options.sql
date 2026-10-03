begin;

create table if not exists public.product_option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 80),
  required boolean not null default false,
  minimum_selections integer not null default 0 check(minimum_selections between 0 and 30),
  maximum_selections integer not null default 1 check(maximum_selections between 1 and 30),
  included_selections integer not null default 0 check(included_selections between 0 and 30),
  allow_repeats boolean not null default false,
  kind text not null default 'choice' check(kind in ('choice','color')),
  available boolean not null default true,
  sort_order integer not null default 0,
  version integer not null default 1,
  unique(product_id,name),
  check(minimum_selections <= maximum_selections),
  check(included_selections <= maximum_selections)
);
create table if not exists public.product_option_choices (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_option_groups(id) on delete cascade,
  source_product_id text references public.products(id) on delete set null,
  name text not null check(length(trim(name)) between 1 and 100),
  additional_price integer check(additional_price between 0 and 10000000),
  available boolean not null default true,
  color_value text check(color_value is null or color_value ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  version integer not null default 1,
  unique(group_id,name)
);
create index if not exists product_option_groups_product_idx on public.product_option_groups(product_id,sort_order);
create index if not exists product_option_choices_group_idx on public.product_option_choices(group_id,sort_order);

alter table public.product_option_groups enable row level security;
alter table public.product_option_choices enable row level security;
drop policy if exists offer_option_groups_public_read on public.product_option_groups;
create policy offer_option_groups_public_read on public.product_option_groups for select to anon,authenticated using(true);
drop policy if exists offer_option_groups_staff_write on public.product_option_groups;
create policy offer_option_groups_staff_write on public.product_option_groups for all to authenticated using(public.is_staff()) with check(public.is_staff());
drop policy if exists offer_option_choices_public_read on public.product_option_choices;
create policy offer_option_choices_public_read on public.product_option_choices for select to anon,authenticated using(true);
drop policy if exists offer_option_choices_staff_write on public.product_option_choices;
create policy offer_option_choices_staff_write on public.product_option_choices for all to authenticated using(public.is_staff()) with check(public.is_staff());
revoke all on public.product_option_groups,public.product_option_choices from anon,authenticated;
grant select on public.product_option_groups,public.product_option_choices to anon,authenticated;
grant insert,update,delete on public.product_option_groups,public.product_option_choices to authenticated;

create or replace function public.option_catalog_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare entity text; action_name text; row_data jsonb;
begin
  if tg_op='DELETE' then row_data=to_jsonb(old); entity=old.id::text; action_name='option_deleted';
  else row_data=to_jsonb(new); entity=new.id::text; action_name=case when tg_op='INSERT' then 'option_created' else 'option_updated' end;
    if tg_op='UPDATE' then new.version=old.version+1; new.updated_at=now(); row_data=to_jsonb(new); end if;
  end if;
  insert into public.audit_log(actor,action,entity_id,details)
  values(auth.uid(),action_name,entity,jsonb_build_object('table',tg_table_name,'row',row_data));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists option_group_audit on public.product_option_groups;
create trigger option_group_audit before insert or update or delete on public.product_option_groups
for each row execute function public.option_catalog_audit();
drop trigger if exists option_choice_audit on public.product_option_choices;
create trigger option_choice_audit before insert or update or delete on public.product_option_choices
for each row execute function public.option_catalog_audit();
alter table public.product_option_groups add column if not exists updated_at timestamptz not null default now();
alter table public.product_option_choices add column if not exists updated_at timestamptz not null default now();

create or replace function public.seed_product_option(
  p_product text,p_name text,p_min integer,p_included integer,p_max integer,
  p_required boolean,p_allow_repeats boolean,p_kind text,p_choices jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare group_id uuid; choice jsonb;
begin
  if not exists(select 1 from public.product_option_groups where product_id=p_product and name=p_name) then
    insert into public.product_option_groups(product_id,name,minimum_selections,included_selections,maximum_selections,required,allow_repeats,kind)
    values(p_product,p_name,p_min,p_included,p_max,p_required,p_allow_repeats,p_kind)
    returning id into group_id;
    for choice in select value from jsonb_array_elements(p_choices) loop
      insert into public.product_option_choices(group_id,source_product_id,name,additional_price,available,color_value,sort_order)
      values(group_id,choice->>'product_id',choice->>'name',nullif(choice->>'price','')::integer,
        coalesce((choice->>'available')::boolean,true),choice->>'color',coalesce((choice->>'sort')::integer,0));
    end loop;
  end if;
end $$;
revoke all on function public.seed_product_option(text,text,integer,integer,integer,boolean,boolean,text,jsonb) from public,anon,authenticated;

do $$
declare
  syrups jsonb; toppings jsonb; sauces jsonb; fruits jsonb; proteins jsonb; vegetables jsonb;
  option_group_id uuid;
  colors jsonb;
begin
  select jsonb_agg(jsonb_build_object('name',name,'price',price,'available',available,'sort',sort_order,'product_id',id) order by sort_order)
  into syrups from public.products where category_id='extras' and sort_order between 0 and 7;
  select jsonb_agg(jsonb_build_object('name',name,'price',price,'available',available,'sort',sort_order,'product_id',id) order by sort_order)
  into toppings from public.products where category_id='extras' and sort_order between 8 and 22;
  sauces='[{"name":"Mustard","price":null},{"name":"Ketchup","price":null},{"name":"Sweet chili","price":null},{"name":"Yum Yum","price":null},{"name":"Randy’s Ranch","price":null},{"name":"Garlic mayo","price":null},{"name":"Spicy mayo","price":null}]'::jsonb;
  fruits='[{"name":"Strawberry","price":null},{"name":"Banana","price":null},{"name":"Blueberry","price":null},{"name":"Apple","price":null}]'::jsonb;
  select jsonb_agg(jsonb_build_object('name',name,'price',price,'available',available,'sort',sort_order,'product_id',id) order by sort_order)
  into proteins from public.products where id in ('savoury-crepes:6','savoury-crepes:7','savoury-crepes:8','savoury-crepes:9','savoury-crepes:10','savoury-crepes:13','savoury-crepes:15');
  select jsonb_agg(jsonb_build_object('name',name,'price',price,'available',available,'sort',sort_order,'product_id',id) order by sort_order)
  into vegetables from public.products where id in ('savoury-crepes:11','savoury-crepes:12','savoury-crepes:14');
  colors='[{"name":"Red","color":"#D7263D"},{"name":"Pink","color":"#E94B9B"},{"name":"Orange","color":"#F28C28"},{"name":"Yellow","color":"#F4D35E"},{"name":"Green","color":"#36A269"},{"name":"Blue","color":"#2878B5"},{"name":"Purple","color":"#7952A8"},{"name":"Black","color":"#262626"},{"name":"White","color":"#FFFFFF"}]'::jsonb;

  perform public.seed_product_option('wafflin:0','Sauces',2,2,5,true,false,'choice',sauces);
  perform public.seed_product_option('bubble-drops:0','Syrups',2,2,5,true,false,'choice',syrups);
  perform public.seed_product_option('bubble-drops:0','Toppings',2,2,5,true,false,'choice',toppings);
  perform public.seed_product_option('bubble-drops:1','Syrups',3,3,6,true,false,'choice',syrups);
  perform public.seed_product_option('bubble-drops:1','Toppings',3,3,6,true,false,'choice',toppings);
  perform public.seed_product_option('bubble-drops:2','Syrups',4,4,7,true,false,'choice',syrups);
  perform public.seed_product_option('bubble-drops:2','Toppings',4,4,7,true,false,'choice',toppings);
  perform public.seed_product_option('bubble-drops:2','Fruits',3,3,3,true,false,'choice',fruits);
  perform public.seed_product_option('bubble-drops:2','Ice cream',1,1,2,true,false,'choice','[{"name":"Ice Cream Scoop","price":1500}]');
  perform public.seed_product_option('bubble-drops:2','Whipped cream',1,1,2,true,false,'choice','[{"name":"Whipped cream","price":null}]');
  perform public.seed_product_option('mini-pancakes:0','Syrups',2,2,5,true,false,'choice',syrups);
  perform public.seed_product_option('mini-pancakes:0','Toppings',2,2,5,true,false,'choice',toppings);
  perform public.seed_product_option('mini-pancakes:1','Syrups',2,2,5,true,false,'choice',syrups);
  perform public.seed_product_option('mini-pancakes:1','Toppings',2,2,5,true,false,'choice',toppings);
  perform public.seed_product_option('mini-pancakes:2','Syrups',4,4,7,true,false,'choice',syrups);
  perform public.seed_product_option('mini-pancakes:2','Toppings',4,4,7,true,false,'choice',toppings);
  perform public.seed_product_option('mini-pancakes:2','Ice cream',1,1,2,true,false,'choice','[{"name":"Ice Cream Scoop","price":1500}]');

  perform public.seed_product_option('pocket-waffles:0','Syrups',1,1,4,true,false,'choice',syrups);
  perform public.seed_product_option('pocket-waffles:0','Toppings',1,1,4,true,false,'choice',toppings);
  perform public.seed_product_option('pocket-waffles:1','Syrups',2,2,5,true,false,'choice',syrups);
  perform public.seed_product_option('pocket-waffles:1','Toppings',1,1,4,true,false,'choice',toppings);
  perform public.seed_product_option('pocket-waffles:2','Syrups',2,2,5,true,false,'choice',syrups);
  perform public.seed_product_option('pocket-waffles:2','Toppings',2,2,5,true,false,'choice',toppings);
  perform public.seed_product_option('pocket-waffles:3','Syrups',2,2,5,true,false,'choice',syrups);
  perform public.seed_product_option('pocket-waffles:3','Toppings',3,3,6,true,false,'choice',toppings);
  perform public.seed_product_option('pocket-waffles:4','Syrups',2,2,5,true,false,'choice',syrups);
  perform public.seed_product_option('pocket-waffles:4','Toppings',2,2,5,true,false,'choice',toppings);
  perform public.seed_product_option('pocket-waffles:4','Fruits',1,1,2,true,false,'choice',fruits);
  perform public.seed_product_option('pocket-waffles:4','Whipped cream',1,1,2,true,false,'choice','[{"name":"Whipped cream","price":null}]');
  perform public.seed_product_option('pocket-waffles:5','Syrups',2,2,5,true,false,'choice',syrups);
  perform public.seed_product_option('pocket-waffles:5','Toppings',2,2,5,true,false,'choice',toppings);
  perform public.seed_product_option('pocket-waffles:5','Fruits',3,3,5,true,false,'choice',fruits);
  perform public.seed_product_option('pocket-waffles:5','Ice cream',1,1,2,true,false,'choice','[{"name":"Ice Cream Scoop","price":1500}]');

  perform public.seed_product_option('oh-crepe-sweet:4','Syrups',1,1,4,true,false,'choice',syrups);
  perform public.seed_product_option('oh-crepe-sweet:4','Fruits',1,1,3,true,false,'choice',fruits);
  perform public.seed_product_option('oh-crepe-sweet:4','Toppings',1,1,4,true,false,'choice',toppings);
  perform public.seed_product_option('savoury-crepes:4','Protein',1,1,4,true,false,'choice',proteins);
  perform public.seed_product_option('savoury-crepes:4','Vegetables',2,2,5,true,false,'choice',vegetables);
  for option_group_id in select id from public.product_option_groups where product_id='savoury-crepes:4' and name='Protein' loop
    insert into public.product_option_choices(group_id,source_product_id,name,additional_price,available,sort_order)
    select option_group_id,p.id,p.name,p.price,p.available,p.sort_order from public.products p
    where p.id='savoury-crepes:5' and not exists(select 1 from public.product_option_choices c where c.group_id=option_group_id and c.source_product_id=p.id);
  end loop;
  perform public.seed_product_option('froyo:0','Toppings',1,1,4,true,false,'choice',toppings);
  perform public.seed_product_option('churros:0','Chocolate dip',0,0,3,false,true,'choice','[{"name":"Chocolate","price":800,"product_id":"churros:1"}]');
  perform public.seed_product_option('croissant-sandwiches:0','Fries',0,0,1,false,false,'choice','[{"name":"Fries","price":2000,"product_id":"croissant-sandwiches:4"}]');
  perform public.seed_product_option('croissant-sandwiches:1','Fries',0,0,1,false,false,'choice','[{"name":"Fries","price":2000,"product_id":"croissant-sandwiches:4"}]');
  perform public.seed_product_option('croissant-sandwiches:2','Fries',0,0,1,false,false,'choice','[{"name":"Fries","price":2000,"product_id":"croissant-sandwiches:4"}]');
  perform public.seed_product_option('croissant-sandwiches:3','Fries',0,0,1,false,false,'choice','[{"name":"Fries","price":2000,"product_id":"croissant-sandwiches:4"}]');
  perform public.seed_product_option('iced-coffee:6','Boba',0,0,1,false,false,'choice','[{"name":"Boba","price":2000,"product_id":"iced-coffee:8"}]');

  insert into public.product_option_groups(product_id,name,required,minimum_selections,maximum_selections,included_selections,kind,available)
  select id,'Color',false,0,1,1,'color',false from public.products
  where id in ('bubble-drops:0','bubble-drops:1','bubble-drops:2','mini-pancakes:0','mini-pancakes:1','mini-pancakes:2','pocket-waffles:2','pocket-waffles:3','pocket-waffles:4','pocket-waffles:5')
  on conflict(product_id,name) do nothing;
  insert into public.product_option_choices(group_id,name,available,color_value,sort_order)
  select g.id,c->>'name',true,c->>'color',coalesce((c->>'sort')::integer,0)
  from public.product_option_groups g cross join lateral jsonb_array_elements(colors) c
  where g.name='Color' and g.product_id in ('bubble-drops:0','bubble-drops:1','bubble-drops:2','mini-pancakes:0','mini-pancakes:1','mini-pancakes:2','pocket-waffles:2','pocket-waffles:3','pocket-waffles:4','pocket-waffles:5')
  on conflict(group_id,name) do nothing;

  update public.product_option_groups
  set required=false,minimum_selections=0
  where version=1 and included_selections>0 and name<>'Color';
end $$;
drop function public.seed_product_option(text,text,integer,integer,integer,boolean,boolean,text,jsonb);

commit;
