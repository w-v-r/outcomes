create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  lookup_prefix text not null unique check (
    lookup_prefix ~ '^[a-z0-9]{10,24}$'
  ),
  key_hash bytea not null unique check (octet_length(key_hash) = 32),
  last_four text not null check (last_four ~ '^[A-Za-z0-9_-]{4}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index api_keys_user_id_created_at_idx
  on public.api_keys(user_id, created_at desc);
create index api_keys_active_prefix_idx
  on public.api_keys(lookup_prefix)
  where revoked_at is null;

alter table public.quotes
  alter column task_id drop not null;

alter table public.quotes
  add column request_id text,
  add column repository_url text,
  add column repository_sha text,
  add column task_spec jsonb,
  add column eligibility_decision jsonb,
  add column expires_at timestamptz,
  add column contract_hash text,
  add column accepted_at timestamptz,
  add column acceptance_idempotency_key text;

update public.quotes as quote
set
  request_id = 'legacy-' || quote.id::text,
  repository_url = 'legacy://sandbox-demo',
  repository_sha = repeat('0', 40),
  task_spec = jsonb_build_object(
    'description', task.description,
    'acceptanceCriteria', jsonb_build_array(task.acceptance_criteria),
    'prohibitedChanges', '[]'::jsonb
  ),
  eligibility_decision = jsonb_build_object(
    'eligible', true,
    'code', 'legacy_sandbox_demo'
  ),
  expires_at = quote.created_at + interval '10 years',
  contract_hash = encode(
    extensions.digest('legacy-quote:' || quote.id::text, 'sha256'),
    'hex'
  ),
  accepted_at = quote.approved_at
from public.tasks as task
where task.id = quote.task_id;

alter table public.quotes
  alter column request_id set not null,
  alter column repository_url set not null,
  alter column repository_sha set not null,
  alter column task_spec set not null,
  alter column eligibility_decision set not null,
  alter column expires_at set not null,
  alter column contract_hash set not null;

alter table public.quotes
  add constraint quotes_user_request_key unique (user_id, request_id),
  add constraint quotes_id_user_key unique (id, user_id),
  add constraint quotes_repository_sha_check check (
    repository_sha ~ '^[0-9a-f]{40}$'
  ),
  add constraint quotes_task_spec_object_check check (
    jsonb_typeof(task_spec) = 'object'
  ),
  add constraint quotes_eligibility_object_check check (
    jsonb_typeof(eligibility_decision) = 'object'
  ),
  add constraint quotes_contract_hash_check check (
    contract_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint quotes_acceptance_idempotency_key unique (
    user_id,
    acceptance_idempotency_key
  ),
  add constraint quotes_accepted_timestamp_check check (
    status <> 'approved'
    or (
      approved_at is not null
      and accepted_at is not null
      and task_id is not null
    )
  );

alter table public.quotes
  drop constraint quotes_status_check;

alter table public.quotes
  add constraint quotes_status_check check (
    status in ('pending', 'approved', 'declined', 'expired', 'rejected')
  );

alter table public.tasks
  add column quote_id uuid,
  add column repository_url text,
  add column repository_sha text,
  add column task_spec jsonb,
  add column idempotency_key text,
  add column external_ref text,
  add column worker_provider text,
  add column worker_runtime text,
  add column worker_model text,
  add column agent_id text,
  add column run_id text,
  add column output_ref text,
  add column result_branch text,
  add column result_pr_url text,
  add column usage jsonb,
  add column actual_cost_usd_micros bigint,
  add column worker_result jsonb,
  add column verifier_run_id bigint,
  add column verifier_status text,
  add column verifier_conclusion text,
  add column verifier_evidence jsonb,
  add column started_at timestamptz,
  add column worker_completed_at timestamptz,
  add column verifying_at timestamptz,
  add column failed_at timestamptz,
  add column failure_reason text;

update public.tasks as task
set
  quote_id = quote.id,
  repository_url = quote.repository_url,
  repository_sha = quote.repository_sha,
  task_spec = quote.task_spec,
  external_ref = 'legacy-' || task.id::text
from public.quotes as quote
where quote.task_id = task.id;

alter table public.tasks
  add constraint tasks_id_user_key unique (id, user_id),
  add constraint tasks_quote_id_key unique (quote_id),
  add constraint tasks_user_idempotency_key unique (user_id, idempotency_key),
  add constraint tasks_run_id_key unique (run_id),
  add constraint tasks_worker_provider_check check (
    worker_provider is null or worker_provider in ('cursor')
  ),
  add constraint tasks_worker_runtime_check check (
    worker_runtime is null or worker_runtime in ('cloud')
  ),
  add constraint tasks_repository_sha_check check (
    repository_sha is null or repository_sha ~ '^[0-9a-f]{40}$'
  ),
  add constraint tasks_actual_cost_check check (
    actual_cost_usd_micros is null or actual_cost_usd_micros >= 0
  ),
  add constraint tasks_quote_owner_fkey foreign key (quote_id, user_id)
    references public.quotes(id, user_id) on delete restrict;

alter table public.quotes
  add constraint quotes_task_owner_fkey foreign key (task_id, user_id)
    references public.tasks(id, user_id) on delete cascade;

alter table public.tasks
  drop constraint tasks_status_check;

alter table public.tasks
  add constraint tasks_status_check check (
    status in (
      'quoted',
      'approved',
      'starting',
      'executing',
      'worker_succeeded',
      'verifying',
      'verified',
      'charging',
      'completed',
      'failed',
      'worker_failed',
      'verification_failed',
      'payment_failed',
      'cancelled'
    )
  );

create index tasks_quote_id_idx
  on public.tasks(quote_id)
  where quote_id is not null;
create index tasks_agent_id_idx
  on public.tasks(agent_id)
  where agent_id is not null;
create index tasks_verifier_run_id_idx
  on public.tasks(verifier_run_id)
  where verifier_run_id is not null;
create index quotes_user_status_created_at_idx
  on public.quotes(user_id, status, created_at desc);

create table public.quote_underwriting (
  quote_id uuid primary key,
  user_id uuid not null,
  predicted_cost_usd_micros bigint not null check (
    predicted_cost_usd_micros >= 0
  ),
  internal_budget_usd_micros bigint not null check (
    internal_budget_usd_micros > 0
  ),
  risk_multiplier numeric(8, 4) not null check (risk_multiplier > 0),
  usd_to_aud_rate numeric(8, 4) not null check (usd_to_aud_rate > 0),
  analysis_json jsonb not null check (jsonb_typeof(analysis_json) = 'object'),
  estimate_json jsonb not null check (jsonb_typeof(estimate_json) = 'object'),
  estimator_id text not null,
  estimator_version text not null,
  rate_card_version text not null,
  created_at timestamptz not null default now(),
  constraint quote_underwriting_quote_owner_fkey
    foreign key (quote_id, user_id)
    references public.quotes(id, user_id)
    on delete cascade
);

create index quote_underwriting_user_id_idx
  on public.quote_underwriting(user_id);

create table public.task_events (
  id bigint generated by default as identity primary key,
  task_id uuid not null,
  user_id uuid not null,
  event_type text not null check (char_length(event_type) between 1 and 80),
  event_data jsonb not null default '{}'::jsonb check (
    jsonb_typeof(event_data) = 'object'
  ),
  created_at timestamptz not null default now(),
  constraint task_events_task_owner_fkey
    foreign key (task_id, user_id)
    references public.tasks(id, user_id)
    on delete cascade
);

create index task_events_task_id_created_at_idx
  on public.task_events(task_id, created_at, id);
create index task_events_user_id_created_at_idx
  on public.task_events(user_id, created_at desc);

create or replace function public.protect_approved_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved' and (
    new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
    or new.terms is distinct from old.terms
    or new.pricing_model_version is distinct from old.pricing_model_version
    or new.task_id is distinct from old.task_id
    or new.user_id is distinct from old.user_id
    or new.request_id is distinct from old.request_id
    or new.repository_url is distinct from old.repository_url
    or new.repository_sha is distinct from old.repository_sha
    or new.task_spec is distinct from old.task_spec
    or new.eligibility_decision is distinct from old.eligibility_decision
    or new.expires_at is distinct from old.expires_at
    or new.contract_hash is distinct from old.contract_hash
    or new.accepted_at is distinct from old.accepted_at
    or new.acceptance_idempotency_key is distinct from old.acceptance_idempotency_key
  ) then
    raise exception 'Approved quote terms are immutable';
  end if;

  return new;
end;
$$;

create or replace function public.accept_quote_and_create_task(
  p_user_id uuid,
  p_quote_id uuid,
  p_contract_hash text,
  p_idempotency_key text
)
returns table (
  task_id uuid,
  created boolean,
  status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_quote public.quotes%rowtype;
  accepted_task public.tasks%rowtype;
  accepted_at_value timestamptz := now();
  acceptance_criteria_value text;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 8
    or char_length(p_idempotency_key) > 160
  then
    raise exception 'Invalid acceptance idempotency key'
      using errcode = '22023';
  end if;

  select quote.*
  into selected_quote
  from public.quotes as quote
  where quote.id = p_quote_id
    and quote.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Quote not found' using errcode = 'P0002';
  end if;

  if selected_quote.status = 'approved' then
    if selected_quote.acceptance_idempotency_key is distinct from p_idempotency_key
      or selected_quote.contract_hash is distinct from p_contract_hash
    then
      raise exception 'Quote already accepted with different terms'
        using errcode = '23505';
    end if;

    select task.*
    into accepted_task
    from public.tasks as task
    where task.id = selected_quote.task_id
      and task.user_id = p_user_id;

    return query
      select accepted_task.id, false, accepted_task.status;
    return;
  end if;

  if selected_quote.status <> 'pending' then
    raise exception 'Quote is not pending' using errcode = '22023';
  end if;

  if selected_quote.expires_at <= accepted_at_value then
    update public.quotes
    set status = 'expired'
    where id = selected_quote.id;

    raise exception 'Quote has expired' using errcode = '22023';
  end if;

  if selected_quote.contract_hash is distinct from p_contract_hash then
    raise exception 'Quote contract hash does not match'
      using errcode = '22023';
  end if;

  if coalesce(
    (selected_quote.eligibility_decision ->> 'eligible')::boolean,
    false
  ) is not true then
    raise exception 'Quote is not eligible for execution'
      using errcode = '22023';
  end if;

  select string_agg(value, E'\n' order by ordinal)
  into acceptance_criteria_value
  from jsonb_array_elements_text(
    selected_quote.task_spec -> 'acceptanceCriteria'
  ) with ordinality as criteria(value, ordinal);

  insert into public.tasks (
    user_id,
    quote_id,
    title,
    description,
    acceptance_criteria,
    status,
    repository_url,
    repository_sha,
    task_spec,
    idempotency_key,
    external_ref,
    worker_provider,
    worker_runtime
  )
  values (
    p_user_id,
    selected_quote.id,
    'Fix calculator zero-division behavior',
    selected_quote.task_spec ->> 'description',
    coalesce(acceptance_criteria_value, 'Trusted verifier must pass.'),
    'approved',
    selected_quote.repository_url,
    selected_quote.repository_sha,
    selected_quote.task_spec,
    p_idempotency_key,
    'quote-' || selected_quote.id::text,
    'cursor',
    'cloud'
  )
  on conflict (quote_id) do update
    set quote_id = excluded.quote_id
  returning * into accepted_task;

  update public.quotes
  set
    status = 'approved',
    approved_at = accepted_at_value,
    accepted_at = accepted_at_value,
    acceptance_idempotency_key = p_idempotency_key,
    task_id = accepted_task.id
  where id = selected_quote.id;

  insert into public.task_events (
    task_id,
    user_id,
    event_type,
    event_data
  )
  values (
    accepted_task.id,
    p_user_id,
    'quote.accepted',
    jsonb_build_object(
      'quote_id', selected_quote.id,
      'contract_hash', selected_quote.contract_hash
    )
  );

  return query
    select accepted_task.id, true, accepted_task.status;
end;
$$;

alter table public.api_keys enable row level security;
alter table public.quote_underwriting enable row level security;
alter table public.task_events enable row level security;

drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;
drop policy if exists "quotes_insert_own" on public.quotes;
drop policy if exists "quotes_update_own" on public.quotes;

create policy "task_events_select_own"
on public.task_events for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.api_keys from public, anon, authenticated;
revoke all on table public.quote_underwriting from public, anon, authenticated;
revoke all on table public.task_events from public, anon, authenticated;
revoke insert, update, delete on table public.tasks from authenticated;
revoke insert, update, delete on table public.quotes from authenticated;

grant select on table public.task_events to authenticated;
grant select, insert, update, delete on table public.api_keys to service_role;
grant select, insert, update, delete on table public.quote_underwriting to service_role;
grant select, insert, update, delete on table public.task_events to service_role;
grant select, insert, update, delete on table public.tasks to service_role;
grant select, insert, update, delete on table public.quotes to service_role;
grant usage, select on sequence public.task_events_id_seq to service_role;

revoke execute on function public.accept_quote_and_create_task(
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.accept_quote_and_create_task(
  uuid,
  uuid,
  text,
  text
) to service_role;
