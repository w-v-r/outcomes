create table public.github_app_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id bigint not null unique check (installation_id > 0),
  app_id bigint not null check (app_id > 0),
  app_slug text not null check (app_slug ~ '^[a-z0-9-]+$'),
  account_id bigint not null check (account_id > 0),
  account_login text not null check (char_length(account_login) between 1 and 255),
  account_type text not null check (
    account_type in ('Bot', 'Enterprise', 'Organization', 'User')
  ),
  repository_selection text not null check (
    repository_selection in ('all', 'selected')
  ),
  permissions jsonb not null check (jsonb_typeof(permissions) = 'object'),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, account_id)
);

create index github_app_installations_user_id_created_at_idx
  on public.github_app_installations(user_id, created_at desc);

alter table public.github_app_installations enable row level security;

create policy "github_app_installations_select_own"
on public.github_app_installations for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.github_app_installations
  from public, anon, authenticated;
grant select on table public.github_app_installations to authenticated;
grant select, insert, update, delete
  on table public.github_app_installations to service_role;
