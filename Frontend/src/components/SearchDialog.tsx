import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { providerLabels, searchWebtoons } from '../api/webtoons'
import type { Webtoon } from '../api/webtoons'
import { Cover } from './Cover'

export function SearchDialog({ selected, onSelect, onClose }: { selected: Webtoon[]; onSelect: (item: Webtoon) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Webtoon[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [active, setActive] = useState(-1)
  const [attempt, setAttempt] = useState(0)
  const selectedIds = new Set(selected.map((item) => item.id))
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); }, [])
  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      try {
        const result = await searchWebtoons(query.trim(), controller.signal)
        if (!controller.signal.aborted) { setItems(result.webtoons); setActive(-1) }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '검색하지 못했어요.') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 200)
    return () => { clearTimeout(timeout); controller.abort() }
  }, [query, attempt])
  useEffect(() => { if (active >= 0) document.getElementById(`search-option-${active}`)?.scrollIntoView({ block: 'nearest' }) }, [active])
  function keydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    const eligible = items.map((item, index) => selectedIds.has(item.id) ? -1 : index).filter((index) => index >= 0)
    if (!eligible.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const position = eligible.indexOf(active)
      const next = event.key === 'ArrowDown' ? (position + 1) % eligible.length : position < 0 ? eligible.length - 1 : (position - 1 + eligible.length) % eligible.length
      setActive(eligible[next])
    } else if (event.key === 'Enter' && active >= 0 && !selectedIds.has(items[active].id)) {
      event.preventDefault(); onSelect(items[active])
    }
  }
  return <dialog ref={dialog} className="search-dialog glass-panel" aria-labelledby="search-title" onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose() } }}>
    <div className="search-heading"><div><p className="eyebrow">한 작품씩, 당신의 취향</p><h2 id="search-title">어떤 웹툰을 즐겨보세요?</h2></div><button className="icon-button" onClick={onClose} aria-label="검색창 닫기">×</button></div>
    <div className="search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      <input ref={input} value={query} maxLength={100} aria-label="웹툰 제목 검색" placeholder="웹툰 제목을 입력해주세요" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="search-results" aria-activedescendant={active >= 0 ? `search-option-${active}` : undefined} onKeyDown={keydown} onChange={(event) => { setQuery(event.target.value); setItems([]); setActive(-1); setLoading(true); setError('') }} />
      {query && <button className="clear-search" aria-label="검색어 지우기" onClick={() => { setQuery(''); setItems([]); setActive(-1); setLoading(true); setError(''); input.current?.focus() }}>×</button>}
    </div>
    <div className="search-meta"><span>{query.trim() ? '검색 결과' : '작품 둘러보기'}</span><span>{selected.length} / 3 선택</span></div>
    <div className="search-scroll" aria-busy={loading}>
      {loading && <div className="search-status" role="status"><span className="small-spinner" /> 작품을 찾고 있어요</div>}
      {error && <div className="search-status" role="alert"><p>{error}</p><button className="text-button" onClick={() => { setLoading(true); setError(''); setItems([]); setActive(-1); setAttempt((n) => n + 1) }}>다시 검색하기 ↻</button></div>}
      {!loading && !error && !items.length && <div className="search-status" role="status"><p>찾는 작품이 없어요.</p><span>제목의 일부로 다시 검색해보세요.</span></div>}
      <ul id="search-results" role="listbox" aria-label="웹툰 검색 결과">
        {!loading && !error && items.map((item, index) => <li id={`search-option-${index}`} key={item.id} role="option" aria-selected={active === index} aria-disabled={selectedIds.has(item.id)} className={`search-option${active === index ? ' active' : ''}`} onPointerMove={() => { if (!selectedIds.has(item.id)) setActive(index) }} onClick={() => { if (!selectedIds.has(item.id)) onSelect(item) }}>
          <Cover webtoon={item} /><div><strong>{item.title.trim()}</strong><span>{providerLabels[item.provider]}{item.authors.length ? ` · ${item.authors.join(', ')}` : ''}</span></div><span className="option-action">{selectedIds.has(item.id) ? '선택됨' : '＋'}</span>
        </li>)}
      </ul>
    </div>
    <p className="search-footer">최대 3개의 작품으로 취향을 찾아드릴게요.</p>
  </dialog>
}
