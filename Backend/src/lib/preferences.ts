import type { WebtoonDto } from './mapWebtoon.js';

export type PlatformPreference = 'naver' | 'kakao' | 'any';
export type CompletionPreference = 'complete' | 'ongoing' | 'any';
export type RecommendationPreferences = {
  platform?: PlatformPreference;
  completion?: CompletionPreference;
};

const platformValues = new Set<PlatformPreference>(['naver', 'kakao', 'any']);
const completionValues = new Set<CompletionPreference>(['complete', 'ongoing', 'any']);

export function parseRecommendationPreferences(value: unknown): RecommendationPreferences | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return null;
  const platform = (value as { platform?: unknown }).platform;
  const completion = (value as { completion?: unknown }).completion;
  if (platform !== undefined && (typeof platform !== 'string' || !platformValues.has(platform as PlatformPreference))) return null;
  if (completion !== undefined && (typeof completion !== 'string' || !completionValues.has(completion as CompletionPreference))) return null;
  const result: RecommendationPreferences = {};
  if (platform !== undefined) result.platform = platform as PlatformPreference;
  if (completion !== undefined) result.completion = completion as CompletionPreference;
  return result;
}

export function matchesPlatform(item: WebtoonDto, preference: PlatformPreference) {
  if (preference === 'any') return true;
  if (preference === 'naver') return item.provider === 'NAVER';
  return item.provider === 'KAKAO' || item.provider === 'KAKAO_PAGE';
}

export function matchesCompletion(item: WebtoonDto, preference: CompletionPreference) {
  if (preference === 'any') return true;
  if (preference === 'complete') return item.isEnd || item.isOnHiatus === true;
  return !item.isEnd && item.isOnHiatus !== true;
}

export function passesPreferenceFilters(item: WebtoonDto, preferences?: RecommendationPreferences) {
  if (!preferences) return true;
  const platform = preferences.platform ?? 'any';
  const completion = preferences.completion ?? 'any';
  if (platform !== 'any' && !matchesPlatform(item, platform)) return false;
  if (completion !== 'any' && !matchesCompletion(item, completion)) return false;
  return true;
}

export function preferenceReasons(item: WebtoonDto, preferences?: RecommendationPreferences) {
  if (!preferences) return [] as string[];
  const reasons: string[] = [];
  const platform = preferences.platform ?? 'any';
  const completion = preferences.completion ?? 'any';
  if (platform === 'naver' && item.provider === 'NAVER') reasons.push('네이버에서 볼 수 있는 작품이에요');
  if (platform === 'kakao' && (item.provider === 'KAKAO' || item.provider === 'KAKAO_PAGE')) reasons.push('카카오에서 볼 수 있는 작품이에요');
  if (completion === 'complete' && item.isEnd) reasons.push('완결된 이야기예요');
  if (completion === 'complete' && !item.isEnd && item.isOnHiatus) reasons.push('현재 휴재 중인 이야기예요');
  if (completion === 'ongoing' && matchesCompletion(item, 'ongoing')) reasons.push('연재 중인 이야기예요');
  return reasons;
}
