alter table public.tasks
  drop constraint tasks_worker_runtime_check;

alter table public.tasks
  add constraint tasks_worker_runtime_check check (
    worker_runtime is null
    or worker_runtime in ('cloud', 'isolated_local')
  );

create table public.task_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  user_id uuid not null,
  claim_count integer not null default 1 check (claim_count > 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  claim_token uuid not null,
  claimed_by text not null check (char_length(claimed_by) between 1 and 160),
  state text not null check (
    state in (
      'claimed',
      'publishing',
      'retry_wait',
      'succeeded',
      'failed'
    )
  ),
  lease_expires_at timestamptz not null,
  next_attempt_at timestamptz,
  agent_id text,
  run_id text,
  worker_model text,
  usage jsonb check (usage is null or jsonb_typeof(usage) = 'object'),
  worker_output jsonb check (
    worker_output is null or jsonb_typeof(worker_output) = 'object'
  ),
  change_evidence jsonb check (
    change_evidence is null or jsonb_typeof(change_evidence) = 'object'
  ),
  publication_evidence jsonb check (
    publication_evidence is null
    or jsonb_typeof(publication_evidence) = 'object'
  ),
  customer_error_code text,
  customer_error_message text,
  internal_error text,
  claimed_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_execution_attempts_task_key unique (task_id),
  constraint task_execution_attempts_run_key unique (run_id),
  constraint task_execution_attempts_task_owner_fkey foreign key (
    task_id,
    user_id
  ) references public.tasks(id, user_id) on delete cascade,
  constraint task_execution_attempts_terminal_check check (
    (
      state in ('succeeded', 'failed')
      and completed_at is not null
    )
    or (
      state not in ('succeeded', 'failed')
      and completed_at is null
    )
  )
);

create index task_execution_attempts_reconciliation_idx
  on public.task_execution_attempts(
    state,
    next_attempt_at,
    lease_expires_at
  );
create index task_execution_attempts_user_id_idx
  on public.task_execution_attempts(user_id, created_at desc);

alter table public.tasks
  add column verifier_lease_expires_at timestamptz;

alter table public.payments
  add column provider_payer_id_snapshot text,
  add column provider_source_id_snapshot text;

update public.payments as payment
set
  provider_payer_id_snapshot = account.provider_payer_id,
  provider_source_id_snapshot = source.provider_source_id
from public.billing_accounts as account,
  public.payment_sources as source
where account.id = payment.billing_account_id
  and source.id = payment.payment_source_id
  and source.billing_account_id = account.id;

drop policy if exists "payments_insert_own" on public.payments;
drop policy if exists "payments_update_own" on public.payments;
revoke insert, update on table public.payments from authenticated;

create function public.protect_payment_reservation_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.task_id is distinct from old.task_id
    or new.quote_id is distinct from old.quote_id
    or new.billing_account_id is distinct from old.billing_account_id
    or new.payment_source_id is distinct from old.payment_source_id
    or new.provider is distinct from old.provider
    or new.environment is distinct from old.environment
    or new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
    or new.nonce is distinct from old.nonce
    or new.provider_payer_id_snapshot is distinct from
      old.provider_payer_id_snapshot
    or new.provider_source_id_snapshot is distinct from
      old.provider_source_id_snapshot
  then
    raise exception 'Payment reservation evidence is immutable'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger payments_protect_reservation_evidence
before update on public.payments
for each row execute function public.protect_payment_reservation_evidence();

create function public.derive_snapshot_task_contract_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  acceptance_criteria_value text;
begin
  if new.repository_binding_id is null then
    return new;
  end if;

  if jsonb_typeof(new.task_spec) is distinct from 'object'
    or nullif(pg_catalog.btrim(new.task_spec ->> 'description'), '') is null
  then
    raise exception 'Snapshot task contract is invalid'
      using errcode = '22023';
  end if;

  select pg_catalog.string_agg(value, E'\n' order by ordinal)
  into acceptance_criteria_value
  from pg_catalog.jsonb_array_elements_text(
    new.task_spec -> 'acceptanceCriteria'
  ) with ordinality as criteria(value, ordinal);

  new.title := pg_catalog.left(
    pg_catalog.split_part(
      pg_catalog.btrim(new.task_spec ->> 'description'),
      E'\n',
      1
    ),
    160
  );
  new.description := new.task_spec ->> 'description';
  new.acceptance_criteria := acceptance_criteria_value;
  new.worker_provider := 'cursor';
  new.worker_runtime := 'isolated_local';

  return new;
end;
$$;

create trigger tasks_derive_snapshot_contract_fields
before insert on public.tasks
for each row execute function public.derive_snapshot_task_contract_fields();

update public.tasks
set
  worker_provider = 'cursor',
  worker_runtime = 'isolated_local',
  updated_at = pg_catalog.clock_timestamp()
