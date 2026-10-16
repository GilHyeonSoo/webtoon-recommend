import { readFile } from 'node:fs/promises';
import type { CatalogRepository } from '../app.js';
import { jsonItemToRow, rowToDto, type WebtoonDto } from './mapWebtoon.js';
import { assertCatalogItem } from './catalogValidation.js';
import { normalizeText } from './similarity.js';

export function titleMatchesQuery(title: string, q: string) {
  const raw = q.trim();
  if (!raw) return true;
  const normalizedQuery = normalizeText(raw);
  if (normalizedQuery) return normalizeText(title).includes(normalizedQuery);
  return title.toLocaleLowerCase('ko').includes(raw.toLocaleLowerCase('ko'));
}

// This path works from both src/lib (development) and dist/lib (built server).
export const localCatalogFile = new URL('../../data/webtoons.json', import.meta.url);

export async function createLocalCatalogRepository(file: URL = localCatalogFile): Promise<CatalogRepository> {
  const data: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(data) || !data.length || data.length > 50_000) throw new Error('Invalid local catalog size');
  const ids = new Set<string>();
  const items = data.map((item): WebtoonDto => {
    assertCatalogItem(item);
    if (ids.has(item.id as string)) throw new Error('Duplicate catalog ID');
    ids.add(item.id as string);
    return rowToDto(jsonItemToRow(item as unknown as WebtoonDto));
  }).sort((a, b) => a.title.localeCompare(b.title, 'ko') || a.id.localeCompare(b.id));
  const byId = new Map(items.map((item) => [item.id, item]));

  return {
    async list({ provider, q, limit, offset }) {
      const filtered = items.filter((item) => (!provider || item.provider === provider)
        && (!q?.trim() || titleMatchesQuery(item.title, q)));
      return { webtoons: filtered.slice(offset, offset + limit), total: filtered.length };
    },
    async find(id) { return byId.get(id) ?? null; },
  };
}
