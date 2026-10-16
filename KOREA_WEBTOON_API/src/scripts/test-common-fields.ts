/**
 * 네이버·카카오 공통 필드 수집 smoke test (실 API 호출)
 */
import { normalizeWebtoon } from '@/modules/naver/functions/normalizeWebtoon';
import { getweeklyWebtoonList } from '@/modules/naver/functions/naverApi';
import {
  getNaverArticleListInfo,
  getNaverTotalEpisodeCount,
  parseNaverExtendedMeta,
} from '@/modules/naver/functions/naverDetailApi';
import { enrichWebtoonMeta } from '@/modules/enrich/enrichWebtoonMeta';
import { KAKAO_PLACEMENT, getWebtoonListByPlacement } from '@/modules/kakao/functions/kakaoApi';
import { normalizeWebtoonList } from '@/modules/kakao/functions/normalizeWebtoon';
import { UNKNOWN_GENRE } from '@/modules/common/webtoonCommonFields';

const assert = (label: string, ok: boolean, detail?: string) => {
  if (!ok) {
    console.error(`❌ ${label}`, detail ?? '');
    process.exitCode = 1;
  } else {
    console.log(`✅ ${label}`, detail ?? '');
  }
};

(async () => {
  const {
    data: { titleListMap },
  } = await getweeklyWebtoonList();
  const friday = titleListMap.FRIDAY[0];
  const naverNorm = normalizeWebtoon({ ...friday, titleId: friday.titleId });
  assert(
    'Naver list averageRating',
    typeof naverNorm.averageRating === 'number' && naverNorm.averageRating > 0,
    String(naverNorm.averageRating),
  );
  assert(
    'Naver list isOnHiatus is boolean|null',
    naverNorm.isOnHiatus === null || typeof naverNorm.isOnHiatus === 'boolean',
  );

  const titleId = friday.titleId;
  const { data: info } = await getNaverArticleListInfo(titleId);
  const meta = parseNaverExtendedMeta(info);
  const episodes = await getNaverTotalEpisodeCount(titleId);
  assert(
    'Naver enrich primaryGenre',
    meta.primaryGenre !== UNKNOWN_GENRE,
    meta.primaryGenre,
  );
  assert(
    'Naver enrich popularityCount',
    typeof meta.popularityCount === 'number' && meta.popularityCount > 0,
    String(meta.popularityCount),
  );
  assert(
    'Naver totalEpisodeCount',
    typeof episodes === 'number' && episodes > 0,
    String(episodes),
  );

  const enrichedNaver = await enrichWebtoonMeta({
    ...naverNorm,
    updateDays: ['FRI'],
  });
  assert(
    'Naver enrich merge totalEpisodeCount',
    enrichedNaver.totalEpisodeCount === episodes,
  );

  const { data: kakaoData } = await getWebtoonListByPlacement(
    KAKAO_PLACEMENT.FRI,
  );
  const kakaoNorm = normalizeWebtoonList({
    response: kakaoData,
    isEnd: false,
    updateDay: 'FRI',
  })[0];
  const kakaoId = `kakao_${kakaoNorm.id}`;
  const kakaoFull = { ...kakaoNorm, id: kakaoId };
  assert(
    'Kakao averageRating unknown (null)',
    kakaoFull.averageRating === null,
  );
  assert(
    'Kakao popularityCount unknown (null)',
    kakaoFull.popularityCount === null,
  );
  assert(
    'Kakao isOnHiatus unknown (null)',
    kakaoFull.isOnHiatus === null,
  );
  assert(
    'Kakao totalEpisodeCount unknown (null)',
    kakaoFull.totalEpisodeCount === null,
  );
  assert(
    'Kakao primaryGenre string',
    typeof kakaoFull.primaryGenre === 'string' &&
      kakaoFull.primaryGenre.length > 0,
    kakaoFull.primaryGenre,
  );

  if (process.exitCode === 1) {
    console.error('\nSome checks failed.');
    process.exit(1);
  }
  console.log('\nAll common-field checks passed.');
})();
