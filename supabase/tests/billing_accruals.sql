begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

set local session_replication_role = replica;

insert into auth.users (id)
values ('10000000-0000-4000-8000-000000000010');

insert into public.billing_accounts (
  id,
  user_id,
  provider_payer_id,
  status,
  setup_completed_at
) values (
  '11000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000010',
  'payer-accrual-test',
  'ready',
  now()
);

insert into public.payment_sources (
  id,
  user_id,
  billing_account_id,
  provider_source_id,
  source_type,
  is_default
) values (
  '12000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000010',
  '11000000-0000-4000-8000-000000000010',
  'source-accrual-test',
  'credit-card',
  true
);

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
  acceptance_idempotency_key
) values
  (
    '30000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000010',
    '20000000-0000-4000-8000-000000000011',
    600,
    'Accrue after verification.',
    'accrual-test-v1',
    'approved',
    now(),
    'accrual-request-1',
    'https://github.com/acme/repo',
    repeat('a', 40),
    '{"description":"Task one.","acceptanceCriteria":["Pass."],"prohibitedChanges":[]}',
    '{"eligible":true}',
    now() + interval '1 day',
    repeat('a', 64),
    now(),
    'accrual-acceptance-1'
  ),
  (
    '30000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000010',
    '20000000-0000-4000-8000-000000000012',
    600,
    'Accrue after verification.',
    'accrual-test-v1',
    'approved',
    now(),
    'accrual-request-2',
    'https://github.com/acme/repo',
    repeat('b', 40),
    '{"description":"Task two.","acceptanceCriteria":["Pass."],"prohibitedChanges":[]}',
    '{"eligible":true}',
    now() + interval '1 day',
    repeat('b', 64),
    now(),
    'accrual-acceptance-2'
  ),
  (
    '30000000-0000-4000-8000-000000000013',
    '10000000-0000-4000-8000-000000000010',
    '20000000-0000-4000-8000-000000000013',
    1000,
    'Accrue after verification.',
    'accrual-test-v1',
    'approved',
    now(),
    'accrual-request-3',
    'https://github.com/acme/repo',
    repeat('c', 40),
    '{"description":"Task three.","acceptanceCriteria":["Pass."],"prohibitedChanges":[]}',
    '{"eligible":true}',
    now() + interval '1 day',
    repeat('c', 64),
    now(),
    'accrual-acceptance-3'
  );

insert into public.tasks (
  id,
  user_id,
  quote_id,
  title,
  description,
  acceptance_criteria,
  status,
  verified_at,
  repository_url,
  repository_sha,
  task_spec,
  idempotency_key,
  external_ref
) values
  (
    '20000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000010',
    '30000000-0000-4000-8000-000000000011',
    'Task one',
    'Task one.',
    'Pass.',
    'verified',
    now(),
    'https://github.com/acme/repo',
    repeat('a', 40),
    '{"description":"Task one.","acceptanceCriteria":["Pass."],"prohibitedChanges":[]}',
    'accrual-task-1',
    'accrual-task-1'
  ),
  (
    '20000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000010',
    '30000000-0000-4000-8000-000000000012',
    'Task two',
    'Task two.',
    'Pass.',
    'verified',
    now(),
    'https://github.com/acme/repo',
    repeat('b', 40),
    '{"description":"Task two.","acceptanceCriteria":["Pass."],"prohibitedChanges":[]}',
    'accrual-task-2',
    'accrual-task-2'
  ),
  (
    '20000000-0000-4000-8000-000000000013',
    '10000000-0000-4000-8000-000000000010',
    '30000000-0000-4000-8000-000000000013',
    'Task three',
    'Task three.',
    'Pass.',
    'verified',
    now(),
    'https://github.com/acme/repo',
    repeat('c', 40),
    '{"description":"Task three.","acceptanceCriteria":["Pass."],"prohibitedChanges":[]}',
    'accrual-task-3',
    'accrual-task-3'
  );

set local session_replication_role = origin;

