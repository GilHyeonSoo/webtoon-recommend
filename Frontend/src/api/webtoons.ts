import { assertCatalogItem } from '../lib/catalogValidation.ts'
export type Provider = 'NAVER' | 'KAKAO' | 'KAKAO_PAGE'
export type Webtoon = {
  id: string; title: string; provider: Provider; updateDays: string[]; url: string; thumbnail: string[]
  isEnd: boolean; isFree: boolean; isUpdated: boolean; ageGrade: number; freeWaitHour: number | null
  authors: string[]; synopsis: string | null; genres: string[]; tags: string[]
  averageRating: number | null; primaryGenre: string; totalEpisodeCount: number | null
  isOnHiatus: boolean | null; popularityCount: number | null
}
export type Recommendation = { webtoon: Webtoon; similarity: number; reasons: string[] }
export type RecommendationPreferences = { platform?: 'naver' | 'kakao' | 'any'; completion?: 'complete' | 'ongoing' | 'any' }
export type Analysis = { selected: Webtoon[]; recommendations: Recommendation[]; catalogCount: number; method: string }
const baseUrl = (import.meta.env?.VITE_API_URL ?? '').replace(/\/$/, '')
export const providerLabels: Record<Provider, string> = { NAVER: '네이버 웹툰', KAKAO: '카카오웹툰', KAKAO_PAGE: '카카오페이지' }
const genreNames: Record<string, string> = { pure: '로맨스', romance: '로맨스', action: '액션', daily: '일상', thrill: '스릴러', drama: '드라마', fantasy: '판타지', comic: '개그', sports: '스포츠' }
export const genreLabels = (item: Webtoon) => [...new Set([...item.genres, ...(item.primaryGenre && item.primaryGenre !== 'unknown' ? [item.primaryGenre] : [])].map((genre) => genreNames[genre] ?? genre))]

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000)
    const response = await fetch(`${baseUrl}${path}`, { ...init, signal })
    if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
      throw new Error('웹툰 API 연결 설정을 확인해야 해요. 잠시 후 다시 시도해주세요.')
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null
      throw new Error(body?.message ?? '서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.')
    }
    const data: unknown = await response.json()
    validateResponse(path, data)
    return data as T
  } catch (error) {
    if (init.signal?.aborted) throw error
    if (error instanceof SyntaxError) throw new Error('서버에서 올바른 웹툰 데이터를 받지 못했어요. 잠시 후 다시 시도해주세요.')
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')) throw new Error('서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.')
    throw error
  }
}
export function searchWebtoons(q: string, signal: AbortSignal) {
  const params = new URLSearchParams({ q, limit: '12' })
  return request<{ webtoons: Webtoon[]; total: number }>(`/api/webtoons?${params}`, { signal })
}
export function analyzeWebtoons(webtoonIds: string[], signal: AbortSignal, preferences?: RecommendationPreferences, excludeIds?: string[]) {
  const body: { webtoonIds: string[]; limit: number; preferences?: RecommendationPreferences; excludeIds?: string[] } = { webtoonIds, limit: 10 }
  if (preferences) {
    body.preferences = {
      ...(preferences.platform ? { platform: preferences.platform } : {}),
      ...(preferences.completion ? { completion: preferences.completion } : {}),
    }
  }
  if (excludeIds?.length) body.excludeIds = [...excludeIds]
  return request<Analysis>('/api/recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
}
export async function fetchWebtoons(provider: Provider): Promise<Webtoon[]> {
  const data = await request<{ webtoons: Webtoon[] }>(`/api/webtoons?provider=${provider}&limit=20`)
  return data.webtoons
}

function validateResponse(path: string, value: unknown): void {
  const invalid = () => { throw new Error('서버에서 올바른 웹툰 데이터를 받지 못했어요. 잠시 후 다시 시도해주세요.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const data = value as Record<string, unknown>
  try {
    if (path.startsWith('/api/recommendations')) {
      if (!Array.isArray(data.selected) || data.selected.length > 3 || !Array.isArray(data.recommendations) || data.recommendations.length > 20
        || !Number.isSafeInteger(data.catalogCount) || (data.catalogCount as number) < 0 || typeof data.method !== 'string' || data.method.length > 100) return invalid()
      data.selected.forEach(assertCatalogItem)
      for (const entry of data.recommendations) {
        if (!entry || typeof entry !== 'object' || typeof entry.similarity !== 'number' || !Number.isFinite(entry.similarity) || entry.similarity < 0 || entry.similarity > 1
          || !Array.isArray(entry.reasons) || entry.reasons.length > 10 || entry.reasons.some((reason: unknown) => typeof reason !== 'string' || reason.length > 2000)) return invalid()
        assertCatalogItem(entry.webtoon)
      }
    } else {
      if (!Array.isArray(data.webtoons) || data.webtoons.length > 100 || !Number.isSafeInteger(data.total) || (data.total as number) < 0) return invalid()
      data.webtoons.forEach(assertCatalogItem)
    }
  } catch { invalid() }
}
