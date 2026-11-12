import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { analyzeWebtoons, fetchWebtoon } from './api/webtoons'
import type { Analysis, Webtoon } from './api/webtoons'
import { Cover } from './components/Cover'
import { Recommendations } from './components/Recommendations'
import { SearchDialog } from './components/SearchDialog'
import { PublicHome, SiteFooter } from './seo/PublicHome'
export type { Provider } from './api/webtoons'

export function App() {
  const [selected, setSelected] = useState<Webtoon[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [stage, setStage] = useState<'select' | 'analyzing' | 'results'>('select')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const inlineSearch = isMobile && searchOpen
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 680px)')
    const update = () => setIsMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('seed')
    if (!id || !/^(naver|kakao|kakao_page)_[a-zA-Z0-9_-]{1,100}$/.test(id)) return
    const controller = new AbortController()
    fetchWebtoon(id, controller.signal)
      .then((item) => { if (!controller.signal.aborted) setSelected([item]) })
      .catch(() => { if (!controller.signal.aborted) setError('이 작품을 불러오지 못했어요. 검색으로 다시 선택해주세요.') })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (stage === 'select') heading.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [stage])
  useEffect(() => {
    if (inlineSearch) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [inlineSearch])
  function closeSearch() { setSearchOpen(false); requestAnimationFrame(() => (addButton.current ?? confirmButton.current)?.focus()) }
  function choose(item: Webtoon) {
    setSelected((current) => current.length < 3 && !current.some((entry) => entry.id === item.id) ? [...current, item] : current)
    setError(''); closeSearch()
  }
  function remove(id: string) {
    setSelected((current) => current.filter((item) => item.id !== id)); setError('')
    requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }))
  }
  async function analyze() {
    if (!selected.length || stage !== 'select' || abort.current) return
    const controller = new AbortController(); abort.current = controller
    setError(''); setComplete(false); setStage('analyzing')
    try {
      const [result] = await Promise.all([analyzeWebtoons(selected.map((item) => item.id), controller.signal), new Promise((resolve) => setTimeout(resolve, 900))])
      if (controller.signal.aborted) return
      setComplete(true)
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (controller.signal.aborted) return
      setAnalysis(result); setStage('results')
    } catch (cause) {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '분석을 완료하지 못했어요.'); setStage('select') }
    } finally { if (abort.current === controller) abort.current = null }
  }
  function edit() { closeSearch(); setStage('select'); setAnalysis(null); setError('') }
  function scrollPage(edge: 'top' | 'bottom') {
    window.scrollTo({
      top: edge === 'top' ? 0 : document.documentElement.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }
  return <main className={`app-shell ${stage}${searchOpen && !isMobile ? ' search-modal-open' : ''}`}>
    <header className="site-header"><a href="/" className="brand" onClick={(event) => { event.preventDefault(); if (stage !== 'analyzing') edit() }}><img className="brand-mark" src="/icon.png" alt="" width={36} height={36} />웹툰추천</a></header>
    {stage === 'select' && !inlineSearch && <section className="selection-content" aria-labelledby="selection-title"><header className="selection-heading"><h1 className="question-title" id="selection-title" ref={heading} tabIndex={-1}>평소에 즐겨보는 웹툰을 선택해주세요.</h1><p className="subtitle">좋아하는 이야기에서, 다음으로 좋아할 이야기를 찾아드릴게요.</p></header>
      <div className="selection-row" aria-label="선택한 웹툰" data-count={selected.length}>
        {selected.map((item, index) => <article className="selected-cover" key={item.id} style={{ '--order': index } as CSSProperties}><div className="selected-image"><Cover webtoon={item} eager /><span className="selected-index">{String(index + 1).padStart(2, '0')}</span><button className="remove-button" aria-label={`${item.title.trim()} 선택 삭제`} onClick={() => remove(item.id)}>×</button></div><h2>{item.title.trim()}</h2></article>)}
        {selected.length < 3 && <button ref={addButton} className="add-card" aria-label="즐겨보는 웹툰 추가" onClick={() => setSearchOpen(true)}><span className="add-card-content"><span className="plus-sign" aria-hidden="true">＋</span><span>웹툰 추가</span><span className="add-card-detail">좋아하는 이야기를 찾아보세요</span></span></button>}
      </div>
      <div className="selection-actions"><p className="selection-count" role="status" aria-live="polite"><strong>{selected.length}</strong> / 3 <span>최대 3개까지 선택할 수 있어요</span></p><button ref={confirmButton} className="primary-button confirm-button" disabled={!selected.length} onClick={analyze}>확인 <span aria-hidden="true">→</span></button>{error && <p className="request-error" role="alert">{error}<br /><span>선택한 작품은 그대로예요. 확인을 눌러 다시 시도해주세요.</span></p>}</div>
      <p className="selection-footnote">한 작품만 골라도 괜찮아요.</p>
    </section>}
    {stage === 'analyzing' && <section className="analysis-content" aria-labelledby="analysis-title" aria-busy={!complete}><div className="analysis-covers">{selected.map((item, index) => <div className="analysis-cover" key={item.id} style={{ '--order': index } as CSSProperties}><Cover webtoon={item} eager /></div>)}</div><p className="eyebrow">이야기 속 취향을 찾는 중</p><h1 className="question-title" id="analysis-title">{complete ? '당신의 다음 이야기를 찾았어요.' : '당신의 취향을 분석중이에요.'}</h1><p className="subtitle">좋아하는 작품들의 장르, 태그, 줄거리를 함께 살펴보고 있어요.</p><div className={`loading-track${complete ? ' complete' : ''}`} role="progressbar" aria-label="취향 분석" aria-valuetext={complete ? '분석 완료' : '분석중'} aria-valuenow={complete ? 100 : undefined}><span /></div><p className="loading-caption" role="status">{complete ? '추천을 보여드릴게요' : '새로운 이야기가 곧 펼쳐져요'}</p></section>}
    {stage === 'results' && analysis && <Recommendations analysis={analysis} onEdit={edit} />}
    {stage === 'select' && !inlineSearch && <PublicHome />}
    {!inlineSearch && <SiteFooter />}
    {searchOpen && <SearchDialog inline={isMobile} selected={selected} onSelect={choose} onClose={closeSearch} />}
    <nav className="mobile-scroll-controls" aria-label="페이지 위아래 이동">
      <button type="button" aria-label="페이지 최상단으로 이동" title="최상단으로 이동" onClick={() => scrollPage('top')}>↑</button>
      <button type="button" aria-label="페이지 최하단으로 이동" title="최하단으로 이동" onClick={() => scrollPage('bottom')}>↓</button>
    </nav>
  </main>
}
