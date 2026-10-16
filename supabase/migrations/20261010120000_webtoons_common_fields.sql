alter table public.webtoons
  add column if not exists average_rating double precision,
  add column if not exists primary_genre text not null default 'unknown',
  add column if not exists total_episode_count integer,
  add column if not exists is_on_hiatus boolean,
  add column if not exists popularity_count bigint;
