import type { Recommendation } from '../api/webtoons'

// Keep one instance for repeated searches; replace it when the filters change.
export class RecommendationHistory {
  private readonly seen = new Set<string>()

  constructor(initial: readonly Recommendation[]) {
    for (const entry of initial) this.seen.add(entry.webtoon.id)
  }

  snapshot(): string[] { return [...this.seen] }

  accept(entries: readonly Recommendation[]): Recommendation[] {
    const fresh: Recommendation[] = []
    for (const entry of entries) {
      if (this.seen.has(entry.webtoon.id)) continue
      this.seen.add(entry.webtoon.id)
      fresh.push(entry)
    }
    return fresh
  }
}
