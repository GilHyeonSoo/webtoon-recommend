import { NaverWebtoonTitle } from './naverApi';
import type { NormalizedWebtoon } from '@/database/entity';
import { commonFieldsUnknown } from '@/modules/common/webtoonCommonFields';

export const normalizeWebtoon = ({
  titleId,
  ...webtoon
}: NaverWebtoonTitle): Omit<NormalizedWebtoon, 'updateDays'> => {
  const common = commonFieldsUnknown();
  return {
  title: webtoon.titleName,
  ageGrade: webtoon.adult ? 19 : 0,
  //! '/' 또는 ' / '로 구분된 작가명을 배열로 변환
  authors: webtoon.author.split(/ \/ |\/| \/ /),
  isEnd: webtoon.finish,
  freeWaitHour: webtoon.bm ? 24 : null,
  isFree: true,
  id: `naver_${titleId}`,
  provider: 'NAVER',
  thumbnail: [webtoon.thumbnailUrl],
  isUpdated: webtoon.up,
  url: `https://comic.naver.com/webtoon/list?titleId=${titleId}`,
  synopsis: null,
  genres: [],
  tags: [],
  averageRating:
    typeof webtoon.starScore === 'number' ? webtoon.starScore : null,
  primaryGenre: common.primaryGenre,
  totalEpisodeCount: null,
  isOnHiatus:
    typeof webtoon.rest === 'boolean' ? webtoon.rest : null,
  popularityCount: null,
};
};