select lives_ok(
  $$select * from public.accrue_verified_task(
    '20000000-0000-4000-8000-000000000011'
  )$$,
  'a verified task accrues'
);

select is(
  (
    select status
    from public.tasks
    where id = '20000000-0000-4000-8000-000000000011'
  ),
  'completed',
  'accrual completes delivery independently from payment'
);

select is(
  (
    select count(*)
    from public.claim_billing_accruals(
      '10000000-0000-4000-8000-000000000010',
      1000
    )
  ),
  0::bigint,
  'a balance below the threshold is not claimed'
);

select is(
  (
    select count(*)
    from public.list_billing_settlement_candidates(1000, 25)
  ),
  0::bigint,
  'below-threshold users do not consume settlement candidate slots'
);

select lives_ok(
  $$select * from public.accrue_verified_task(
    '20000000-0000-4000-8000-000000000012'
  )$$,
  'a second verified task accrues'
);

create temporary table first_claim as
select *
from public.claim_billing_accruals(
  '10000000-0000-4000-8000-000000000010',
  1000
);

select is(
  (select amount_cents from first_claim),
  1200,
  'the threshold claim uses the full outstanding balance'
);

select is(
  (
    select count(*)
    from public.payment_allocations
    where payment_id = (select payment_id from first_claim)
      and status = 'active'
  ),
  2::bigint,
  'the payment contains exactly the claimed task allocations'
);

select lives_ok(
  $$select * from public.accrue_verified_task(
    '20000000-0000-4000-8000-000000000013'
  )$$,
  'a task finishing after the claim accrues separately'
);

select results_eq(
  $$
    select task_id::text, status
    from public.billing_accruals
    order by task_id
  $$,
  $$
    values
      ('20000000-0000-4000-8000-000000000011', 'charging'),
      ('20000000-0000-4000-8000-000000000012', 'charging'),
      ('20000000-0000-4000-8000-000000000013', 'accrued')
  $$,
  'an unclaimed task is not included in an in-flight payment'
);

update public.payments
set status = 'approved', charged_at = now()
where id = (select payment_id from first_claim);

select results_eq(
  $$
    select task_id::text, status
    from public.billing_accruals
    order by task_id
  $$,
  $$
    values
      ('20000000-0000-4000-8000-000000000011', 'charged'),
      ('20000000-0000-4000-8000-000000000012', 'charged'),
      ('20000000-0000-4000-8000-000000000013', 'accrued')
  $$,
  'only allocations in the successful payment become charged'
);

update public.payments
set status = 'failed'
where id = (select payment_id from first_claim);

select is(
  (
    select status
    from public.payments
    where id = (select payment_id from first_claim)
  ),
  'approved',
  'a late failure cannot reopen an approved payment'
);

update public.payments
set status = 'settled', settled_at = now()
where id = (select payment_id from first_claim);

update public.payments
set status = 'failed'
where id = (select payment_id from first_claim);

select is(
  (
    select status
    from public.payments
    where id = (select payment_id from first_claim)
  ),
  'settled',
  'a late failure cannot regress a settled payment'
);

select is(
  (
    select count(*)
    from public.billing_accruals
    where payment_id = (select payment_id from first_claim)
      and status = 'charged'
  ),
  2::bigint,
  'settled allocations remain paid after a late failure'
);

create temporary table second_claim as
select *
from public.claim_billing_accruals(
  '10000000-0000-4000-8000-000000000010',
  1000
);

select is(
  (select amount_cents from second_claim),
  1000,
  'the later task is claimed in a separate payment'
);

update public.payments
set status = 'failed'
where id = (select payment_id from second_claim);

select results_eq(
  $$
    select accrual.status, allocation.status
    from public.billing_accruals as accrual
    join public.payment_allocations as allocation
      on allocation.task_id = accrual.task_id
    where accrual.task_id = '20000000-0000-4000-8000-000000000013'
  $$,
  $$values ('accrued', 'released')$$,
  'a failed payment releases only its own task for a later retry'
);

select * from finish();
rollback;
