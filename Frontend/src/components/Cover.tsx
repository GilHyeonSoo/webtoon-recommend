import { useState } from 'react'
import type { Webtoon } from '../api/webtoons'

export function Cover({ webtoon, eager = false }: { webtoon: Webtoon; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  return <span className="cover-art">
    <span className="cover-monogram" aria-hidden="true">{webtoon.title.trim().slice(0, 1)}</span>
    {!failed && webtoon.thumbnail[0] && <img src={webtoon.thumbnail[0]} alt={`${webtoon.title.trim()} 표지`} loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
  </span>
}
