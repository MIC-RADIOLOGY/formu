-- Run this in your Supabase project's SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run)

create table if not exists bets (
  id uuid primary key default gen_random_uuid(),
  match text not null,
  stake numeric not null,
  odds numeric not null,
  result text not null default 'pending' check (result in ('pending', 'win', 'loss')),
  created_at timestamptz not null default now()
);

alter table bets enable row level security;

-- Simple single-user policy: anyone with the anon key can read/write.
-- Tighten this (e.g. scope by auth.uid()) if you add user accounts later.
create policy "Allow all access to bets" on bets
  for all
  using (true)
  with check (true);

-- Optional: enable realtime so multiple tabs/devices stay in sync
alter publication supabase_realtime add table bets;
