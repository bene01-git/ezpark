-- Crowdsourced parking-fullness reports for the SU Parking app.
--
-- Run this once in your Supabase project: open the SQL Editor, paste this in,
-- and click Run. Then copy your project URL and the *anon* public key into
-- site/config.js. The anon key is safe to expose in the browser BECAUSE the
-- row-level security policies below only allow inserting/reading reports -
-- never updating or deleting them.

create table if not exists public.reports (
  id         bigint generated always as identity primary key,
  lot_id     text not null,
  status     text not null check (status in ('full', 'some', 'open')),
  created_at timestamptz not null default now()
);

-- Fast lookups of recent reports.
create index if not exists reports_created_at_idx
  on public.reports (created_at desc);

-- Lock the table down, then open exactly two doors: anonymous insert + read.
alter table public.reports enable row level security;

drop policy if exists "anon can insert reports" on public.reports;
create policy "anon can insert reports"
  on public.reports for insert to anon
  with check (status in ('full', 'some', 'open'));

drop policy if exists "anon can read reports" on public.reports;
create policy "anon can read reports"
  on public.reports for select to anon
  using (true);

-- No update or delete policies exist, so those are denied to anon by default.

-- Optional housekeeping: delete reports older than 7 days. You can schedule this
-- with Supabase's pg_cron extension, or just run it occasionally by hand.
-- delete from public.reports where created_at < now() - interval '7 days';
