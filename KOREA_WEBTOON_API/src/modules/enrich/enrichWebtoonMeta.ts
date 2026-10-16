import { checkJob } from '@/security/context';
import type { NormalizedWebtoon, Provider } from '@/database/entity';
import {
  KakaoPageWebtoon,
  KakaoWebtoon,
  NaverWebtoon,
} from '@/database/entity';
import { AppDataSource } from '@/database/datasource';
import {
  findKakaoCardExtendedMeta,
  type KakaoCardExtendedMeta,
} from '@/modules/kakao/functions/findKakaoCardMeta';
import { getContentHomeOverview } from '@/modules/kakao-page/functions/kakaoPageApi';
import {
  getNaverArticleListInfo,
  getNaverTotalEpisodeCount,
  parseNaverExtendedMeta,
} from '@/modules/naver/functions/naverDetailApi';
import { UNKNOWN_GENRE } from '@/modules/common/webtoonCommonFields';

export type WebtoonWithExtendedMeta = NormalizedWebtoon & {
  synopsis: string | null;
  genres: string[];
  tags: string[];
};

const parseProviderId = (id: string): { provider: string; rawId: string } => {
  const [provider, ...rest] = id.split('_');
  return { provider, rawId: rest.join('_') };
};

export type EnrichWebtoonOptions = {
  kakaoMetaIndex?: Map<number, KakaoCardExtendedMeta>;
};

export const enrichWebtoonMeta = async (
  webtoon: NormalizedWebtoon,
  options?: EnrichWebtoonOptions,
): Promise<WebtoonWithExtendedMeta> => {
  const base: WebtoonWithExtendedMeta = {
    ...webtoon,
    synopsis: webtoon.synopsis ?? null,
    genres: webtoon.genres?.length ? webtoon.genres : [],
    tags: webtoon.tags?.length ? webtoon.tags : [],
    averageRating: webtoon.averageRating ?? null,
    primaryGenre: webtoon.primaryGenre ?? UNKNOWN_GENRE,
    totalEpisodeCount: webtoon.totalEpisodeCount ?? null,
    isOnHiatus: webtoon.isOnHiatus ?? null,
    popularityCount: webtoon.popularityCount ?? null,
  };

  const { rawId } = parseProviderId(webtoon.id);

  try {
    if (webtoon.provider === 'NAVER') {
      const titleId = Number(rawId);
      const { data } = await getNaverArticleListInfo(titleId);
      const meta = parseNaverExtendedMeta(data);
      const totalEpisodeCount = await getNaverTotalEpisodeCount(titleId);
      return {
        ...base,
        synopsis: base.synopsis ?? meta.synopsis,
        genres: base.genres?.length ? base.genres : meta.genres,
        tags: base.tags?.length ? base.tags : meta.tags,
        primaryGenre:
          base.primaryGenre && base.primaryGenre !== UNKNOWN_GENRE
            ? base.primaryGenre
            : meta.primaryGenre,
        popularityCount: meta.popularityCount ?? base.popularityCount,
        totalEpisodeCount: totalEpisodeCount ?? base.totalEpisodeCount,
        isOnHiatus:
          meta.isOnHiatus !== null ? meta.isOnHiatus : base.isOnHiatus,
      };
    }

    if (webtoon.provider === 'KAKAO') {
      const contentId = Number(rawId);
      const fromIndex = options?.kakaoMetaIndex?.get(contentId);
      const meta =
        fromIndex ?? (await findKakaoCardExtendedMeta(contentId));
      return {
        ...base,
        synopsis: base.synopsis ?? meta.synopsis,
        tags: base.tags?.length ? base.tags : meta.tags,
      };
    }

    if (webtoon.provider === 'KAKAO_PAGE') {
      const { data } = await getContentHomeOverview(Number(rawId));
      const content = data.data.contentHomeOverview.content as {
        description?: string;
        category?: string;
        subcategory?: string;
      };

      const genres = [content.category, content.subcategory].filter(
        Boolean,
      ) as string[];

      return {
        ...base,
        synopsis: content.description?.trim() ?? null,
        genres: [...new Set(genres)],
        tags: [],
      };
    }
  } catch (err) {
    checkJob();
    console.warn(`⚠️ [enrich] ${webtoon.id} failed:`, String(err));
  }

  return base;
};

const ENTITY_BY_PROVIDER: Record<
  Exclude<Provider, 'RIDI'>,
  typeof NaverWebtoon
> = {
  NAVER: NaverWebtoon,
  KAKAO: KakaoWebtoon,
  KAKAO_PAGE: KakaoPageWebtoon,
};

export const persistEnrichedMeta = async (
  webtoon: WebtoonWithExtendedMeta,
) => {
  const Entity = ENTITY_BY_PROVIDER[webtoon.provider];
  if (!Entity) return;

  await AppDataSource.getRepository(Entity).update(webtoon.id, {
    synopsis: webtoon.synopsis,
    genres: webtoon.genres,
    tags: webtoon.tags,
    primaryGenre: webtoon.primaryGenre,
    popularityCount: webtoon.popularityCount,
    totalEpisodeCount: webtoon.totalEpisodeCount,
    isOnHiatus: webtoon.isOnHiatus,
    averageRating: webtoon.averageRating,
  });
};
