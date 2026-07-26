create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  company_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  provider text not null default 'pinch' check (provider = 'pinch'),
  environment text not null default 'test' check (environment in ('test', 'live')),
  provider_payer_id text unique,
  status text not null default 'pending' check (
    status in ('pending', 'ready', 'action_required', 'disabled')
  ),
  setup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ready_billing_account_has_payer check (
    status <> 'ready'
    or (provider_payer_id is not null and setup_completed_at is not null)
  )
);

create table public.payment_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_account_id uuid not null references public.billing_accounts(id) on delete cascade,
  provider_source_id text not null unique,
  source_type text not null check (source_type in ('credit-card', 'bank-account')),
  display_name text,
  last_four text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  card_scheme text,
  expiry_month integer check (expiry_month between 1 and 12),
  expiry_year integer check (expiry_year between 2020 and 2200),
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  unique (billing_account_id, provider_source_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null check (char_length(description) between 1 and 4000),
  acceptance_criteria text not null check (
    char_length(acceptance_criteria) between 1 and 4000
  ),
  status text not null default 'quoted' check (
    status in (
      'quoted',
      'approved',
      'executing',
      'verified',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  verified_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'AUD' check (currency = 'AUD'),
  terms text not null check (char_length(terms) between 1 and 2000),
  pricing_model_version text not null,
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'declined', 'expired')
  ),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint approved_quote_has_timestamp check (
    status <> 'approved' or approved_at is not null
  )
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null unique references public.tasks(id) on delete restrict,
  quote_id uuid not null unique references public.quotes(id) on delete restrict,
  billing_account_id uuid not null references public.billing_accounts(id) on delete restrict,
  payment_source_id uuid not null references public.payment_sources(id) on delete restrict,
  provider text not null default 'pinch' check (provider = 'pinch'),
  environment text not null default 'test' check (environment in ('test', 'live')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'AUD' check (currency = 'AUD'),
  nonce text not null unique check (char_length(nonce) between 1 and 250),
  provider_payment_id text unique,
  provider_attempt_id text,
  status text not null default 'reserved' check (
    status in (
      'reserved',
      'submitting',
      'approved',
      'pending',
      'settled',
      'failed',
      'unknown'
    )
  ),
  failure_code text,
  failure_message text,
  charged_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'pinch' check (provider = 'pinch'),
  provider_event_id text not null unique,
  event_type text not null,
  provider_payment_id text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create index payment_sources_user_id_idx
  on public.payment_sources(user_id);
create index tasks_user_id_created_at_idx
  on public.tasks(user_id, created_at desc);
create index quotes_user_id_created_at_idx
  on public.quotes(user_id, created_at desc);
create index payments_user_id_created_at_idx
  on public.payments(user_id, created_at desc);
create index payments_billing_account_id_idx
  on public.payments(billing_account_id);
create index payments_payment_source_id_idx
  on public.payments(payment_source_id);
create index payments_provider_payment_id_idx
  on public.payments(provider_payment_id)
  where provider_payment_id is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger billing_accounts_set_updated_at
before update on public.billing_accounts
for each row execute function public.set_updated_at();

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger create_profile_after_signup
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.protect_approved_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved' and (
    new.amount_cents <> old.amount_cents
    or new.currency <> old.currency
    or new.terms <> old.terms
    or new.pricing_model_version <> old.pricing_model_version
    or new.task_id <> old.task_id
    or new.user_id <> old.user_id
  ) then
    raise exception 'Approved quote terms are immutable';
  end if;

  return new;
end;
$$;

create trigger protect_approved_quote
before update on public.quotes
for each row execute function public.protect_approved_quote();

alter table public.profiles enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.payment_sources enable row level security;
alter table public.tasks enable row level security;
alter table public.quotes enable row level security;
alter table public.payments enable row level security;
alter table public.webhook_events enable row level security;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "billing_accounts_select_own"
on public.billing_accounts for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "billing_accounts_insert_own"
on public.billing_accounts for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "billing_accounts_update_own"
on public.billing_accounts for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "payment_sources_select_own"
on public.payment_sources for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "payment_sources_insert_own"
on public.payment_sources for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.billing_accounts
    where billing_accounts.id = payment_sources.billing_account_id
      and billing_accounts.user_id = (select auth.uid())
  )
);

create policy "payment_sources_update_own"
on public.payment_sources for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.billing_accounts
    where billing_accounts.id = payment_sources.billing_account_id
      and billing_accounts.user_id = (select auth.uid())
  )
);

create policy "tasks_select_own"
on public.tasks for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "tasks_insert_own"
on public.tasks for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "tasks_update_own"
on public.tasks for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "quotes_select_own"
on public.quotes for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "quotes_insert_own"
on public.quotes for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.tasks
    where tasks.id = quotes.task_id
      and tasks.user_id = (select auth.uid())
  )
);

create policy "quotes_update_own"
on public.quotes for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.tasks
    where tasks.id = quotes.task_id
      and tasks.user_id = (select auth.uid())
  )
);

create policy "payments_select_own"
on public.payments for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "payments_insert_own"
on public.payments for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.tasks
    where tasks.id = payments.task_id
      and tasks.user_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.quotes
    where quotes.id = payments.quote_id
      and quotes.user_id = (select auth.uid())
      and quotes.task_id = payments.task_id
  )
  and exists (
    select 1
    from public.billing_accounts
    where billing_accounts.id = payments.billing_account_id
      and billing_accounts.user_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.payment_sources
    where payment_sources.id = payments.payment_source_id
      and payment_sources.user_id = (select auth.uid())
      and payment_sources.billing_account_id = payments.billing_account_id
  )
);

create policy "payments_update_own"
on public.payments for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.tasks
    where tasks.id = payments.task_id
      and tasks.user_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.quotes
    where quotes.id = payments.quote_id
      and quotes.user_id = (select auth.uid())
      and quotes.task_id = payments.task_id
  )
  and exists (
    select 1
    from public.billing_accounts
    where billing_accounts.id = payments.billing_account_id
      and billing_accounts.user_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.payment_sources
    where payment_sources.id = payments.payment_source_id
      and payment_sources.user_id = (select auth.uid())
      and payment_sources.billing_account_id = payments.billing_account_id
  )
);

revoke all on table public.profiles from anon;
revoke all on table public.billing_accounts from anon;
revoke all on table public.payment_sources from anon;
revoke all on table public.tasks from anon;
revoke all on table public.quotes from anon;
revoke all on table public.payments from anon;
revoke all on table public.webhook_events from anon, authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update on table public.billing_accounts to authenticated;
grant select, insert, update on table public.payment_sources to authenticated;
grant select, insert, update on table public.tasks to authenticated;
grant select, insert, update on table public.quotes to authenticated;
grant select, insert, update on table public.payments to authenticated;
grant select, insert, update on table public.webhook_events to service_role;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.create_profile_for_new_user() from public, anon, authenticated;
revoke execute on function public.protect_approved_quote() from public, anon, authenticated;
