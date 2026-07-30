alter table public.repository_bindings
  add constraint repository_bindings_quote_identity_key unique (
    id,
    user_id,
    snapshot_id,
    manifest_hash,
    github_repository_id,
    base_branch,
    base_sha,
    repository_url,
    repository_full_name
  );

alter table public.quotes
  add column repository_binding_id uuid,
  add column repository_snapshot_id uuid,
  add column manifest_hash text,
  add column repository_full_name text,
  add column github_repository_id bigint,
  add column repository_base_branch text,
  add column pricing_policy_version text,
  add column pricing_evidence jsonb,
  add column pricing_evidence_hash text,
  add constraint quotes_repository_evidence_complete_check check (
    (
      repository_binding_id is null
      and repository_snapshot_id is null
      and manifest_hash is null
      and repository_full_name is null
      and github_repository_id is null
      and repository_base_branch is null
      and pricing_policy_version is null
      and pricing_evidence is null
      and pricing_evidence_hash is null
    )
    or (
      repository_binding_id is not null
      and repository_snapshot_id is not null
      and manifest_hash is not null
      and manifest_hash ~ '^[0-9a-f]{64}$'
      and repository_full_name is not null
      and repository_full_name ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'
      and github_repository_id is not null
      and github_repository_id > 0
      and repository_base_branch is not null
      and char_length(repository_base_branch) between 1 and 255
      and pricing_policy_version is not null
      and char_length(pricing_policy_version) between 1 and 120
      and pricing_evidence is not null
      and jsonb_typeof(pricing_evidence) = 'object'
      and pricing_evidence_hash is not null
      and pricing_evidence_hash ~ '^[0-9a-f]{64}$'
    )
  ),
  add constraint quotes_snapshot_execution_gate_check check (
    repository_binding_id is null
    or status not in ('pending', 'approved')
    or (
      coalesce(
        (eligibility_decision ->> 'eligible')::boolean,
        false
      ) is true
      and coalesce(pricing_evidence ->> 'estimatorDecision', '')
        in ('accept', 'accept_with_conditions')
      and (
        pricing_evidence ->> 'estimatorDecision' <> 'accept_with_conditions'
        or case
          when jsonb_typeof(
            pricing_evidence -> 'executionConditions'
          ) = 'array'
          then jsonb_array_length(
            pricing_evidence -> 'executionConditions'
          ) > 0
          else false
        end
      )
    )
  ),
  add constraint quotes_repository_binding_evidence_fkey foreign key (
    repository_binding_id,
    user_id,
    repository_snapshot_id,
    manifest_hash,
    github_repository_id,
    repository_base_branch,
    repository_sha,
    repository_url,
    repository_full_name
  ) references public.repository_bindings (
    id,
    user_id,
    snapshot_id,
    manifest_hash,
    github_repository_id,
    base_branch,
    base_sha,
    repository_url,
    repository_full_name
  ) on delete restrict,
  add constraint quotes_underwriting_identity_key unique (
    id,
    user_id,
    repository_binding_id,
    repository_snapshot_id,
    manifest_hash,
    repository_url,
    repository_full_name,
    github_repository_id,
    repository_base_branch,
    repository_sha,
    pricing_evidence_hash
  );

create index quotes_repository_binding_id_idx
  on public.quotes(repository_binding_id)
  where repository_binding_id is not null;

alter table public.quote_underwriting
  add column repository_binding_id uuid,
  add column repository_snapshot_id uuid,
  add column manifest_hash text,
  add column pricing_policy_version text,
  add column policy_components_json jsonb,
  add column pricing_evidence_hash text,
  add column repository_url text,
  add column repository_full_name text,
  add column github_repository_id bigint,
  add column repository_base_branch text,
  add column repository_sha text,
  add constraint quote_underwriting_repository_evidence_complete_check check (
    (
      repository_binding_id is null
      and repository_snapshot_id is null
      and manifest_hash is null
      and pricing_policy_version is null
      and policy_components_json is null
      and pricing_evidence_hash is null
      and repository_url is null
      and repository_full_name is null
      and github_repository_id is null
      and repository_base_branch is null
      and repository_sha is null
    )
    or (
      repository_binding_id is not null
      and repository_snapshot_id is not null
      and manifest_hash is not null
      and manifest_hash ~ '^[0-9a-f]{64}$'
      and pricing_policy_version is not null
      and char_length(pricing_policy_version) between 1 and 120
      and policy_components_json is not null
      and jsonb_typeof(policy_components_json) = 'object'
      and pricing_evidence_hash is not null
      and pricing_evidence_hash ~ '^[0-9a-f]{64}$'
      and repository_url is not null
      and repository_full_name is not null
      and github_repository_id is not null
      and github_repository_id > 0
      and repository_base_branch is not null
      and char_length(repository_base_branch) between 1 and 255
      and repository_sha is not null
      and repository_sha ~ '^[0-9a-f]{40}$'
    )
  ),
  add constraint quote_underwriting_repository_evidence_fkey foreign key (
    quote_id,
    user_id,
    repository_binding_id,
    repository_snapshot_id,
    manifest_hash,
    repository_url,
    repository_full_name,
    github_repository_id,
    repository_base_branch,
    repository_sha,
    pricing_evidence_hash
  ) references public.quotes (
    id,
    user_id,
    repository_binding_id,
    repository_snapshot_id,
    manifest_hash,
    repository_url,
    repository_full_name,
    github_repository_id,
    repository_base_branch,
    repository_sha,
    pricing_evidence_hash
  ) on delete cascade;

