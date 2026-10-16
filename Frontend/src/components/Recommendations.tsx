import { Fragment, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Analysis, RecommendationPreferences, Webtoon } from '../api/webtoons'
import { analyzeWebtoons, genreLabels, providerLabels } from '../api/webtoons'
import { RecommendationHistory } from '../lib/recommendationHistory'
import { Cover } from './Cover'
import { SimilarityRing } from './SimilarityRing'

const platformOptions = [{ id: 'any', label: '전체' }, { id: 'naver', label: '네이버' }, { id: 'kakao', label: '카카오' }] as const
const completionOptions = [{ id: 'any', label: '전체' }, { id: 'ongoing', label: '연재 중' }, { id: 'complete', label: '완결(휴재)' }] as const

function FilterGroup<T extends string>({ title, value, options, onChange }: {
  title: string
  value: T
  options: readonly { id: T; label: string }[]
  onChange: (value: T) => void
}) {
  const name = useId()
  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === value))
  return <fieldset className="recommendation-filter">
    <legend>{title}</legend>
    <div className="filter-options" style={{ '--filter-count': options.length, '--selected-index': selectedIndex } as CSSProperties}>
      <span className="filter-selection" aria-hidden="true" />
      {options.map((option, index) => <Fragment key={option.id}>
        <label className="filter-chip">
          <input className="sr-only" type="radio" name={name} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />
          <span>{option.label}</span>
        </label>
        {index < options.length - 1 && <span className="filter-divider" aria-hidden="true" style={{ left: `${(index + 1) / options.length * 100}%` }}>ㅣ</span>}
      </Fragment>)}
    </div>
  </fieldset>
}

function Metadata({ item, compact = false }: { item: Webtoon; compact?: boolean }) {
  return <p className="work-meta">{providerLabels[item.provider]} · {item.isEnd ? '완결' : item.isOnHiatus ? '휴재' : '연재 중'}{!compact && item.totalEpisodeCount !== null && item.totalEpisodeCount !== undefined ? ` · ${item.totalEpisodeCount}화` : ''}{!compact && item.averageRating !== null && item.averageRating !== undefined ? ` · 평점 ${item.averageRating}` : ''}</p>
}

