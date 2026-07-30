begin;

create extension if not exists pgtap with schema extensions;
select plan(1);

set local session_replication_role = replica;

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001');

insert into public.quotes (
  id,
  user_id,
  task_id,
  amount_cents,
  terms,
  pricing_model_version,
  status,
  approved_at,
  request_id,
  repository_url,
  repository_sha,
  task_spec,
  eligibility_decision,
  expires_at,
  contract_hash,
  accepted_at,
  acceptance_idempotency_key,
  repository_binding_id,
  repository_snapshot_id,
  manifest_hash,
  repository_full_name,
  github_repository_id,
  repository_base_branch,
  pricing_policy_version,
  pricing_evidence,
  pricing_evidence_hash
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    1000,
    'Test terms',
    'snapshot-v1',
    'approved',
    now(),
    'snapshot-request',
    'https://github.com/acme/repo',
    repeat('a', 40),
    '{"description":"Change one file.","acceptanceCriteria":["The change is correct."],"prohibitedChanges":["Do not change auth."]}',
    '{"eligible":true}',
    now() + interval '1 day',
    repeat('d', 64),
    now(),
    'snapshot-acceptance',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    repeat('b', 64),
    'acme/repo',
    101,
    'main',
    'snapshot-v1',
    '{"estimatorDecision":"accept"}',
    repeat('e', 64)
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    1000,
    'Test terms',
    'legacy-v1',
    'approved',
    now(),
    'legacy-request',
    'https://github.com/acme/repo',
    repeat('c', 40),
    '{"description":"Legacy task.","acceptanceCriteria":["Legacy task passes."],"prohibitedChanges":[]}',
    '{"eligible":true}',
    now() + interval '1 day',
    repeat('f', 64),
    now(),
    'legacy-acceptance',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null
  );

insert into public.tasks (
  id,
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
  worker_runtime,
  agent_id,
  run_id
) values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'Snapshot task',
    'Change one file.',
    'The change is correct.',
    'approved',
    'https://github.com/acme/repo',
    repeat('a', 40),
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    repeat('b', 64),
    'acme/repo',
    101,
    'main',
    '{"description":"Change one file.","acceptanceCriteria":["The change is correct."],"prohibitedChanges":["Do not change auth."]}',
    'snapshot-task',
    'snapshot-task',
    'cursor',
    'isolated_local',
    null,
    null
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    'Legacy cloud task',
    'Legacy task.',
    'Legacy task passes.',
    'starting',
    'https://github.com/acme/repo',
    repeat('c', 40),
    null,
    null,
    null,
    null,
    null,
    null,
    '{"description":"Legacy task.","acceptanceCriteria":["Legacy task passes."],"prohibitedChanges":[]}',
    'legacy-task',
    'legacy-task',
    'cursor',
    'cloud',
    'legacy-agent',
    'legacy-run'
  );

do $$
declare
  due_claim record;
  first_claim record;
  reclaimed record;
