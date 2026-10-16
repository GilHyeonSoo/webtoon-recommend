import type { Recommendation, RecommendationPreferences, Webtoon } from '../api/webtoons'

export function webtoonMatchesPreferences(item: Webtoon, preferences: RecommendationPreferences) {
  const platform = preferences.platform ?? 'any'
  const completion = preferences.completion ?? 'any'
  if (platform === 'naver' && item.provider !== 'NAVER') return false
  if (platform === 'kakao' && item.provider !== 'KAKAO' && item.provider !== 'KAKAO_PAGE') return false
  if (completion === 'complete' && !item.isEnd && item.isOnHiatus !== true) return false
  if (completion === 'ongoing' && (item.isEnd || item.isOnHiatus === true)) return false
  return true
}

export function filterRecommendations(items: Recommendation[], preferences: RecommendationPreferences) {
  const hasFilter = (preferences.platform && preferences.platform !== 'any') || (preferences.completion && preferences.completion !== 'any')
  if (!hasFilter) return items
  return items.filter((entry) => webtoonMatchesPreferences(entry.webtoon, preferences))
}
