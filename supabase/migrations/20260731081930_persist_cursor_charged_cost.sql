create or replace function public.complete_task_execution(
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
    actual_cost_usd_micros = case
      when jsonb_typeof(selected_attempt.usage) = 'object'
        and jsonb_typeof(
          selected_attempt.usage -> 'chargedCostUsd'
        ) = 'number'
      then pg_catalog.round(
        (selected_attempt.usage ->> 'chargedCostUsd')::numeric
          * 1000000
      )::bigint
      else null
    end,
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
