import type { WebtoonRow } from './supabase.js';

export type WebtoonDto = {
  id: string;
  title: string;
  provider: WebtoonRow['provider'];
  updateDays: string[];
  url: string;
  thumbnail: string[];
  isEnd: boolean;
  isFree: boolean;
  isUpdated: boolean;
  ageGrade: number;
  freeWaitHour: number | null;
  authors: string[];
  synopsis: string | null;
  genres: string[];
  tags: string[];
  averageRating: number | null;
  primaryGenre: string;
  totalEpisodeCount: number | null;
  isOnHiatus: boolean | null;
  popularityCount: number | null;
};

export const rowToDto = (row: WebtoonRow): WebtoonDto => ({
  id: row.id,
  title: row.title,
  provider: row.provider,
  updateDays: row.update_days ?? [],
  url: row.url,
  thumbnail: row.thumbnail ?? [],
  isEnd: row.is_end,
  isFree: row.is_free,
  isUpdated: row.is_updated,
  ageGrade: row.age_grade,
  freeWaitHour: row.free_wait_hour,
  authors: row.authors ?? [],
  synopsis: row.synopsis,
  genres: row.genres ?? [],
  tags: row.tags ?? [],
  averageRating: row.average_rating ?? null,
  primaryGenre: row.primary_genre ?? 'unknown',
  totalEpisodeCount: row.total_episode_count ?? null,
  isOnHiatus: row.is_on_hiatus ?? null,
  popularityCount: row.popularity_count ?? null,
});

export const jsonItemToRow = (item: WebtoonDto): WebtoonRow => ({
  id: item.id,
  title: item.title,
  provider: item.provider,
  update_days: item.updateDays ?? [],
  url: item.url,
  thumbnail: item.thumbnail ?? [],
  is_end: item.isEnd,
  is_free: item.isFree,
  is_updated: item.isUpdated,
  age_grade: item.ageGrade,
  free_wait_hour: item.freeWaitHour,
  authors: item.authors ?? [],
  synopsis: item.synopsis,
  genres: item.genres ?? [],
  tags: item.tags ?? [],
  average_rating: item.averageRating ?? null,
  primary_genre: item.primaryGenre ?? 'unknown',
  total_episode_count: item.totalEpisodeCount ?? null,
  is_on_hiatus: item.isOnHiatus ?? null,
  popularity_count: item.popularityCount ?? null,
  synced_at: new Date().toISOString(),
});
