alter table public.github_app_installations
  add column disconnected_at timestamptz;

alter table public.github_app_installations
  drop constraint github_app_installations_app_id_account_id_key;

create unique index github_app_installations_one_active_generation_idx
  on public.github_app_installations(app_id, account_id)
  where disconnected_at is null;

alter table public.github_app_installations
  add constraint github_app_installations_id_user_installation_key
  unique (id, user_id, installation_id);

create function public.protect_github_app_installation_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.installation_id is distinct from old.installation_id
    or new.app_id is distinct from old.app_id
    or new.account_id is distinct from old.account_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'GitHub App installation identity is immutable';
  end if;

  return new;
end;
$$;

create trigger github_app_installations_protect_identity
before update on public.github_app_installations
for each row execute function public.protect_github_app_installation_identity();

create function public.claim_github_app_installation(
  p_user_id uuid,
  p_installation_id bigint,
  p_app_id bigint,
  p_app_slug text,
  p_account_id bigint,
  p_account_login text,
  p_account_type text,
  p_repository_selection text,
  p_permissions jsonb,
  p_suspended_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_generation public.github_app_installations%rowtype;
  v_generation_exists boolean;
  v_installation_row_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_app_id::text || ':' || p_account_id::text,
      0
    )
  );

  if exists (
    select 1
    from public.github_app_installations
    where app_id = p_app_id
      and account_id = p_account_id
      and user_id <> p_user_id
  ) then
    raise exception
      'This GitHub App installation is already connected to another Outcomes account.'
      using errcode = '42501';
  end if;

  select *
  into v_generation
  from public.github_app_installations
  where installation_id = p_installation_id
  for update;

  v_generation_exists := found;

  if v_generation_exists and (
    v_generation.user_id <> p_user_id
    or v_generation.app_id <> p_app_id
    or v_generation.account_id <> p_account_id
  ) then
    raise exception 'GitHub App installation identity does not match its existing generation.'
      using errcode = '42501';
  end if;

  update public.github_app_installations
  set
    disconnected_at = case
      when disconnected_at is null then pg_catalog.now()
      else disconnected_at
    end,
    updated_at = pg_catalog.now()
  where app_id = p_app_id
    and account_id = p_account_id
    and disconnected_at is null
    and (not v_generation_exists or id <> v_generation.id);

  if v_generation_exists then
    update public.github_app_installations
    set
      app_slug = p_app_slug,
      account_login = p_account_login,
      account_type = p_account_type,
      repository_selection = p_repository_selection,
      permissions = p_permissions,
      suspended_at = p_suspended_at,
      disconnected_at = null,
      updated_at = pg_catalog.now()
    where id = v_generation.id
    returning id into v_installation_row_id;
  else
    insert into public.github_app_installations (
      user_id,
      installation_id,
      app_id,
      app_slug,
      account_id,
      account_login,
      account_type,
      repository_selection,
      permissions,
      suspended_at,
      disconnected_at
    ) values (
      p_user_id,
      p_installation_id,
      p_app_id,
      p_app_slug,
      p_account_id,
      p_account_login,
      p_account_type,
      p_repository_selection,
      p_permissions,
      p_suspended_at,
      null
    )
    returning id into v_installation_row_id;
  end if;

  return v_installation_row_id;
end;
$$;

revoke all on function public.protect_github_app_installation_identity()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_github_app_installation(
  uuid,
  bigint,
  bigint,
  text,
  bigint,
  text,
  text,
  text,
  jsonb,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.claim_github_app_installation(
  uuid,
  bigint,
  bigint,
  text,
  bigint,
  text,
  text,
  text,
  jsonb,
  timestamptz
) to service_role;

create table public.repository_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version smallint not null check (schema_version = 1),
  provider text not null check (provider = 'github'),
  repository_url text not null check (
    char_length(repository_url) <= 300
    and repository_url ~ '^https://github[.]com/[a-z0-9_.-]+/[a-z0-9_.-]+$'
  ),
  repository_full_name text not null check (
    char_length(repository_full_name) <= 255
    and repository_full_name ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'
  ),
  github_repository_id bigint not null check (github_repository_id > 0),
  visibility text not null check (
    visibility in ('public', 'private', 'internal')
  ),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  tree_sha text not null check (tree_sha ~ '^[0-9a-f]{40}$'),
  scanner_id text not null check (char_length(scanner_id) between 1 and 120),
  scanner_version text not null check (
    char_length(scanner_version) between 1 and 80
  ),
  manifest jsonb not null check (
    jsonb_typeof(manifest) = 'object'
    and manifest ->> 'schemaVersion' = '1'
    and manifest #>> '{snapshot,commitSha}' = commit_sha
    and manifest #>> '{snapshot,dirty}' = 'false'
    and manifest #>> '{source,kind}' = 'github'
    and manifest #>> '{source,url}' = repository_url
    and manifest #>> '{source,ref}' = commit_sha
  ),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint repository_snapshots_id_user_key unique (id, user_id),
  constraint repository_snapshots_semantic_key unique (
    user_id,
    github_repository_id,
    repository_url,
    repository_full_name,
    visibility,
    commit_sha,
    tree_sha,
    scanner_id,
    scanner_version
  ),
  constraint repository_snapshots_binding_identity_key unique (
    id,
    user_id,
    manifest_hash,
    github_repository_id,
    commit_sha,
    repository_url,
    repository_full_name,
    visibility
  )
);

