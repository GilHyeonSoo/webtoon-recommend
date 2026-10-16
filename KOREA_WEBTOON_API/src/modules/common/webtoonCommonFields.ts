/** 네이버·카카오 공통 작품 필드 기본값 */
export const UNKNOWN_GENRE = 'unknown';

export type WebtoonCommonFields = {
  averageRating: number | null;
  primaryGenre: string;
  totalEpisodeCount: number | null;
  isOnHiatus: boolean | null;
  popularityCount: number | null;
};

export const commonFieldsUnknown = (): WebtoonCommonFields => ({
  averageRating: null,
  primaryGenre: UNKNOWN_GENRE,
  totalEpisodeCount: null,
  isOnHiatus: null,
  popularityCount: null,
});

export const primaryGenreFromNaverCuration = (
  curationTagList?: { tagName: string; curationType: string }[],
): string => {
  const genreTag = curationTagList?.find((t) =>
    t.curationType.startsWith('GENRE_'),
  );
  if (!genreTag) return UNKNOWN_GENRE;
  const code = genreTag.curationType.replace(/^GENRE_/, '').toLowerCase();
  return code || genreTag.tagName || UNKNOWN_GENRE;
};

export const primaryGenreFromKakaoKeywords = (
  seoKeywords?: string[],
): string => {
  const first = seoKeywords?.find((k) => k?.trim());
  return first?.trim() || UNKNOWN_GENRE;
};
