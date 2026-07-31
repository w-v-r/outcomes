create or replace function public.prevent_settled_payment_regression()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('approved', 'pending', 'settled')
    and new.status not in ('approved', 'pending', 'settled')
  then
    new.status := old.status;
    new.settled_at := old.settled_at;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_settled_payment_regression()
  from public, anon, authenticated, service_role;
