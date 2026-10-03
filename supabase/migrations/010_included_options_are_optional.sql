begin;

update public.product_option_groups
set required=false,minimum_selections=0
where included_selections>0
  and minimum_selections=included_selections
  and required;

commit;