alter table public.tasks
  add column repository_binding_id uuid,
  add column repository_snapshot_id uuid,
  add column manifest_hash text,
  add column repository_full_name text,
  add column github_repository_id bigint,
  add column repository_base_branch text,
  add constraint tasks_repository_evidence_complete_check check (
    (
      repository_binding_id is null
      and repository_snapshot_id is null
      and manifest_hash is null
      and repository_full_name is null
      and github_repository_id is null
      and repository_base_branch is null
    )
    or (
      repository_binding_id is not null
      and repository_snapshot_id is not null
      and manifest_hash is not null
      and manifest_hash ~ '^[0-9a-f]{64}$'
      and repository_full_name is not null
      and repository_full_name ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'
      and github_repository_id is not null
      and github_repository_id > 0
      and repository_base_branch is not null
      and char_length(repository_base_branch) between 1 and 255
      and repository_url is not null
      and repository_sha is not null
    )
  ),
  add constraint tasks_repository_binding_evidence_fkey foreign key (
    repository_binding_id,
    user_id,
    repository_snapshot_id,
    manifest_hash,
    github_repository_id,
    repository_base_branch,
    repository_sha,
    repository_url,
    repository_full_name
  ) references public.repository_bindings (
    id,
    user_id,
    snapshot_id,
    manifest_hash,
    github_repository_id,
    base_branch,
    base_sha,
    repository_url,
    repository_full_name
  ) on delete restrict;

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (char_length(request_id) between 8 and 160),
  repository_binding_id uuid not null,
  repository_snapshot_id uuid not null,
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  repository_url text not null,
  repository_full_name text not null,
  github_repository_id bigint not null check (github_repository_id > 0),
  repository_base_branch text not null check (
    char_length(repository_base_branch) between 1 and 255
  ),
  repository_sha text not null check (repository_sha ~ '^[0-9a-f]{40}$'),
  task_spec jsonb not null check (jsonb_typeof(task_spec) = 'object'),
  task_hash text not null check (task_hash ~ '^[0-9a-f]{64}$'),
  source_evidence jsonb check (
    source_evidence is null or jsonb_typeof(source_evidence) = 'object'
  ),
  source_content_hash text check (
    source_content_hash is null
    or source_content_hash ~ '^[0-9a-f]{64}$'
  ),
  request_fingerprint text not null check (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  analysis_json jsonb not null check (jsonb_typeof(analysis_json) = 'object'),
  estimate_json jsonb not null check (jsonb_typeof(estimate_json) = 'object'),
  decision text not null check (
    decision in ('accept', 'accept_with_conditions', 'decompose', 'decline')
  ),
  execution_eligibility jsonb not null check (
    jsonb_typeof(execution_eligibility) = 'object'
  ),
  customer_factors jsonb not null check (
    jsonb_typeof(customer_factors) = 'array'
  ),
  pricing_evidence jsonb not null check (
    jsonb_typeof(pricing_evidence) = 'object'
  ),
  pricing_evidence_hash text not null check (
    pricing_evidence_hash ~ '^[0-9a-f]{64}$'
  ),
  underwriting_json jsonb not null check (
    jsonb_typeof(underwriting_json) = 'object'
  ),
  pricing_policy_version text not null check (
    char_length(pricing_policy_version) between 1 and 120
  ),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint assessments_user_request_key unique (user_id, request_id),
  constraint assessments_id_user_key unique (id, user_id),
  constraint assessments_source_evidence_complete_check check (
    (source_evidence is null and source_content_hash is null)
    or (
      source_evidence is not null
      and source_content_hash is not null
      and coalesce(source_evidence ->> 'content_sha256', '') =
        source_content_hash
    )
  ),
  constraint assessments_repository_binding_evidence_fkey foreign key (
    repository_binding_id,
    user_id,
    repository_snapshot_id,
    manifest_hash,
    github_repository_id,
    repository_base_branch,
    repository_sha,
    repository_url,
    repository_full_name
  ) references public.repository_bindings (
    id,
    user_id,
    snapshot_id,
    manifest_hash,
    github_repository_id,
    base_branch,
    base_sha,
    repository_url,
    repository_full_name
  ) on delete restrict
);

