
-- Roles enum
create type public.app_role as enum ('super_admin', 'admin_paroquial', 'lider', 'servidor');

-- Paroquias
create table public.paroquias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  diocese text,
  slug text unique not null,
  logo_url text,
  cor_primaria text default '#c9a84c',
  contato_email text,
  contato_telefone text,
  endereco text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  paroquia_id uuid references public.paroquias(id) on delete set null,
  nome_completo text,
  email text,
  telefone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- User roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paroquia_id uuid references public.paroquias(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, paroquia_id, role)
);

-- has_role helper (SECURITY DEFINER prevents RLS recursion)
create or replace function public.has_role(_user_id uuid, _role public.app_role, _paroquia_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id
      and role = _role
      and (
        role = 'super_admin'
        or _paroquia_id is null
        or paroquia_id = _paroquia_id
      )
  )
$$;

-- Current paroquia helper
create or replace function public.current_paroquia_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select paroquia_id from public.profiles where id = auth.uid()
$$;

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nome_completo)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome_completo', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger paroquias_set_updated_at before update on public.paroquias
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.paroquias enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

-- Paroquias policies
create policy "paroquias_select_member"
  on public.paroquias for select to authenticated
  using (id = public.current_paroquia_id() or public.has_role(auth.uid(), 'super_admin'));

create policy "paroquias_insert_authenticated"
  on public.paroquias for insert to authenticated
  with check (auth.uid() = created_by);

create policy "paroquias_update_admin"
  on public.paroquias for update to authenticated
  using (public.has_role(auth.uid(), 'admin_paroquial', id) or public.has_role(auth.uid(), 'super_admin'));

create policy "paroquias_delete_super_admin"
  on public.paroquias for delete to authenticated
  using (public.has_role(auth.uid(), 'super_admin'));

-- Profiles policies
create policy "profiles_select_same_paroquia"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or (paroquia_id is not null and paroquia_id = public.current_paroquia_id())
    or public.has_role(auth.uid(), 'super_admin')
  );

create policy "profiles_update_self_or_admin"
  on public.profiles for update to authenticated
  using (
    id = auth.uid()
    or public.has_role(auth.uid(), 'admin_paroquial', paroquia_id)
    or public.has_role(auth.uid(), 'super_admin')
  );

create policy "profiles_insert_self"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

-- User roles policies
create policy "user_roles_select_self_or_admin"
  on public.user_roles for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_role(auth.uid(), 'admin_paroquial', paroquia_id)
    or public.has_role(auth.uid(), 'super_admin')
  );

-- Allow self to claim admin_paroquial on a paroquia they just created (created_by = uid)
create policy "user_roles_insert_admin_or_self_claim"
  on public.user_roles for insert to authenticated
  with check (
    public.has_role(auth.uid(), 'admin_paroquial', paroquia_id)
    or public.has_role(auth.uid(), 'super_admin')
    or (
      user_id = auth.uid()
      and role = 'admin_paroquial'
      and exists (
        select 1 from public.paroquias p
        where p.id = paroquia_id and p.created_by = auth.uid()
      )
    )
  );

create policy "user_roles_delete_admin"
  on public.user_roles for delete to authenticated
  using (
    public.has_role(auth.uid(), 'admin_paroquial', paroquia_id)
    or public.has_role(auth.uid(), 'super_admin')
  );

-- Index for performance
create index idx_profiles_paroquia on public.profiles(paroquia_id);
create index idx_user_roles_user on public.user_roles(user_id);
create index idx_user_roles_paroquia on public.user_roles(paroquia_id);
