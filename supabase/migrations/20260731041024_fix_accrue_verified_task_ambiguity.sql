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

revoke all on function public.accrue_verified_task(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.accrue_verified_task(uuid)
  to service_role;
