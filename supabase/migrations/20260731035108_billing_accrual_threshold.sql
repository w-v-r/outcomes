alter table public.payments
  drop constraint payments_task_id_key,
  drop constraint payments_quote_id_key,
  alter column task_id drop not null,
  alter column quote_id drop not null,
  add constraint payments_id_user_key unique (id, user_id);

create table public.billing_accruals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  quote_id uuid not null,
  payment_id uuid,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'AUD' check (currency = 'AUD'),
  status text not null default 'accrued' check (
    status in ('accrued', 'charging', 'charged', 'void')
  ),
  accrued_at timestamptz not null default now(),
  charged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_accruals_task_key unique (task_id),
  constraint billing_accruals_quote_key unique (quote_id),
  constraint billing_accruals_task_owner_fkey foreign key (task_id, user_id)
    references public.tasks(id, user_id) on delete restrict,
  constraint billing_accruals_quote_owner_fkey foreign key (quote_id, user_id)
    references public.quotes(id, user_id) on delete restrict,
  constraint billing_accruals_payment_owner_fkey foreign key (
    payment_id,
    user_id
  ) references public.payments(id, user_id) on delete restrict,
  constraint billing_accruals_payment_state_check check (
    (
      status in ('accrued', 'void')
      and payment_id is null
      and charged_at is null
    )
    or (
      status = 'charging'
      and payment_id is not null
      and charged_at is null
    )
    or (
      status = 'charged'
      and payment_id is not null
      and charged_at is not null
    )
  )
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null,
  quote_id uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'AUD' check (currency = 'AUD'),
  status text not null default 'active' check (
    status in ('active', 'released')
  ),
  created_at timestamptz not null default now(),
  constraint payment_allocations_payment_task_key unique (
    payment_id,
    task_id
  ),
  constraint payment_allocations_payment_owner_fkey foreign key (
    payment_id,
    user_id
  ) references public.payments(id, user_id) on delete restrict,
  constraint payment_allocations_task_owner_fkey foreign key (
    task_id,
    user_id
  ) references public.tasks(id, user_id) on delete restrict,
  constraint payment_allocations_quote_owner_fkey foreign key (
    quote_id,
    user_id
  ) references public.quotes(id, user_id) on delete restrict
);

create index billing_accruals_outstanding_idx
  on public.billing_accruals(user_id, accrued_at, id)
  where status = 'accrued';
create index billing_accruals_payment_id_idx
  on public.billing_accruals(payment_id)
  where payment_id is not null;
create index payment_allocations_payment_id_idx
  on public.payment_allocations(payment_id);
create index payment_allocations_user_id_idx
  on public.payment_allocations(user_id, created_at desc);
create unique index payment_allocations_active_task_idx
  on public.payment_allocations(task_id)
  where status = 'active';
create unique index payment_allocations_active_quote_idx
  on public.payment_allocations(quote_id)
  where status = 'active';

create trigger billing_accruals_set_updated_at
before update on public.billing_accruals
for each row execute function public.set_updated_at();

create function public.protect_billing_accrual_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.task_id is distinct from old.task_id
    or new.quote_id is distinct from old.quote_id
    or new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
    or new.accrued_at is distinct from old.accrued_at
  then
    raise exception 'Billing accrual evidence is immutable'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger billing_accruals_protect_evidence
before update on public.billing_accruals
for each row execute function public.protect_billing_accrual_evidence();

create function public.protect_payment_allocation_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_id is distinct from old.payment_id
    or new.user_id is distinct from old.user_id
    or new.task_id is distinct from old.task_id
    or new.quote_id is distinct from old.quote_id
    or new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
  then
    raise exception 'Payment allocation evidence is immutable'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger payment_allocations_protect_evidence
before update on public.payment_allocations
for each row execute function public.protect_payment_allocation_evidence();

create function public.sync_billing_accruals_for_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  transition_now timestamptz := pg_catalog.clock_timestamp();
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status in ('approved', 'pending', 'settled') then
    update public.billing_accruals
    set
      status = 'charged',
      charged_at = coalesce(charged_at, transition_now),
      updated_at = transition_now
    where payment_id = new.id
      and user_id = new.user_id
      and status in ('charging', 'charged');
  elsif new.status = 'failed' then
    update public.billing_accruals
    set
      payment_id = null,
      status = 'accrued',
      charged_at = null,
      updated_at = transition_now
    where payment_id = new.id
      and user_id = new.user_id
      and status in ('charging', 'charged');

    update public.payment_allocations
    set status = 'released'
    where payment_id = new.id
      and user_id = new.user_id
      and status = 'active';
  end if;

  return new;
end;
$$;

create trigger payments_sync_billing_accruals
after update of status on public.payments
for each row execute function public.sync_billing_accruals_for_payment();