create index repository_snapshots_user_id_created_at_idx
  on public.repository_snapshots(user_id, created_at desc);
create index repository_snapshots_repository_commit_idx
  on public.repository_snapshots(github_repository_id, commit_sha);

create table public.repository_bindings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version smallint not null check (schema_version = 1),
  provider text not null check (provider = 'github'),
  repository_url text not null check (
    char_length(repository_url) <= 300
    and repository_url ~ '^https://github[.]com/[a-z0-9_.-]+/[a-z0-9_.-]+$'
  ),
  repository_full_name text not null check (
    char_length(repository_full_name) <= 255
    and repository_full_name ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'
  ),
  github_repository_id bigint not null check (github_repository_id > 0),
  base_branch text not null check (
    char_length(base_branch) between 1 and 255
    and base_branch <> '@'
    and base_branch !~ '(^/|/$|[.]$|[.][.]|//|@\{)'
    and base_branch !~ '(^|/)[.]'
    and base_branch !~ '(^|/)[^/]*[.]lock(/|$)'
    and base_branch !~ '[[:cntrl:] ~^:?*]'
    and position('[' in base_branch) = 0
    and position(']' in base_branch) = 0
    and position('\' in base_branch) = 0
  ),
  base_sha text not null check (base_sha ~ '^[0-9a-f]{40}$'),
  visibility text not null check (
    visibility in ('public', 'private', 'internal')
  ),
  github_app_installation_id uuid not null,
  github_installation_id bigint not null check (github_installation_id > 0),
  snapshot_id uuid not null,
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint repository_bindings_id_user_key unique (id, user_id),
  constraint repository_bindings_semantic_key unique (
    user_id,
    github_repository_id,
    base_branch,
    base_sha,
    github_app_installation_id,
    snapshot_id
  ),
  constraint repository_bindings_installation_owner_fkey foreign key (
    github_app_installation_id,
    user_id,
    github_installation_id
  ) references public.github_app_installations (
    id,
    user_id,
    installation_id
  ) on delete cascade,
  constraint repository_bindings_snapshot_owner_fkey foreign key (
    snapshot_id,
    user_id,
    manifest_hash,
    github_repository_id,
    base_sha,
    repository_url,
    repository_full_name,
    visibility
  ) references public.repository_snapshots (
    id,
    user_id,
    manifest_hash,
    github_repository_id,
    commit_sha,
    repository_url,
    repository_full_name,
    visibility
  ) on delete cascade
);

create index repository_bindings_user_id_created_at_idx
  on public.repository_bindings(user_id, created_at desc);
create index repository_bindings_repository_base_idx
  on public.repository_bindings(github_repository_id, base_branch, base_sha);

create function public.prevent_immutable_repository_record_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Repository snapshots and bindings are immutable';
end;
$$;

create trigger repository_snapshots_prevent_update
before update on public.repository_snapshots
for each row execute function public.prevent_immutable_repository_record_update();

create trigger repository_bindings_prevent_update
before update on public.repository_bindings
for each row execute function public.prevent_immutable_repository_record_update();

alter table public.repository_snapshots enable row level security;
alter table public.repository_bindings enable row level security;

create policy "repository_snapshots_select_own"
on public.repository_snapshots for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "repository_bindings_select_own"
on public.repository_bindings for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.repository_snapshots
  from public, anon, authenticated, service_role;
revoke all on table public.repository_bindings
  from public, anon, authenticated, service_role;
grant select on table public.repository_snapshots to authenticated;
grant select on table public.repository_bindings to authenticated;
grant select, insert on table public.repository_snapshots to service_role;
grant select, insert on table public.repository_bindings to service_role;

revoke all on function public.prevent_immutable_repository_record_update()
  from public, anon, authenticated, service_role;
