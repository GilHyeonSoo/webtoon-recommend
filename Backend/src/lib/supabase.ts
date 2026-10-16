import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are required',
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type WebtoonRow = {
  id: string;
  title: string;
  provider: 'NAVER' | 'KAKAO' | 'KAKAO_PAGE';
  update_days: string[];
  url: string;
  thumbnail: string[];
  is_end: boolean;
  is_free: boolean;
  is_updated: boolean;
  age_grade: number;
  free_wait_hour: number | null;
  authors: string[];
  synopsis: string | null;
  genres: string[];
  tags: string[];
  average_rating?: number | null;
  primary_genre?: string;
  total_episode_count?: number | null;
  is_on_hiatus?: boolean | null;
  popularity_count?: number | null;
  synced_at?: string;
};