where repository_binding_id is not null
  and status = 'approved'
  and agent_id is null
  and run_id is null;

create function public.claim_task_executions(
  p_claimed_by text,
  p_batch_size integer default 1,
  p_lease_seconds integer default 90
)
returns table (
  attempt_id uuid,
  task_id uuid,
  user_id uuid,
  claim_token uuid,
  claim_count integer,
  failure_count integer,
  lease_expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_task record;
  claimed_attempt public.task_execution_attempts%rowtype;
  claimed_total integer := 0;
  claim_now timestamptz := pg_catalog.clock_timestamp();
begin
  if nullif(pg_catalog.btrim(p_claimed_by), '') is null
    or char_length(p_claimed_by) > 160
    or p_batch_size not between 1 and 5
    or p_lease_seconds not between 60 and 3600
  then
    raise exception 'Invalid task execution claim parameters'
      using errcode = '22023';
  end if;

  for selected_task in
    select task.id, task.user_id
    from public.tasks as task
    left join public.task_execution_attempts as attempt
      on attempt.task_id = task.id
    where task.repository_binding_id is not null
      and task.worker_provider = 'cursor'
      and task.worker_runtime = 'isolated_local'
      and (
        (
          attempt.id is null
          and task.status = 'approved'
          and task.agent_id is null
          and task.run_id is null
        )
        or (
          attempt.id is not null
          and task.status in ('approved', 'starting', 'executing')
          and (
            (
              attempt.state in ('claimed', 'publishing')
              and attempt.lease_expires_at <= claim_now
            )
            or (
              attempt.state = 'retry_wait'
              and attempt.next_attempt_at <= claim_now
            )
          )
          and (
            (task.agent_id is null and task.run_id is null)
            or (
              task.agent_id = attempt.agent_id
              and task.run_id = attempt.run_id
            )
          )
        )
      )
    order by task.created_at, task.id
    for update of task skip locked
    limit p_batch_size
  loop
    insert into public.task_execution_attempts (
      task_id,
      user_id,
      claim_token,
      claimed_by,
      state,
      lease_expires_at
    )
    values (
      selected_task.id,
      selected_task.user_id,
      pg_catalog.gen_random_uuid(),
      pg_catalog.btrim(p_claimed_by),
      'claimed',
      claim_now + pg_catalog.make_interval(secs => p_lease_seconds)
    )
    on conflict on constraint task_execution_attempts_task_key do update
    set
      claim_count = public.task_execution_attempts.claim_count + 1,
      claim_token = pg_catalog.gen_random_uuid(),
      claimed_by = excluded.claimed_by,
      state = 'claimed',
      lease_expires_at = excluded.lease_expires_at,
      next_attempt_at = null,
      claimed_at = claim_now,
      updated_at = claim_now
    where public.task_execution_attempts.state
        in ('claimed', 'publishing', 'retry_wait')
      and (
        public.task_execution_attempts.lease_expires_at <= claim_now
        or (
          public.task_execution_attempts.state = 'retry_wait'
          and public.task_execution_attempts.next_attempt_at <= claim_now
        )
      )
    returning * into claimed_attempt;

    if claimed_attempt.id is null then
      continue;
    end if;

    update public.tasks as claimed_task
    set
      status = 'starting',
      started_at = coalesce(claimed_task.started_at, claim_now),
      worker_provider = 'cursor',
      worker_runtime = 'isolated_local',
      updated_at = claim_now
    where claimed_task.id = selected_task.id
      and claimed_task.user_id = selected_task.user_id
      and claimed_task.status in ('approved', 'starting', 'executing');

    if not found then
      raise exception 'Claimed task state changed concurrently'
        using errcode = '40001';
    end if;

    insert into public.task_events (
      task_id,
      user_id,
      event_type,
      event_data
    ) values (
      selected_task.id,
      selected_task.user_id,
      case
        when claimed_attempt.claim_count = 1
          then 'worker.claimed'
        else 'worker.claim_recovered'
      end,
      pg_catalog.jsonb_build_object(
        'attempt_id', claimed_attempt.id,
        'claim_count', claimed_attempt.claim_count
      )
    );

    claimed_total := claimed_total + 1;
    return query select
      claimed_attempt.id,
      claimed_attempt.task_id,
      claimed_attempt.user_id,
      claimed_attempt.claim_token,
      claimed_attempt.claim_count,
      claimed_attempt.failure_count,
      claimed_attempt.lease_expires_at;

    exit when claimed_total >= p_batch_size;
  end loop;
end;
$$;

create function public.complete_task_execution(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_change_evidence jsonb,
  p_publication_evidence jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_attempt public.task_execution_attempts%rowtype;
  transition_now timestamptz := pg_catalog.clock_timestamp();
begin
  if jsonb_typeof(p_change_evidence) is distinct from 'object'
    or jsonb_typeof(p_publication_evidence) is distinct from 'object'
    or nullif(p_publication_evidence ->> 'branch', '') is null
    or nullif(p_publication_evidence ->> 'prUrl', '') is null
    or nullif(p_publication_evidence ->> 'commitSha', '') is null
  then
    raise exception 'Invalid publication evidence' using errcode = '22023';
  end if;

  update public.task_execution_attempts
  set
    state = 'succeeded',
    change_evidence =
      coalesce(change_evidence, '{}'::jsonb) || p_change_evidence,
    publication_evidence = p_publication_evidence,
    completed_at = transition_now,
    updated_at = transition_now
  where id = p_attempt_id
    and claim_token = p_claim_token
    and state = 'publishing'
    and lease_expires_at > transition_now
  returning * into selected_attempt;

  if selected_attempt.id is null then
    return false;
  end if;

  update public.tasks
  set
    actual_cost_usd_micros = null,
    output_ref = p_publication_evidence ->> 'prUrl',
    result_branch = p_publication_evidence ->> 'branch',
    result_pr_url = p_publication_evidence ->> 'prUrl',
    status = 'worker_succeeded',
    worker_completed_at = transition_now,
    updated_at = transition_now
  where id = selected_attempt.task_id
    and user_id = selected_attempt.user_id
    and status = 'executing';

  if not found then
    raise exception 'Publishing task state changed concurrently'
      using errcode = '40001';
  end if;

  insert into public.task_events (
    task_id,
    user_id,
    event_type,
    event_data
  ) values (
    selected_attempt.task_id,
    selected_attempt.user_id,
    'publication.completed',
    pg_catalog.jsonb_build_object(
      'attempt_id', selected_attempt.id,
      'branch', p_publication_evidence ->> 'branch',
      'commit_sha', p_publication_evidence ->> 'commitSha',
      'pr_url', p_publication_evidence ->> 'prUrl'
    )
  );

  return true;
end;
$$;

create function public.record_task_execution_prepublication(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_agent_id text,
  p_run_id text,
  p_worker_model text,
  p_usage jsonb,
  p_worker_output jsonb,
  p_change_evidence jsonb,
  p_lease_seconds integer default 90
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_attempt public.task_execution_attempts%rowtype;
  transition_now timestamptz := pg_catalog.clock_timestamp();
begin
  if nullif(p_agent_id, '') is null
    or nullif(p_run_id, '') is null
    or nullif(p_worker_model, '') is null
    or jsonb_typeof(p_change_evidence) is distinct from 'object'
    or jsonb_typeof(p_change_evidence -> 'changes') is distinct from 'array'
    or nullif(p_change_evidence ->> 'branch', '') is null
    or p_lease_seconds not between 60 and 3600
  then
    raise exception 'Invalid prepublication evidence'
      using errcode = '22023';
  end if;

  update public.task_execution_attempts
  set
    state = 'publishing',
    agent_id = p_agent_id,
    run_id = p_run_id,
    worker_model = p_worker_model,
    usage = p_usage,
    worker_output = p_worker_output,
    change_evidence = p_change_evidence,
    started_at = coalesce(started_at, transition_now),
    lease_expires_at =
      transition_now + pg_catalog.make_interval(secs => p_lease_seconds),
    updated_at = transition_now
  where id = p_attempt_id
    and claim_token = p_claim_token
    and state in ('claimed', 'publishing')
    and lease_expires_at > transition_now
  returning * into selected_attempt;

  if selected_attempt.id is null then
    return false;
  end if;

  update public.tasks
  set
    agent_id = p_agent_id,
    run_id = p_run_id,
    worker_model = p_worker_model,
    usage = p_usage,
    worker_result = p_worker_output,
    status = 'executing',
    updated_at = transition_now
  where id = selected_attempt.task_id
    and user_id = selected_attempt.user_id
    and status in ('starting', 'executing');

  if not found then
    raise exception 'Prepublication task state changed concurrently'
      using errcode = '40001';
  end if;

  insert into public.task_events (
    task_id,
    user_id,
    event_type,
    event_data
  )
  select
    selected_attempt.task_id,
    selected_attempt.user_id,
    'worker.completed',
    pg_catalog.jsonb_build_object(
      'attempt_id', selected_attempt.id,
      'agent_id', p_agent_id,
      'run_id', p_run_id,
      'branch', p_change_evidence ->> 'branch'
    )
  where not exists (
    select 1
    from public.task_events as event
    where event.task_id = selected_attempt.task_id
      and event.user_id = selected_attempt.user_id
      and event.event_type = 'worker.completed'
      and event.event_data ->> 'attempt_id' = selected_attempt.id::text
  );

  return true;
end;
$$;

create function public.renew_task_execution_lease(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer default 90
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  heartbeat_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_lease_seconds not between 30 and 300 then
    raise exception 'Invalid heartbeat lease duration'
      using errcode = '22023';
  end if;

  update public.task_execution_attempts
  set
    lease_expires_at =
      heartbeat_now + pg_catalog.make_interval(secs => p_lease_seconds),
    updated_at = heartbeat_now
  where id = p_attempt_id
    and claim_token = p_claim_token
    and state in ('claimed', 'publishing')
    and lease_expires_at > heartbeat_now;

  return found;
end;
$$;

create function public.defer_task_execution(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_retry_after_seconds integer,
  p_internal_error text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  retry_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_retry_after_seconds not between 5 and 3600 then
    raise exception 'Invalid execution retry delay'
      using errcode = '22023';
  end if;

  update public.task_execution_attempts
  set
    state = 'retry_wait',
    failure_count = failure_count + 1,
    customer_error_code = 'retry_scheduled',
    customer_error_message =
      'A temporary execution failure will be retried automatically.',
    internal_error = pg_catalog.left(p_internal_error, 8000),
    last_failure_at = retry_now,
    next_attempt_at =
      retry_now
      + pg_catalog.make_interval(secs => p_retry_after_seconds),
    lease_expires_at = retry_now,
    updated_at = retry_now
  where id = p_attempt_id
    and claim_token = p_claim_token
    and state in ('claimed', 'publishing')
    and lease_expires_at > retry_now;

  if found then
    insert into public.task_events (
      task_id,
      user_id,
      event_type,
      event_data
    )
    select
      attempt.task_id,
      attempt.user_id,
      'worker.retry_scheduled',
      pg_catalog.jsonb_build_object(
        'attempt_id', attempt.id,
        'failure_count', attempt.failure_count,
        'retry_after_seconds', p_retry_after_seconds
      )
    from public.task_execution_attempts as attempt
    where attempt.id = p_attempt_id;
  end if;

  return found;
end;
$$;

create function public.fail_task_execution(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_customer_error_code text,
  p_customer_error_message text,
  p_internal_error text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_attempt public.task_execution_attempts%rowtype;
  transition_now timestamptz := pg_catalog.clock_timestamp();
begin
  update public.task_execution_attempts
  set
    state = 'failed',
    customer_error_code = pg_catalog.left(p_customer_error_code, 120),
    customer_error_message = pg_catalog.left(p_customer_error_message, 500),
    internal_error = pg_catalog.left(p_internal_error, 8000),
    completed_at = transition_now,
    updated_at = transition_now
  where id = p_attempt_id
    and claim_token = p_claim_token
    and state in ('claimed', 'publishing')
    and lease_expires_at > transition_now
  returning * into selected_attempt;

  if selected_attempt.id is null then
    return false;
  end if;

  update public.tasks
  set
    failed_at = transition_now,
    failure_reason = pg_catalog.left(p_customer_error_message, 500),
    status = 'worker_failed',
    updated_at = transition_now
  where id = selected_attempt.task_id
    and user_id = selected_attempt.user_id
    and status in ('starting', 'executing');

  if not found then
    raise exception 'Failing task state changed concurrently'
      using errcode = '40001';
  end if;

  insert into public.task_events (
    task_id,
    user_id,
    event_type,
    event_data
  ) values (
    selected_attempt.task_id,
    selected_attempt.user_id,
    'worker.failed',
    pg_catalog.jsonb_build_object(
      'attempt_id', selected_attempt.id,
      'code', p_customer_error_code,
      'message', p_customer_error_message
    )
  );

  return true;
end;
$$;

alter table public.task_execution_attempts enable row level security;

revoke all on table public.task_execution_attempts
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.task_execution_attempts
  to service_role;

revoke all on function public.derive_snapshot_task_contract_fields()
  from public, anon, authenticated, service_role;
revoke all on function public.protect_payment_reservation_evidence()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_task_executions(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_task_execution(
  uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.record_task_execution_prepublication(
  uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer
) from public, anon, authenticated, service_role;
revoke all on function public.renew_task_execution_lease(
  uuid, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function public.defer_task_execution(
  uuid, uuid, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.fail_task_execution(
  uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.claim_task_executions(
  text, integer, integer
) to service_role;
grant execute on function public.complete_task_execution(
  uuid, uuid, jsonb, jsonb
) to service_role;
grant execute on function public.record_task_execution_prepublication(
  uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer
) to service_role;
grant execute on function public.renew_task_execution_lease(
  uuid, uuid, integer
) to service_role;
grant execute on function public.defer_task_execution(
  uuid, uuid, integer, text
) to service_role;
grant execute on function public.fail_task_execution(
  uuid, uuid, text, text, text
) to service_role;
