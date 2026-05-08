-- ERA Competitor Intel · V9 Schema
-- Run in Supabase → SQL Editor → New query → Run

-- 1. Competitors (lightweight metadata, no scraped ads inside)
create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  url text not null,
  country text default 'FR',
  created_at timestamptz default now()
);
alter table public.competitors enable row level security;
drop policy if exists "users own competitors" on public.competitors;
create policy "users own competitors" on public.competitors for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Library (one row per saved ad, small payload)
create table if not exists public.library (
  ad_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  competitor_name text,
  ad_data jsonb not null,
  is_hook boolean default false,
  is_caption boolean default false,
  angle_tag text,
  notes text default '',
  saved_at timestamptz default now(),
  primary key (user_id, ad_id)
);
alter table public.library enable row level security;
drop policy if exists "users own library" on public.library;
create policy "users own library" on public.library for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. Angle tags (editable sub-categories for marketing angle)
create table if not exists public.angle_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  created_at timestamptz default now(),
  unique(user_id, name)
);
alter table public.angle_tags enable row level security;
drop policy if exists "users own angle_tags" on public.angle_tags;
create policy "users own angle_tags" on public.angle_tags for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- (kv_store from V8 reste utilisée pour les settings: clé Apify, CPM, limit)