begin
  select * into first_claim
  from public.claim_task_executions('postgres-test', 5, 90);

  if first_claim.task_id is distinct from
    '20000000-0000-4000-8000-000000000001'::uuid
  then
    raise exception 'Snapshot isolated task was not claimed';
  end if;

  if exists (
    select 1 from public.claim_task_executions('second-worker', 5, 90)
  ) then
    raise exception 'An active task execution was claimed twice';
  end if;

  if exists (
    select 1
    from public.task_execution_attempts
    where task_id = '20000000-0000-4000-8000-000000000002'::uuid
  ) then
    raise exception 'Legacy cloud execution evidence was overwritten';
  end if;

  update public.task_execution_attempts
  set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
  where id = first_claim.attempt_id;

  select * into reclaimed
  from public.claim_task_executions('recovery-worker', 1, 90);

  if reclaimed.claim_token = first_claim.claim_token then
    raise exception 'A stale claim was not fenced with a new token';
  end if;

  if public.renew_task_execution_lease(
    first_claim.attempt_id,
    first_claim.claim_token,
    90
  ) then
    raise exception 'A stale claimant renewed the recovered lease';
  end if;

  if public.fail_task_execution(
    first_claim.attempt_id,
    first_claim.claim_token,
    'stale',
    'stale',
    'stale'
  ) then
    raise exception 'A stale claimant terminalized recovered work';
  end if;

  if not public.renew_task_execution_lease(
    reclaimed.attempt_id,
    reclaimed.claim_token,
    90
  ) then
    raise exception 'The current claimant could not renew its lease';
  end if;

  if not public.defer_task_execution(
    reclaimed.attempt_id,
    reclaimed.claim_token,
    30,
    'retryable test failure'
  ) then
    raise exception 'The current claimant could not defer retryable work';
  end if;

  if exists (
    select 1 from public.claim_task_executions('early-worker', 1, 90)
  ) then
    raise exception 'Retry backoff was not respected';
  end if;

  update public.task_execution_attempts
  set next_attempt_at = pg_catalog.clock_timestamp() - interval '1 second'
  where id = reclaimed.attempt_id;

  select * into due_claim
  from public.claim_task_executions('due-retry-worker', 1, 90);

  if due_claim.attempt_id is distinct from reclaimed.attempt_id
    or due_claim.failure_count <> 1
  then
    raise exception 'A due retry was not reclaimed with retained evidence';
  end if;

  if not public.record_task_execution_prepublication(
    due_claim.attempt_id,
    due_claim.claim_token,
    'agent-1',
    'run-1',
    'composer-2.5',
    '{"inputTokens":10}',
    '{"summary":"done"}',
    '{"branch":"outcomes/task-test","changes":[{"path":"src/a.ts","status":"modified","mode":"100644","contentBase64":"YQ=="}]}',
    90
  ) then
    raise exception 'Prepublication evidence could not be recorded';
  end if;

  if not public.complete_task_execution(
    due_claim.attempt_id,
    due_claim.claim_token,
    '{"baseSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","changedFiles":["src/a.ts"]}',
    '{"branch":"outcomes/task-test","commitSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","prUrl":"https://github.com/acme/repo/pull/1"}'
  ) then
    raise exception 'The current claimant could not complete execution';
  end if;

  if exists (
    select 1 from public.claim_task_executions('terminal-worker', 1, 90)
  ) then
    raise exception 'A terminal execution was reclaimed';
  end if;

  if not exists (
    select 1
    from public.task_execution_attempts
    where id = due_claim.attempt_id
      and state = 'succeeded'
      and completed_at is not null
  ) then
    raise exception 'Successful execution evidence was not retained';
  end if;
end;
$$;

set local session_replication_role = origin;

do $$
begin
  if not (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.task_execution_attempts'::regclass
  ) then
    raise exception 'RLS is disabled on task_execution_attempts';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.renew_task_execution_lease(uuid,uuid,integer)',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot renew leases';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.task_execution_attempts',
    'SELECT, INSERT, UPDATE'
  ) then
    raise exception 'service_role lacks execution-attempt table privileges';
  end if;

  if has_table_privilege(
    'anon',
    'public.task_execution_attempts',
    'SELECT'
  ) or has_table_privilege(
    'authenticated',
    'public.task_execution_attempts',
    'SELECT'
  ) then
    raise exception 'A public API role can read execution attempts';
  end if;

  if has_function_privilege(
    'anon',
    'public.renew_task_execution_lease(uuid,uuid,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.renew_task_execution_lease(uuid,uuid,integer)',
    'EXECUTE'
  ) then
    raise exception 'A public API role can renew internal leases';
  end if;

  if has_function_privilege(
    'anon',
    'public.complete_task_execution(uuid,uuid,jsonb,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_task_execution(uuid,uuid,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'A public API role can complete task execution';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.payments',
    'INSERT'
  ) or has_table_privilege(
    'authenticated',
    'public.payments',
    'UPDATE'
  ) then
    raise exception 'Authenticated clients can mutate payment evidence';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.payments'::regclass
      and tgname = 'payments_protect_reservation_evidence'
      and not tgisinternal
  ) then
    raise exception 'Payment reservation evidence is not trigger-protected';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.protect_payment_reservation_evidence()',
    'EXECUTE'
  ) then
    raise exception 'Authenticated clients can execute payment protection internals';
  end if;
end;
$$;

select pass('task execution claims, payment evidence, RLS, and grants hold');
select * from finish();

rollback;
