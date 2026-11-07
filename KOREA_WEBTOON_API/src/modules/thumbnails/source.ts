import { readFile } from 'node:fs/promises';
import sqlite3 from 'sqlite3';

export const providers = ['NAVER', 'KAKAO', 'KAKAO_PAGE'] as const;
export type ThumbnailProvider = (typeof providers)[number];
export type ThumbnailWork = {
  id: string;
  title: string;
  provider: ThumbnailProvider;
  thumbnail: string[];
};

function normalizeRows(rows: unknown[]): ThumbnailWork[] {
  const seen = new Set<string>();
  return rows.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid thumbnail catalog row');
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 200
      || typeof row.title !== 'string' || !providers.includes(row.provider as ThumbnailProvider)) {
      throw new Error('Invalid thumbnail catalog identity');
    }
    const key = `${row.provider}:${row.id}`;
    if (seen.has(key)) throw new Error(`Duplicate thumbnail catalog ID: ${key}`);
    seen.add(key);
    // TypeORM simple-array columns use commas; exported catalogs use JSON arrays.
    let thumbnails: unknown = row.thumbnail;
    if (typeof thumbnails === 'string') {
      thumbnails = thumbnails.trim().startsWith('[') ? JSON.parse(thumbnails) : thumbnails.split(',');
    }
    if (thumbnails == null || thumbnails === '') thumbnails = [];
    if (!Array.isArray(thumbnails) || !thumbnails.every((url) => typeof url === 'string')) {
      throw new Error(`Invalid thumbnail URLs: ${key}`);
    }
    return {
      id: row.id,
      title: row.title,
      provider: row.provider as ThumbnailProvider,
      thumbnail: [...new Set<string>(thumbnails.map((url: string) => url.trim()).filter(Boolean))],
    };
  });
}

export async function readSqliteWorks(filename: string): Promise<ThumbnailWork[]> {
  // Never create an empty DB, migrate its schema, or write to the crawler's DB.
  const db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const connection = new sqlite3.Database(filename, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error); else resolve(connection);
    });
  });
  const all = (sql: string) => new Promise<any[]>((resolve, reject) => {
    db.all(sql, (error, rows) => { if (error) reject(error); else resolve(rows); });
  });
  try {
    await all('PRAGMA busy_timeout = 5000');
    const knownTables = ['naver_webtoon', 'kakao_webtoon', 'kakao_page_webtoon'];
    const available = new Set((await all("SELECT name FROM sqlite_master WHERE type = 'table'")).map((row) => row.name));
    const tables = knownTables.filter((name) => available.has(name));
    if (!tables.length) throw new Error('No webtoon tables found in SQLite DB');
    // Read all provider tables in one statement/snapshot, independent of the normalized view.
    const sql = tables.map((name) => `SELECT id, title, provider, thumbnail FROM "${name}"`).join(' UNION ALL ');
    return normalizeRows(await all(`${sql} ORDER BY provider, id`));
  } finally {
    await new Promise<void>((resolve, reject) => db.close((error) => { if (error) reject(error); else resolve(); }));
  }
}

export async function readCatalogWorks(filename: string): Promise<ThumbnailWork[]> {
  const data: unknown = JSON.parse(await readFile(filename, 'utf8'));
  const rows = Array.isArray(data) ? data : (data as { webtoons?: unknown[] } | null)?.webtoons;
  if (!Array.isArray(rows)) throw new Error('Catalog must be an array or an object containing webtoons');
  return normalizeRows(rows).sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
}
