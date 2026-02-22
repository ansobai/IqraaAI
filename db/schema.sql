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

create table if not exists public.tasmee_attempts (
  id uuid primary key,
  session_id text unique not null,
  clerk_user_id text not null,
  page_number int not null,
  surah_id int not null,
  recognizer_mode text not null,
  transport_mode text not null default 'http',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  chunks_received int not null default 0,
  chunks_with_speech int not null default 0,
  deltas_emitted int not null default 0,
  deltas_blocked int not null default 0,
  anchor_word_index int,
  anchor_verse_end_word_index int,
  max_confirmed_word_index int,
  confirmed_word_count int not null default 0,
  avg_total_ms double precision,
  p95_total_ms double precision
);

create index if not exists idx_tasmee_attempts_user_started
  on public.tasmee_attempts (clerk_user_id, started_at desc);