export function Recommendations({ analysis, onEdit }: { analysis: Analysis; onEdit: () => void }) {
  const [query, setQuery] = useState<{ filters: Required<RecommendationPreferences>; excludeIds: string[]; revision: number }>({
    filters: { platform: 'any', completion: 'any' }, excludeIds: [], revision: 0,
  })
  const { filters } = query
  const history = useRef(new RecommendationHistory(analysis.recommendations))
  const [recommendations, setRecommendations] = useState(analysis.recommendations)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const rankedTitle = useRef<HTMLHeadingElement>(null)
  const hasFilters = filters.platform !== 'any' || filters.completion !== 'any'

  useEffect(() => { rankedTitle.current?.focus({ preventScroll: true }) }, [analysis])

  useEffect(() => {
    setError('')
    if (query.revision === 0) {
      setRecommendations(analysis.recommendations)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const requestHistory = history.current
    setLoading(true)
    analyzeWebtoons(analysis.selected.map((item) => item.id), controller.signal, query.filters, query.excludeIds)
      .then((result) => {
        if (controller.signal.aborted || requestHistory !== history.current) return
        setRecommendations(requestHistory.accept(result.recommendations))
        if (query.revision > 0) {
          rankedTitle.current?.focus({ preventScroll: true })
          rankedTitle.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted && requestHistory === history.current) setError(cause instanceof Error ? cause.message : '추천을 불러오지 못했어요.')
      })
      .finally(() => { if (!controller.signal.aborted && requestHistory === history.current) setLoading(false) })
    return () => controller.abort()
  }, [analysis, query, retry, history])

  function changeFilters(next: Required<RecommendationPreferences>) {
    if (next.platform === filters.platform && next.completion === filters.completion) return
    history.current = new RecommendationHistory([])
    setLoading(true)
    setQuery((current) => ({ filters: next, excludeIds: [], revision: current.revision + 1 }))
  }
  function resetFilters() { changeFilters({ platform: 'any', completion: 'any' }) }
  function searchAgain() {
    if (loading || error || !recommendations.length) return
    setLoading(true)
    setQuery((current) => ({ ...current, excludeIds: history.current.snapshot(), revision: current.revision + 1 }))
  }

  return <section className="results-content results-content--results" aria-labelledby="ranked-title">
    <div className="results-columns">
      <aside className="results-sidebar" aria-label="추천 필터와 선택한 작품">
        <div className="results-toolbar"><button type="button" className="text-button edit-button" onClick={onEdit}>← 선택한 웹툰 바꾸기</button></div>
        <div className="recommendation-filters" aria-label="추천 웹툰 필터">
          <FilterGroup title="플랫폼" value={filters.platform} options={platformOptions} onChange={(platform) => changeFilters({ ...filters, platform })} />
          <FilterGroup title="연재 상태" value={filters.completion} options={completionOptions} onChange={(completion) => changeFilters({ ...filters, completion })} />
          {hasFilters && <button type="button" className="text-button reset-filters" onClick={resetFilters}>필터 초기화 ↺</button>}
        </div>
      <section className="selected-section" aria-labelledby="selected-title">
        <div className="section-heading"><h2 id="selected-title">당신이 좋아하는 이야기</h2><span>{String(analysis.selected.length).padStart(2, '0')} 작품</span></div>
        <div className="selected-details">{analysis.selected.map((item) => <article className="selected-detail glass-panel" key={item.id}>
          <Cover webtoon={item} eager />
          <div><Metadata item={item} compact /><h3 title={item.title.trim()}>{item.title.trim()}</h3>
            {item.authors.length > 0 && <p className="authors" title={item.authors.join(' · ')}>{item.authors.join(' · ')}</p>}
            <div className="tags">{[...new Set([...genreLabels(item), ...item.tags.map((tag) => tag.replace(/^#/, ''))])].slice(0, 4).map((genre) => <span key={genre}>{genre}</span>)}</div>
            {item.synopsis && <p className="synopsis selected-synopsis">{item.synopsis}</p>}
          </div>
        </article>)}</div>
      </section>
      </aside>
      <section className="ranked-section" aria-labelledby="ranked-title">
        <div className="section-heading"><h2 id="ranked-title" ref={rankedTitle} tabIndex={-1}>이 이야기도 좋아하실 거예요</h2></div>
        <p className="sr-only" role="status" aria-live="polite">{loading ? '추천을 업데이트하고 있어요.' : error ? '추천을 불러오지 못했어요.' : `${recommendations.length}개의 추천 작품을 불러왔어요.`}</p>
        <p className="ranking-note">좋아하는 작품과의 유사도 순서예요. 원하는 조건으로 골라보세요.</p>
        <div className="recommendation-results" aria-busy={loading}>
          {loading ? <div className="filter-feedback" role="status"><span className="filter-spinner" aria-hidden="true" /><p>조건에 맞는 이야기를 찾고 있어요.</p></div>
            : error ? <div className="filter-feedback"><p className="request-error" role="alert">{error}</p><button type="button" className="primary-button" onClick={() => setRetry((current) => current + 1)}>다시 시도</button></div>
              : <>
                <ol className="recommendation-list">{recommendations.map(({ webtoon: item, reasons, similarity }, index) => <li key={item.id} className="recommendation-card glass-panel" style={{ '--order': index } as CSSProperties}>
                  <span className="rank-number" aria-label={`${index + 1}위`}>{String(index + 1).padStart(2, '0')}</span>
                  <a className="recommendation-cover" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.title.trim()} 작품 보기 (새 탭)`}><Cover webtoon={item} /></a>
                  <div className="recommendation-copy"><Metadata item={item} /><h3><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title.trim()}</a></h3>
                    {item.authors.length > 0 && <p className="authors">{item.authors.join(' · ')}</p>}
                    {item.synopsis && <p className="synopsis">{item.synopsis}</p>}
                    <div className="reason-list">{reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
                  </div>
                  <div className="recommendation-score"><SimilarityRing similarity={similarity} />
                    <a className="work-link" href={item.url} target="_blank" rel="noopener noreferrer"><span>{similarity > 0 ? '작품 보기' : '둘러보기'}</span><span aria-hidden="true">↗</span></a>
                  </div>
                </li>)}</ol>
                {!recommendations.length && <div className="filter-feedback"><p className="empty-state">{query.revision > 0 ? '이미 본 작품을 제외하면 조건에 맞는 새로운 추천이 없어요. 다른 필터나 웹툰으로 찾아보세요.' : '아직 추천할 다른 작품이 없어요. 선택한 작품을 바꿔 다시 찾아보세요.'}</p>{hasFilters ? <button type="button" className="text-button" onClick={resetFilters}>다른 플랫폼에서도 찾기 →</button> : <button type="button" className="text-button" onClick={onEdit}>선택한 웹툰 바꾸기 →</button>}</div>}
              </>}
        </div>
      </section>
    </div>
    <footer className="result-footer"><button className="primary-button" disabled={loading || !!error || !recommendations.length} onClick={searchAgain}>재검색 <span aria-hidden="true">↻</span></button></footer>
  </section>
}
