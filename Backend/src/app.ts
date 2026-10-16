import cors from 'cors';
import express from 'express';
import type { WebtoonDto } from './lib/mapWebtoon.js';
import { parseRecommendationPreferences } from './lib/preferences.js';
import { RecommendationPool, ServiceBusy } from './lib/recommendationPool.js';
import { rateLimit, securityHeaders } from './lib/security.js';

export type CatalogRepository = {
  list(options: { provider?: string; q?: string; limit: number; offset: number }): Promise<{ webtoons: WebtoonDto[]; total: number }>;
  find(id: string): Promise<WebtoonDto | null>;
};
const providers = new Set(['NAVER', 'KAKAO', 'KAKAO_PAGE']);
function integer(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  const number = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isInteger(number) && number >= 1 && number <= max ? number : null;
}

export function createApp(repository: CatalogRepository, options: { rateLimits?: boolean; pool?: RecommendationPool } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.set('trust proxy', process.env.TRUSTED_PROXY_CIDRS?.split(',').map((s) => s.trim()).filter(Boolean) ?? false);
  const origins = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  if (process.env.NODE_ENV === 'production' && !origins.length) throw new Error('CORS_ORIGIN is required in production');
  if (!origins.length) origins.push('http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173');
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password || !['https:', 'http:'].includes(parsed.protocol)
      || (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) throw new Error('Invalid CORS_ORIGIN');
  }
  app.use(securityHeaders);
  app.use(cors({ origin(origin, callback) { callback(null, !origin || origins.includes(origin)); } }));
  if (options.rateLimits !== false) {
    app.use('/api', rateLimit(60, 120));
    app.use('/api/recommendations', rateLimit(3, 30));
  }
  app.use(express.json({ limit: '2mb' }));
  const pool = options.pool ?? new RecommendationPool();
  app.locals.close = () => pool.close();
  let cache: { items: WebtoonDto[]; expires: number } | undefined;
  let pending: Promise<WebtoonDto[]> | undefined;
  async function catalog() {
    if (cache && cache.expires > Date.now()) return cache.items;
    if (pending) return pending;
    pending = (async () => {
      const items: WebtoonDto[] = [];
      for (let offset = 0; ; ) {
        const page = await repository.list({ limit: 1000, offset });
        items.push(...page.webtoons);
        offset += page.webtoons.length;
        if (items.length >= page.total || !page.webtoons.length) break;
      }
      cache = { items, expires: Date.now() + 60_000 };
      return items;
    })();
    try { return await pending; } finally { pending = undefined; }
  }
  app.locals.prepare = async () => pool.prepare(await catalog());
  app.get('/ready', (_req, res) => { res.status(pool.ready ? 200 : 503).json({ ready: pool.ready }); });
  app.get('/health', (_req, res) => { res.json({ ok: true, service: 'webtoon-api' }); });
  app.get('/api/webtoons', async (req, res) => {
    if (Object.keys(req.query).some((key) => !['provider', 'q', 'limit'].includes(key))) { res.status(400).json({ message: '검색 조건을 확인해주세요.' }); return; }
    const provider = req.query.provider;
    const q = req.query.q;
    const limit = integer(req.query.limit, 50, 100);
    if ((provider !== undefined && (typeof provider !== 'string' || !providers.has(provider))) || (q !== undefined && (typeof q !== 'string' || q.length > 100)) || limit === null) {
      res.status(400).json({ message: '검색 조건을 확인해주세요.' }); return;
    }
    try {
      const result = await repository.list({ provider: provider as string | undefined, q: (q as string | undefined)?.trim(), limit, offset: 0 });
      res.json({ ...result, count: result.webtoons.length });
    } catch { res.status(500).json({ message: '작품을 불러오지 못했어요. 잠시 후 다시 시도해주세요.' }); }
  });
  app.get('/api/webtoons/:id', async (req, res) => {
    try {
      const webtoon = await repository.find(req.params.id);
      if (!webtoon) { res.status(404).json({ message: '작품을 찾지 못했어요.' }); return; }
      res.json({ webtoon });
    } catch { res.status(500).json({ message: '작품을 불러오지 못했어요.' }); }
  });
  app.post('/api/recommendations', async (req, res) => {
    const ids: unknown = req.body?.webtoonIds;
    const limit = integer(req.body?.limit, 10, 20);
    const preferences = parseRecommendationPreferences(req.body?.preferences);
    const excludeIds: unknown = req.body?.excludeIds;
    if (excludeIds !== undefined && (!Array.isArray(excludeIds) || excludeIds.length > 50_000 || excludeIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200) || new Set(excludeIds).size !== excludeIds.length)) {
      res.status(400).json({ message: '제외할 작품 목록을 확인해주세요.' }); return;
    }
    if (preferences === null) { res.status(400).json({ message: '선택한 조건을 확인해주세요.' }); return; }
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200) || new Set(ids).size !== ids.length || limit === null) {
      res.status(400).json({ message: '서로 다른 웹툰을 1~3개 선택해주세요.' }); return;
    }
    try {
      const items = await catalog();
      const byId = new Map(items.map((item) => [item.id, item]));
      const selected = ids.map((id) => byId.get(id));
      if (selected.some((item) => !item)) { res.status(404).json({ message: '선택한 작품이 변경되었어요. 다시 검색해주세요.' }); return; }
      const seeds = selected as WebtoonDto[];
      const method = preferences?.platform || preferences?.completion ? 'content-similarity-v1-preferences' : 'content-similarity-v1';
      const controller = new AbortController();
      const cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', cancel);
      try {
        const recommendations = await pool.run(items, ids as string[], limit, preferences, excludeIds as string[] | undefined, controller.signal);
        if (!controller.signal.aborted) res.json({ selected: seeds, recommendations, catalogCount: items.length, method });
      } finally { res.removeListener('close', cancel); }
    } catch (error) {
      if (res.destroyed) return;
      const status = error instanceof ServiceBusy ? error.status : 500;
      if (status === 503) res.setHeader('Retry-After', '2');
      res.status(status).json({ message: status === 503 ? '추천 요청이 많아요. 잠시 후 다시 시도해주세요.' : '취향 분석을 완료하지 못했어요. 잠시 후 다시 시도해주세요.' });
    }
  });
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status((error as Error & { status?: number }).status === 413 ? 413 : error instanceof SyntaxError ? 400 : 500).json({ message: '요청을 처리하지 못했어요.' });
  });
  return app;
}
