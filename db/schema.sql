-- Standalone Postgres schema (no Supabase-specific RLS/JWT plumbing)

create table if not exists public.profiles (
  clerk_user_id text primary key,
  email text not null,
  first_name text,
  last_name text,
  phone_number text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- prevent email changes (email is read-only)
create or replace function public.prevent_email_update()
returns trigger language plpgsql as $$
begin
  if new.email <> old.email then
    raise exception 'email cannot be updated';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_profiles_email_update on public.profiles;
create trigger prevent_profiles_email_update
before update on public.profiles
for each row execute function public.prevent_email_update();

