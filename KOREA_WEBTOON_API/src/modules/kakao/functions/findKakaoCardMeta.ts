import {
  KAKAO_PLACEMENT,
  getWebtoonListByPlacement,
} from './kakaoApi';

const PLACEMENTS_TO_SCAN: KAKAO_PLACEMENT[] = [
  KAKAO_PLACEMENT.MON,
  KAKAO_PLACEMENT.TUE,
  KAKAO_PLACEMENT.WED,
  KAKAO_PLACEMENT.THU,
  KAKAO_PLACEMENT.FRI,
  KAKAO_PLACEMENT.SAT,
  KAKAO_PLACEMENT.SUN,
  KAKAO_PLACEMENT.COMPLETE,
];

export type KakaoCardExtendedMeta = {
  synopsis: string | null;
  genres: string[];
  tags: string[];
};

const metaFromCardContent = (content: unknown): KakaoCardExtendedMeta => {
  const { catchphraseTwoLines, seoKeywords } = content as {
    catchphraseTwoLines?: string[] | string;
    seoKeywords?: string[];
  };

  const synopsis = (() => {
    if (Array.isArray(catchphraseTwoLines)) {
      return catchphraseTwoLines.filter(Boolean).join('\n').trim() || null;
    }
    if (typeof catchphraseTwoLines === 'string') {
      return catchphraseTwoLines.trim() || null;
    }
    return null;
  })();

  return {
    synopsis,
    genres: [],
    tags: [...new Set(seoKeywords ?? [])],
  };
};

/** 요일·완결 목록을 한 번씩만 조회해 contentId → 메타 맵 생성 */
export const buildKakaoCardMetaIndex = async () => {
  const index = new Map<number, KakaoCardExtendedMeta>();

  for (const placement of PLACEMENTS_TO_SCAN) {
    const { data } = await getWebtoonListByPlacement(placement);
    const cards = data.data[0]?.cardGroups[0]?.cards ?? [];

    cards.forEach(({ content }) => {
      if (!index.has(content.id)) {
        index.set(content.id, metaFromCardContent(content));
      }
    });
  }

  return index;
};

export const findKakaoCardExtendedMeta = async (contentId: number) => {
  for (const placement of PLACEMENTS_TO_SCAN) {
    const { data } = await getWebtoonListByPlacement(placement);
    const cards = data.data[0]?.cardGroups[0]?.cards ?? [];

    const match = cards.find(({ content }) => content.id === contentId);
    if (!match) continue;

    return metaFromCardContent(match.content);
  }

  return { synopsis: null, genres: [] as string[], tags: [] as string[] };
};
