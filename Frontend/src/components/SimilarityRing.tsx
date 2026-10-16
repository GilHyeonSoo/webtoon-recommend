export function SimilarityRing({ similarity }: { similarity: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, Number.isFinite(similarity) ? similarity : 0)) * 100)

  return <div className="similarity-ring" role="img" aria-label={`취향 유사도 ${percent}%`}>
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle className="similarity-ring-track" cx="50" cy="50" r="43" />
      <circle className="similarity-ring-value" cx="50" cy="50" r="43" pathLength="100"
        strokeDasharray="100" strokeDashoffset={100 - percent} transform="rotate(-90 50 50)" />
    </svg>
    <span className="similarity-ring-label" aria-hidden="true"><strong>{percent}<span>%</span></strong><span>유사도</span></span>
  </div>
}
