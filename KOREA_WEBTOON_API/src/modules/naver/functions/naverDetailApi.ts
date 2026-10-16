import { outboundSafety } from '@/security/context';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { primaryGenreFromNaverCuration } from '@/modules/common/webtoonCommonFields';

const naverDetailApi = axios.create({
  baseURL: 'https://comic.naver.com/api/article/list',
  timeout: 30_000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  },
});

outboundSafety(naverDetailApi);

axiosRetry(naverDetailApi, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 2_000,
});

export interface NaverArticleListInfo {
  titleId: number;
  titleName: string;
  synopsis?: string;
  favoriteCount?: number;
  rest?: boolean;
  curationTagList?: {
    tagName: string;
    curationType: string;
  }[];
}

interface NaverArticleListPage {
  totalCount?: number;
}

const genreFromCurationType = (curationType: string): string | null => {
  if (!curationType.startsWith('GENRE_')) return null;
  return curationType.replace(/^GENRE_/, '').toLowerCase();
};

export const getNaverArticleListInfo = (titleId: number) =>
  naverDetailApi.get<NaverArticleListInfo>('/info', {
    params: { titleId },
  });

export const getNaverTotalEpisodeCount = async (
  titleId: number,
): Promise<number | null> => {
  const { data } = await naverDetailApi.get<NaverArticleListPage>('', {
    params: { titleId, page: 1 },
  });
  return typeof data.totalCount === 'number' ? data.totalCount : null;
};

export const parseNaverExtendedMeta = (data: NaverArticleListInfo) => {
  const tags: string[] = [];
  const genres: string[] = [];

  data.curationTagList?.forEach(({ tagName, curationType }) => {
    const genre = genreFromCurationType(curationType);
    if (genre) genres.push(genre);
    else if (tagName) tags.push(tagName);
  });

  return {
    synopsis: data.synopsis?.trim() ?? null,
    genres: [...new Set(genres)],
    tags: [...new Set(tags)],
    primaryGenre: primaryGenreFromNaverCuration(data.curationTagList),
    popularityCount:
      typeof data.favoriteCount === 'number' ? data.favoriteCount : null,
    isOnHiatus: typeof data.rest === 'boolean' ? data.rest : null,
  };
};
