create table if not exists public.webtoons (
  id text primary key,
  title text not null,
  provider text not null check (provider in ('NAVER', 'KAKAO', 'KAKAO_PAGE')),
  update_days text[] not null default '{}',
  url text not null,
  thumbnail text[] not null default '{}',
  is_end boolean not null default false,
  is_free boolean not null default false,
  is_updated boolean not null default false,
  age_grade integer not null default 0,
  free_wait_hour integer,
  authors text[] not null default '{}',
  synopsis text,
  genres text[] not null default '{}',
  tags text[] not null default '{}',
  synced_at timestamptz not null default now()
);

create index if not exists webtoons_provider_idx on public.webtoons (provider);
create index if not exists webtoons_title_idx on public.webtoons (title);

alter table public.webtoons enable row level security;

drop policy if exists "webtoons_public_read" on public.webtoons;
create policy "webtoons_public_read"
  on public.webtoons
  for select
  to anon, authenticated
  using (true);
