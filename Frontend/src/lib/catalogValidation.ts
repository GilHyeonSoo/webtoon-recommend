// Kept identical in the three independently deployable applications.
export function safeCatalogUrl(value: unknown, provider?: string): boolean {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    if (!provider) return ['image-comic.pstatic.net', 'kr-a.kakaopagecdn.com', 'kr-a.kakaocdn.net'].includes(url.hostname);
    if (provider === 'NAVER') return url.hostname === 'comic.naver.com' && url.pathname === '/webtoon/list' && /^\d+$/.test(url.searchParams.get('titleId') ?? '');
    if (provider === 'KAKAO') return url.hostname === 'webtoon.kakao.com' && /^\/content\/[^/]+\/\d+\/?$/.test(url.pathname);
    if (provider === 'KAKAO_PAGE') return url.hostname === 'page.kakao.com' && /^\/content\/\d+\/?$/.test(url.pathname);
    return false;
  } catch { return false; }
}

export function assertCatalogItem(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid catalog item');
  const item = value as Record<string, unknown>;
  const text = (v: unknown, max: number, required = false) => typeof v === 'string' && v.length <= max && (!required || !!v.trim());
  const list = (v: unknown, max: number, length: number) => Array.isArray(v) && v.length <= max && v.every((s) => text(s, length));
  if (!text(item.id, 200, true) || !text(item.title, 500, true) || !['NAVER', 'KAKAO', 'KAKAO_PAGE'].includes(String(item.provider))
    || !safeCatalogUrl(item.url, item.provider as string)) throw new Error('Invalid catalog identity or URL');
  for (const field of ['thumbnail', 'authors', 'genres', 'tags', 'updateDays']) {
    const v = item[field];
    if (v !== undefined && v !== null && !list(v, field === 'thumbnail' ? 10 : 100, field === 'thumbnail' ? 4096 : 500)) throw new Error(`Invalid catalog ${field}`);
  }
  if (Array.isArray(item.thumbnail) && !item.thumbnail.every((url) => safeCatalogUrl(url))) throw new Error('Invalid image URL');
  if (Array.isArray(item.updateDays) && !item.updateDays.every((day) => ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].includes(day))) throw new Error('Invalid update day');
  for (const field of ['isEnd', 'isFree', 'isUpdated']) if (typeof item[field] !== 'boolean') throw new Error(`Invalid catalog ${field}`);
  if (item.isOnHiatus != null && typeof item.isOnHiatus !== 'boolean') throw new Error('Invalid hiatus flag');
  for (const [field, maximum] of Object.entries({ ageGrade: 99, freeWaitHour: 100_000, totalEpisodeCount: 1_000_000, popularityCount: Number.MAX_SAFE_INTEGER, averageRating: 10 })) {
    const v = item[field];
    if (v != null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > maximum || (field !== 'averageRating' && !Number.isSafeInteger(v)))) throw new Error(`Invalid catalog ${field}`);
  }
  if (typeof item.ageGrade !== 'number') throw new Error('Missing age grade');
  if (item.synopsis != null && !text(item.synopsis, 10_000)) throw new Error('Invalid synopsis');
  if (item.primaryGenre != null && !text(item.primaryGenre, 500)) throw new Error('Invalid primary genre');
}
