create unique index payments_legacy_task_idx
  on public.payments(task_id)
  where task_id is not null;
create unique index payments_legacy_quote_idx
  on public.payments(quote_id)
  where quote_id is not null;

create function public.prevent_legacy_task_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_id is not null or new.quote_id is not null then
    raise exception 'Per-task payment creation is retired; accrue the task'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

create trigger payments_prevent_legacy_task_insert
before insert on public.payments
for each row execute function public.prevent_legacy_task_payment();

create function public.prevent_settled_payment_regression()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'settled' and new.status <> 'settled' then
    new.status := old.status;
    new.settled_at := old.settled_at;
  end if;

  return new;
end;
$$;

create trigger payments_prevent_settled_regression
before update on public.payments
for each row execute function public.prevent_settled_payment_regression();

insert into public.payment_allocations (
  payment_id,
  user_id,
  task_id,
  quote_id,
  amount_cents,
  currency,
  status,
  created_at
)
select
  payment.id,
  payment.user_id,
  payment.task_id,
  payment.quote_id,
  payment.amount_cents,
  payment.currency,
  case when payment.status = 'failed' then 'released' else 'active' end,
  payment.created_at
from public.payments as payment
where payment.task_id is not null
  and payment.quote_id is not null
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
  case when payment.status = 'failed' then null else payment.id end,
  payment.amount_cents,
  payment.currency,
  case
    when payment.status = 'failed' then 'accrued'
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
  and task.status in ('verified', 'charging', 'payment_failed');

create or replace function public.accrue_verified_task(p_task_id uuid)
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
  selected_payment public.payments%rowtype;
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

  select payment.*
  into selected_payment
  from public.payments as payment
  where payment.task_id = selected_task.id
    and payment.user_id = selected_task.user_id
  limit 1
  for update;

  if selected_payment.id is not null then
    insert into public.payment_allocations (
      payment_id,
      user_id,
      task_id,
      quote_id,
      amount_cents,
      currency,
      status,
      created_at
    ) values (
      selected_payment.id,
      selected_payment.user_id,
      selected_task.id,
      selected_quote.id,
      selected_quote.amount_cents,
      selected_quote.currency,
      case
        when selected_payment.status = 'failed' then 'released'
        else 'active'
      end,
      selected_payment.created_at
    )
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
      charged_at
    ) values (
      selected_task.user_id,
      selected_task.id,
      selected_quote.id,
      case
        when selected_payment.status = 'failed' then null
        else selected_payment.id
      end,
      selected_quote.amount_cents,
      selected_quote.currency,
      case
        when selected_payment.status = 'failed' then 'accrued'
        when selected_payment.status in ('approved', 'pending', 'settled')
          then 'charged'
        else 'charging'
      end,
      transition_now,
      case
        when selected_payment.status in ('approved', 'pending', 'settled')
          then coalesce(selected_payment.charged_at, transition_now)
        else null
      end
    )
    on conflict on constraint billing_accruals_task_key do nothing
    returning * into selected_accrual;
  else
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
  end if;

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

  update public.tasks as completed_task
  set
    completed_at = coalesce(completed_task.completed_at, transition_now),
    failed_at = null,
    failure_reason = null,
    status = 'completed',
    updated_at = transition_now
  where completed_task.id = selected_task.id
    and completed_task.user_id = selected_task.user_id
    and completed_task.status in ('verified', 'completed');

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

create function public.list_billing_settlement_candidates(
  p_threshold_cents integer default 1000,
  p_batch_size integer default 25
)
returns table (candidate_user_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_threshold_cents < 1
    or p_batch_size not between 1 and 100
  then
    raise exception 'Invalid billing settlement candidate parameters'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select
      accrual.user_id,
      pg_catalog.min(accrual.accrued_at) as oldest_accrual
    from public.billing_accruals as accrual
    where accrual.status = 'charging'
    group by accrual.user_id

    union all

    select
      accrual.user_id,
      pg_catalog.min(accrual.accrued_at) as oldest_accrual
    from public.billing_accruals as accrual
    where accrual.status = 'accrued'
    group by accrual.user_id
    having pg_catalog.sum(accrual.amount_cents) >= p_threshold_cents
  )
  select candidate.user_id
  from candidates as candidate
  group by candidate.user_id
  order by pg_catalog.min(candidate.oldest_accrual), candidate.user_id
  limit p_batch_size;
end;
$$;

revoke all on function public.prevent_legacy_task_payment()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_settled_payment_regression()
  from public, anon, authenticated, service_role;
revoke all on function public.list_billing_settlement_candidates(
  integer,
  integer
) from public, anon, authenticated, service_role;
revoke all on function public.accrue_verified_task(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.accrue_verified_task(uuid)
  to service_role;
grant execute on function public.list_billing_settlement_candidates(
  integer,
  integer
) to service_role;
