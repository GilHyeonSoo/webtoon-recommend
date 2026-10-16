import type { NormalizedWebtoon, UpdateDay } from '@/database/entity';
import { getWebtoonList } from './functions/getWebtoonList';
import {
  getContentHomeOverview,
  type KakoPageStaticLandingGenreSectionItem,
} from './functions/kakaoPageApi';
import {
  UNKNOWN_GENRE,
  commonFieldsUnknown,
} from '@/modules/common/webtoonCommonFields';

enum Weekday {
  월 = 'MON',
  화 = 'TUE',
  수 = 'WED',
  목 = 'THU',
  금 = 'FRI',
  토 = 'SAT',
  일 = 'SUN',
}

const CONCURRENCY = Math.max(
  1,
  Number(process.env.KAKAO_PAGE_CONCURRENCY) || 2,
);

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) break;
      results[index] = await fn(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

const normalizeKakaoPageItem = async ({
  seriesId,
  ...webtoon
}: KakoPageStaticLandingGenreSectionItem): Promise<NormalizedWebtoon> => {
  const { content } = (await getContentHomeOverview(seriesId)).data.data
    .contentHomeOverview;

  const updateDays: UpdateDay[] = [];

  Object.keys(Weekday).forEach((key) => {
    const weekdayKor = key as keyof typeof Weekday;

    if (content.pubPeriod?.includes(weekdayKor))
      updateDays.push(Weekday[weekdayKor]);
  });

  const id = `kakopage_${seriesId}`;

  return {
    id,
    provider: 'KAKAO_PAGE',
    title: content.title,
    url: `https://page.kakao.com/content/${seriesId}`,
    updateDays,
    thumbnail: [`https:${content.thumbnail}`],
    isUpdated: webtoon.statusBadge === 'BadgeUpStatic',
    ageGrade: {
      Nineteen: 19,
      Fifteen: 15,
      All: 0,
    }[content.ageGrade],
    freeWaitHour:
      content.bm === 'PayWaitfree'
        ? content.waitfreePeriodByMinute / 60
        : null,
    isEnd: content.onIssue === 'End',
    isFree: content.bm !== 'Pay',
    authors: content.authors.split(','),
    synopsis: content.description?.trim() ?? null,
    genres: [
      ...new Set(
        [content.category, content.subcategory].filter(Boolean) as string[],
      ),
    ],
    tags: [],
    ...commonFieldsUnknown(),
    primaryGenre:
      content.category?.trim() ||
      content.subcategory?.trim() ||
      UNKNOWN_GENRE,
  };
};

export const getKakaoPageWebtoonList = async (): Promise<
  NormalizedWebtoon[]
> => {
  const webtoonList = await getWebtoonList();

  const gapMs = process.env.KAKAO_PAGE_MIN_GAP_MS ?? '800';
  console.info(
    `⌛️ [KAKAO_PAGE] 상세 수집 시작 (총 ${webtoonList.length}작품, 동시 ${CONCURRENCY}건, 요청 간격 ${gapMs}ms)`,
  );

  let completed = 0;

  return mapWithConcurrency(
    webtoonList,
    CONCURRENCY,
    async (item) => {
      const normalized = await normalizeKakaoPageItem(item);
      completed += 1;
      if (completed % 50 === 0 || completed === webtoonList.length) {
        console.info(
          `⌛️ [KAKAO_PAGE] 상세 수집 ${completed}/${webtoonList.length}`,
        );
      }
      return normalized;
    },
  );
};
