// Explicit development fixture: exercises the real HTTP app and ranking algorithm.
// Reads repository snapshots only; never connects to or writes Supabase.
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import type { WebtoonDto } from '../src/lib/mapWebtoon.js';
const items: WebtoonDto[] = [];
for (const provider of ['naver', 'kakao', 'kakao-page']) {
  const file = new URL(`../../data/webtoons/webtoons-${provider}.json`, import.meta.url);
  const data = JSON.parse(await readFile(file, 'utf8'));
  items.push(...data.webtoons);
}
const app = createApp({
  async list({ q, provider, limit, offset }) {
    const filtered = items.filter((item) => (!provider || item.provider === provider) && (!q || item.title.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
    return { webtoons: filtered.slice(offset, offset + limit), total: filtered.length };
  },
  async find(id) { return items.find((item) => item.id === id) ?? null; },
});
app.listen(3001, '127.0.0.1', () => console.log(`Snapshot QA API: http://127.0.0.1:3001 (${items.length} titles, no Supabase connection)`));