create index assessments_user_id_created_at_idx
  on public.assessments(user_id, created_at desc);
create index assessments_repository_binding_id_idx
  on public.assessments(repository_binding_id);
create index assessments_source_content_hash_idx
  on public.assessments(source_content_hash)
  where source_content_hash is not null;

create function public.prevent_immutable_pricing_evidence_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Assessment and underwriting evidence is immutable';
end;
$$;

create trigger assessments_prevent_update
before update on public.assessments
for each row execute function public.prevent_immutable_pricing_evidence_update();

create trigger quote_underwriting_prevent_update
before update on public.quote_underwriting
for each row execute function public.prevent_immutable_pricing_evidence_update();

create function public.protect_task_repository_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.repository_binding_id is distinct from old.repository_binding_id
    or new.repository_snapshot_id is distinct from old.repository_snapshot_id
    or new.manifest_hash is distinct from old.manifest_hash
    or new.repository_url is distinct from old.repository_url
    or new.repository_full_name is distinct from old.repository_full_name
    or new.github_repository_id is distinct from old.github_repository_id
    or new.repository_base_branch is distinct from old.repository_base_branch
    or new.repository_sha is distinct from old.repository_sha
  then
    raise exception 'Task repository evidence is immutable';
  end if;

  return new;
end;
$$;

create trigger tasks_protect_repository_evidence
before update on public.tasks
for each row execute function public.protect_task_repository_evidence();

create or replace function public.protect_approved_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.repository_binding_id is distinct from old.repository_binding_id
    or new.repository_snapshot_id is distinct from old.repository_snapshot_id
    or new.manifest_hash is distinct from old.manifest_hash
    or new.repository_full_name is distinct from old.repository_full_name
    or new.github_repository_id is distinct from old.github_repository_id
    or new.repository_base_branch is distinct from old.repository_base_branch
    or new.pricing_policy_version is distinct from old.pricing_policy_version
    or new.pricing_evidence is distinct from old.pricing_evidence
    or new.pricing_evidence_hash is distinct from old.pricing_evidence_hash
  then
    raise exception 'Quote repository and pricing evidence is immutable';
  end if;

  if old.repository_binding_id is not null and (
    new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
    or new.terms is distinct from old.terms
    or new.pricing_model_version is distinct from old.pricing_model_version
    or new.user_id is distinct from old.user_id
    or new.request_id is distinct from old.request_id
    or new.repository_url is distinct from old.repository_url
    or new.repository_sha is distinct from old.repository_sha
    or new.task_spec is distinct from old.task_spec
    or new.eligibility_decision is distinct from old.eligibility_decision
    or new.expires_at is distinct from old.expires_at
    or new.contract_hash is distinct from old.contract_hash
  ) then
    raise exception 'Snapshot-backed quote contract is immutable';
  end if;

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

