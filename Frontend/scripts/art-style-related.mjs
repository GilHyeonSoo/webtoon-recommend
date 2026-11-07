// Small public-work snapshot, used only while building static HTML; no vectors enter the client bundle.
export function parsePublicArt(data, workIds) {
  const fail = (reason) => { throw new Error(`Invalid public art snapshot: ${reason}. Run npm run sync:art.`) }
  if (data?.schemaVersion !== 1 || !Number.isInteger(data.dimensions) || data.dimensions < 2 || data.dimensions > 1024) fail('schema/dimensions')
  const { baseline, similarThreshold } = data.calibration ?? {}
  if (!Number.isFinite(baseline) || !Number.isFinite(similarThreshold) || baseline < -1 || !(baseline < similarThreshold && similarThreshold < 1)) fail('calibration')
  const vectors = new Map()
  for (const id of workIds) {
    const raw = data.items?.[id]?.v
    if (!Array.isArray(raw) || raw.length !== data.dimensions || raw.some((v) => !Number.isFinite(v))) fail(`vector ${id}`)
    const norm = Math.hypot(...raw)
    if (!Number.isFinite(norm)) fail(`non-finite norm ${id}`)
    if (norm < 1e-12) fail(`zero vector ${id}`)
    vectors.set(id, Float32Array.from(raw, (v) => v / norm))
  }
  return { vectors, baseline, similarThreshold }
}

export function publicSnapshotMatches(full, snapshot, workIds) {
  for (const key of ['schemaVersion', 'dimensions', 'source', 'calibration']) {
    if (JSON.stringify(full[key]) !== JSON.stringify(snapshot[key])) return false
  }
  // JSON round-trips Python's -0.0 as 0; they represent the same vector component.
  return workIds.every((id) => JSON.stringify(full.items?.[id]) === JSON.stringify(snapshot.items?.[id]))
}

export function rankArtRelated(work, works, art, limit = 4) {
  const seed = art.vectors.get(work.webtoon.id)
  if (!seed) return []
  return works.filter((other) => other.webtoon.id !== work.webtoon.id && art.vectors.has(other.webtoon.id)).map((other) => {
    const candidate = art.vectors.get(other.webtoon.id)
    let cosine = 0
    for (let i = 0; i < seed.length; i++) cosine += seed[i] * candidate[i]
    cosine = Math.max(-1, Math.min(1, cosine))
    const similar = cosine >= art.similarThreshold
    return { work: other, cosine, similar,
      reasons: [similar ? '썸네일의 시각적 특징이 유사한 후보' : '공개 소개 작품 중 썸네일 특징이 가까운 비교 후보'] }
  }).sort((a, b) => b.cosine - a.cosine || a.work.webtoon.id.localeCompare(b.work.webtoon.id)).slice(0, limit)
}

export function artExamples(works, art, limit = 3) {
  const seen = new Set(), pairs = []
  for (const work of works) {
    for (const match of rankArtRelated(work, works, art, works.length)) {
      const key = [work.webtoon.id, match.work.webtoon.id].sort().join('/')
      if (!match.similar || seen.has(key)) continue
      seen.add(key)
      pairs.push({ work, other: match.work, cosine: match.cosine })
    }
  }
  return pairs.sort((a, b) => b.cosine - a.cosine || a.work.webtoon.id.localeCompare(b.work.webtoon.id)).slice(0, limit)
}