create function public.accrue_verified_task(p_task_id uuid)
returns table (
  accrual_id uuid,
  user_id uuid,
  amount_cents integer,
  currency text,
  status text,
  payment_id uuid,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_task public.tasks%rowtype;
  selected_quote public.quotes%rowtype;
  selected_accrual public.billing_accruals%rowtype;
  inserted_accrual boolean := false;
  transition_now timestamptz := pg_catalog.clock_timestamp();
begin
  select task.*
  into selected_task
  from public.tasks as task
  where task.id = p_task_id
  for update;

  if selected_task.id is null
    or selected_task.status not in ('verified', 'completed')
  then
    raise exception 'Only a verified task can be accrued'
      using errcode = '22023';
  end if;

  select quote.*
  into selected_quote
  from public.quotes as quote
  where quote.id = selected_task.quote_id
    and quote.user_id = selected_task.user_id
    and quote.task_id = selected_task.id
    and quote.status = 'approved';

  if selected_quote.id is null then
    raise exception 'The approved quote is unavailable'
      using errcode = '22023';
  end if;

  insert into public.billing_accruals (
    user_id,
    task_id,
    quote_id,
    amount_cents,
    currency,
    status,
    accrued_at
  ) values (
    selected_task.user_id,
    selected_task.id,
    selected_quote.id,
    selected_quote.amount_cents,
    selected_quote.currency,
    'accrued',
    transition_now
  )
  on conflict on constraint billing_accruals_task_key do nothing
  returning * into selected_accrual;

  inserted_accrual := selected_accrual.id is not null;

  if not inserted_accrual then
    select accrual.*
    into selected_accrual
    from public.billing_accruals as accrual
    where accrual.task_id = selected_task.id
      and accrual.user_id = selected_task.user_id;
  end if;

  if selected_accrual.id is null
    or selected_accrual.quote_id <> selected_quote.id
    or selected_accrual.amount_cents <> selected_quote.amount_cents
    or selected_accrual.currency <> selected_quote.currency
  then
    raise exception 'The billing accrual does not match the approved quote'
      using errcode = '22023';
  end if;

  update public.tasks
  set
    completed_at = coalesce(completed_at, transition_now),
    failed_at = null,
    failure_reason = null,
    status = 'completed',
    updated_at = transition_now
  where id = selected_task.id
    and user_id = selected_task.user_id
    and status in ('verified', 'completed');

  if inserted_accrual then
    insert into public.task_events (
      task_id,
      user_id,
      event_type,
      event_data
    ) values (
      selected_task.id,
      selected_task.user_id,
      'billing.accrued',
      pg_catalog.jsonb_build_object(
        'accrual_id', selected_accrual.id,
        'amount_cents', selected_accrual.amount_cents,
        'currency', selected_accrual.currency
      )
    );
  end if;

  return query select
    selected_accrual.id,
    selected_accrual.user_id,
    selected_accrual.amount_cents,
    selected_accrual.currency,
    selected_accrual.status,
    selected_accrual.payment_id,
    not inserted_accrual;
end;
$$;

create function public.claim_billing_accruals(
  p_user_id uuid,
  p_threshold_cents integer default 1000
)
returns table (
  payment_id uuid,
  amount_cents integer,
  currency text,
  accrual_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_accrual record;
  selected_accrual_ids uuid[] := '{}'::uuid[];
  selected_total integer := 0;
  selected_count integer := 0;
  selected_currency text := 'AUD';
  selected_payment_id uuid := pg_catalog.gen_random_uuid();
  selected_account public.billing_accounts%rowtype;
  selected_source public.payment_sources%rowtype;
  claim_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null
    or p_threshold_cents < 1
  then
    raise exception 'Invalid billing accrual claim parameters'
      using errcode = '22023';
  end if;

  for selected_accrual in
    select accrual.id, accrual.amount_cents, accrual.currency
    from public.billing_accruals as accrual
    where accrual.user_id = p_user_id
      and accrual.status = 'accrued'
    order by accrual.accrued_at, accrual.id
    for update
  loop
    if selected_count > 0
      and selected_currency is distinct from selected_accrual.currency
    then
      raise exception 'Mixed currencies cannot be claimed together'
        using errcode = '22023';
    end if;

    selected_currency := selected_accrual.currency;
    selected_total := selected_total + selected_accrual.amount_cents;
    selected_count := selected_count + 1;
    selected_accrual_ids :=
      pg_catalog.array_append(selected_accrual_ids, selected_accrual.id);
  end loop;

  if selected_total < p_threshold_cents then
    return;
  end if;

  select account.*
  into selected_account
  from public.billing_accounts as account
  where account.user_id = p_user_id
    and account.status = 'ready'
  for update;

  if selected_account.id is null
    or selected_account.provider_payer_id is null
  then
    raise exception 'The billing account is unavailable'
      using errcode = 'P0001';
  end if;

  select source.*
  into selected_source
  from public.payment_sources as source
  where source.user_id = p_user_id
    and source.billing_account_id = selected_account.id
    and source.is_default = true
  order by source.created_at, source.id
  limit 1
  for update;

  if selected_source.id is null then
    raise exception 'The default payment source is unavailable'
      using errcode = 'P0001';
  end if;

  insert into public.payments (
    id,
    user_id,
    task_id,
    quote_id,
    billing_account_id,
    payment_source_id,
    provider,
    environment,
    amount_cents,
    currency,
    nonce,
    status,
    provider_payer_id_snapshot,
    provider_source_id_snapshot
  ) values (
    selected_payment_id,
    p_user_id,
    null,
    null,
    selected_account.id,
    selected_source.id,
    'pinch',
    selected_account.environment,
    selected_total,
    selected_currency,
    'outcomes-batch-' || selected_payment_id::text || '-charge-v1',
    'reserved',
    selected_account.provider_payer_id,
    selected_source.provider_source_id
  );

  insert into public.payment_allocations (
    payment_id,
    user_id,
    task_id,
    quote_id,
    amount_cents,
    currency
  )
  select
    selected_payment_id,
    accrual.user_id,
    accrual.task_id,
    accrual.quote_id,
    accrual.amount_cents,
    accrual.currency
  from public.billing_accruals as accrual
  where accrual.id = any(selected_accrual_ids)
  order by accrual.accrued_at, accrual.id;

  update public.billing_accruals
  set
    payment_id = selected_payment_id,
    status = 'charging',
    charged_at = null,
    updated_at = claim_now
  where id = any(selected_accrual_ids)
    and user_id = p_user_id
    and status = 'accrued';

  if not found then
    raise exception 'Billing accrual claim changed concurrently'
      using errcode = '40001';
  end if;

  return query select
    selected_payment_id,
    selected_total,
    selected_currency,
    selected_count;
end;
$$;

insert into public.payment_allocations (
  payment_id,
  user_id,
  task_id,
  quote_id,
  amount_cents,
  currency,
  created_at
)
select
  payment.id,
  payment.user_id,
  payment.task_id,
  payment.quote_id,
  payment.amount_cents,
  payment.currency,
  payment.created_at
from public.payments as payment
where payment.task_id is not null
  and payment.quote_id is not null
  and payment.status <> 'failed'
on conflict do nothing;

insert into public.billing_accruals (
  user_id,
  task_id,
  quote_id,
  payment_id,
  amount_cents,
  currency,
  status,
  accrued_at,
  charged_at,
  created_at,
  updated_at
)
select
  payment.user_id,
  payment.task_id,
  payment.quote_id,
  payment.id,
  payment.amount_cents,
  payment.currency,
  case
    when payment.status in ('approved', 'pending', 'settled') then 'charged'
    else 'charging'
  end,
  coalesce(task.verified_at, payment.created_at),
  case
    when payment.status in ('approved', 'pending', 'settled')
      then coalesce(payment.charged_at, payment.created_at)
    else null
  end,
  payment.created_at,
  payment.updated_at
from public.payments as payment
join public.tasks as task
  on task.id = payment.task_id
  and task.user_id = payment.user_id
where payment.task_id is not null
  and payment.quote_id is not null
  and payment.status <> 'failed'
on conflict do nothing;

update public.tasks as task
set
  completed_at = coalesce(task.completed_at, accrual.accrued_at),
  failed_at = null,
  failure_reason = null,
  status = 'completed',
  updated_at = pg_catalog.clock_timestamp()
from public.billing_accruals as accrual
where accrual.task_id = task.id
  and accrual.user_id = task.user_id
  and task.status in ('verified', 'charging');

alter table public.billing_accruals enable row level security;
alter table public.payment_allocations enable row level security;

create policy "billing_accruals_select_own"
on public.billing_accruals for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "payment_allocations_select_own"
on public.payment_allocations for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.billing_accruals
  from public, anon, authenticated, service_role;
revoke all on table public.payment_allocations
  from public, anon, authenticated, service_role;
grant select on table public.billing_accruals, public.payment_allocations
  to authenticated;
grant select, insert, update, delete
  on table public.billing_accruals, public.payment_allocations
  to service_role;

revoke all on function public.protect_billing_accrual_evidence()
  from public, anon, authenticated, service_role;
revoke all on function public.protect_payment_allocation_evidence()
  from public, anon, authenticated, service_role;
revoke all on function public.sync_billing_accruals_for_payment()
  from public, anon, authenticated, service_role;
revoke all on function public.accrue_verified_task(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_billing_accruals(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.accrue_verified_task(uuid)
  to service_role;
grant execute on function public.claim_billing_accruals(uuid, integer)
  to service_role;