create function public.create_snapshot_quote_with_underwriting(
  p_user_id uuid,
  p_quote jsonb,
  p_underwriting jsonb
)
returns table (
  quote_id uuid,
  created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_quote_id uuid;
  inserted_quote_id uuid;
begin
  if jsonb_typeof(p_quote) is distinct from 'object'
    or jsonb_typeof(p_underwriting) is distinct from 'object'
  then
    raise exception 'Invalid atomic quote payload'
      using errcode = '22023';
  end if;

  if p_quote ->> 'request_id' is null
    or char_length(p_quote ->> 'request_id') not between 8 and 160
  then
    raise exception 'Invalid quote idempotency key'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || ':' || (p_quote ->> 'request_id'),
      0
    )
  );

  select quote.id
  into existing_quote_id
  from public.quotes as quote
  where quote.user_id = p_user_id
    and quote.request_id = p_quote ->> 'request_id';

  if found then
    if not exists (
      select 1
      from public.quote_underwriting as underwriting
      join public.quotes as quote
        on quote.id = underwriting.quote_id
        and quote.user_id = underwriting.user_id
      where quote.id = existing_quote_id
        and quote.user_id = p_user_id
        and underwriting.repository_binding_id =
          quote.repository_binding_id
        and underwriting.repository_snapshot_id =
          quote.repository_snapshot_id
        and underwriting.manifest_hash = quote.manifest_hash
        and underwriting.pricing_evidence_hash =
          quote.pricing_evidence_hash
        and underwriting.pricing_policy_version =
          quote.pricing_policy_version
    ) then
      raise exception 'Existing snapshot quote has no matching underwriting'
        using errcode = '23514';
    end if;

    return query select existing_quote_id, false;
    return;
  end if;

  insert into public.quotes (
    user_id,
    request_id,
    repository_binding_id,
    repository_snapshot_id,
    manifest_hash,
    repository_url,
    repository_full_name,
    github_repository_id,
    repository_base_branch,
    repository_sha,
    task_spec,
    eligibility_decision,
    amount_cents,
    currency,
    terms,
    pricing_model_version,
    pricing_policy_version,
    pricing_evidence,
    pricing_evidence_hash,
    status,
    expires_at,
    contract_hash
  )
  values (
    p_user_id,
    p_quote ->> 'request_id',
    (p_quote ->> 'repository_binding_id')::uuid,
    (p_quote ->> 'repository_snapshot_id')::uuid,
    p_quote ->> 'manifest_hash',
    p_quote ->> 'repository_url',
    p_quote ->> 'repository_full_name',
    (p_quote ->> 'github_repository_id')::bigint,
    p_quote ->> 'repository_base_branch',
    p_quote ->> 'repository_sha',
    p_quote -> 'task_spec',
    p_quote -> 'eligibility_decision',
    (p_quote ->> 'amount_cents')::integer,
    p_quote ->> 'currency',
    p_quote ->> 'terms',
    p_quote ->> 'pricing_model_version',
    p_quote ->> 'pricing_model_version',
    p_quote -> 'pricing_evidence',
    p_quote ->> 'pricing_evidence_hash',
    p_quote ->> 'status',
    (p_quote ->> 'expires_at')::timestamptz,
    p_quote ->> 'contract_hash'
  )
  returning id into inserted_quote_id;

  insert into public.quote_underwriting (
    quote_id,
    user_id,
    repository_binding_id,
    repository_snapshot_id,
    manifest_hash,
    repository_url,
    repository_full_name,
    github_repository_id,
    repository_base_branch,
    repository_sha,
    pricing_evidence_hash,
    predicted_cost_usd_micros,
    internal_budget_usd_micros,
    risk_multiplier,
    usd_to_aud_rate,
    analysis_json,
    estimate_json,
    estimator_id,
    estimator_version,
    rate_card_version,
    pricing_policy_version,
    policy_components_json
  )
  values (
    inserted_quote_id,
    p_user_id,
    (p_quote ->> 'repository_binding_id')::uuid,
    (p_quote ->> 'repository_snapshot_id')::uuid,
    p_quote ->> 'manifest_hash',
    p_quote ->> 'repository_url',
    p_quote ->> 'repository_full_name',
    (p_quote ->> 'github_repository_id')::bigint,
    p_quote ->> 'repository_base_branch',
    p_quote ->> 'repository_sha',
    p_quote ->> 'pricing_evidence_hash',
    (p_underwriting ->> 'predicted_cost_usd_micros')::bigint,
    (p_underwriting ->> 'internal_budget_usd_micros')::bigint,
    (p_underwriting ->> 'risk_multiplier')::numeric,
    (p_underwriting ->> 'usd_to_aud_rate')::numeric,
    p_underwriting -> 'analysis_json',
    p_underwriting -> 'estimate_json',
    p_underwriting ->> 'estimator_id',
    p_underwriting ->> 'estimator_version',
    p_underwriting ->> 'rate_card_version',
    p_quote ->> 'pricing_model_version',
    p_underwriting -> 'policy_components_json'
  );

  return query select inserted_quote_id, true;
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
  accepted_at_value timestamptz := pg_catalog.now();
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

  if selected_quote.repository_binding_id is not null and (
    coalesce(
      selected_quote.pricing_evidence ->> 'estimatorDecision',
      ''
    ) not in ('accept', 'accept_with_conditions')
    or (
      selected_quote.pricing_evidence ->> 'estimatorDecision'
        = 'accept_with_conditions'
      and not case
        when jsonb_typeof(
          selected_quote.pricing_evidence -> 'executionConditions'
        ) = 'array'
        then jsonb_array_length(
          selected_quote.pricing_evidence -> 'executionConditions'
        ) > 0
        else false
      end
    )
  ) then
    raise exception 'Quote estimator decision is not executable'
      using errcode = '22023';
  end if;

  if selected_quote.repository_binding_id is not null
    and not exists (
      select 1
      from public.quote_underwriting as underwriting
      where underwriting.quote_id = selected_quote.id
        and underwriting.user_id = selected_quote.user_id
        and underwriting.repository_binding_id =
          selected_quote.repository_binding_id
        and underwriting.repository_snapshot_id =
          selected_quote.repository_snapshot_id
        and underwriting.manifest_hash = selected_quote.manifest_hash
        and underwriting.repository_url = selected_quote.repository_url
        and underwriting.repository_full_name =
          selected_quote.repository_full_name
        and underwriting.github_repository_id =
          selected_quote.github_repository_id
        and underwriting.repository_base_branch =
          selected_quote.repository_base_branch
        and underwriting.repository_sha = selected_quote.repository_sha
        and underwriting.pricing_policy_version =
          selected_quote.pricing_policy_version
        and underwriting.pricing_evidence_hash =
          selected_quote.pricing_evidence_hash
        and underwriting.estimator_id =
          selected_quote.pricing_evidence #>> '{estimator,id}'
        and underwriting.estimator_version =
          selected_quote.pricing_evidence #>> '{estimator,version}'
    )
  then
    raise exception 'Quote underwriting evidence does not match'
      using errcode = '22023';
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

    return query
      select null::uuid, false, 'expired'::text;
    return;
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

  if selected_quote.repository_binding_id is not null
    and not exists (
      select 1
      from public.repository_bindings as binding
      where binding.id = selected_quote.repository_binding_id
        and binding.user_id = selected_quote.user_id
        and binding.snapshot_id = selected_quote.repository_snapshot_id
        and binding.manifest_hash = selected_quote.manifest_hash
        and binding.github_repository_id = selected_quote.github_repository_id
        and binding.base_branch = selected_quote.repository_base_branch
        and binding.base_sha = selected_quote.repository_sha
        and binding.repository_url = selected_quote.repository_url
        and binding.repository_full_name = selected_quote.repository_full_name
    )
  then
    raise exception 'Quote repository evidence does not match'
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
    repository_binding_id,
    repository_snapshot_id,
    manifest_hash,
    repository_full_name,
    github_repository_id,
    repository_base_branch,
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
    selected_quote.repository_binding_id,
    selected_quote.repository_snapshot_id,
    selected_quote.manifest_hash,
    selected_quote.repository_full_name,
    selected_quote.github_repository_id,
    selected_quote.repository_base_branch,
    selected_quote.task_spec,
    p_idempotency_key,
    'quote-' || selected_quote.id::text,
    'cursor',
    'cloud'
  )
  on conflict (quote_id) do update
    set quote_id = excluded.quote_id
  returning * into accepted_task;

  if accepted_task.repository_binding_id is distinct from selected_quote.repository_binding_id
    or accepted_task.repository_snapshot_id is distinct from selected_quote.repository_snapshot_id
    or accepted_task.manifest_hash is distinct from selected_quote.manifest_hash
  then
    raise exception 'Accepted task repository evidence does not match'
      using errcode = '22023';
  end if;

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
      'contract_hash', selected_quote.contract_hash,
      'repository_binding_id', selected_quote.repository_binding_id,
      'repository_snapshot_id', selected_quote.repository_snapshot_id,
      'manifest_hash', selected_quote.manifest_hash
    )
  );

  return query
    select accepted_task.id, true, accepted_task.status;
end;
$$;

alter table public.assessments enable row level security;

revoke all on table public.assessments
  from public, anon, authenticated, service_role;
grant select, insert on table public.assessments to service_role;

revoke update on table public.quote_underwriting from service_role;

revoke all on function public.create_snapshot_quote_with_underwriting(
  uuid,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_snapshot_quote_with_underwriting(
  uuid,
  jsonb,
  jsonb
) to service_role;

revoke all on function public.prevent_immutable_pricing_evidence_update()
  from public, anon, authenticated, service_role;
revoke all on function public.protect_task_repository_evidence()
  from public, anon, authenticated, service_role;
