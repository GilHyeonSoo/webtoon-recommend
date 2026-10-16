import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { specs } from './swagger';
import { putKakaoPage } from './routes/update/kakao-page';
import { putNaver } from './routes/update/naver';
import { putKakao } from './routes/update/kakao';
import { ROUTES } from './constants';
import { getHealthCheck } from './routes/health-check';
import { getWebtoons } from './routes/webtoons';
import { getWebtoonById } from './routes/webtoon-by-id';
import { putEnrichNaver } from './routes/enrich/naver';
import { adminOnly, validateAdminConfig } from './security/admin';
import { getJob } from './security/jobs';
import { rateLimit } from './security/rateLimit';

export function createCrawlerApp() {
  validateAdminConfig();
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  // Local use is loopback-only; configure BIND_HOST only on an isolated private service.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer'); next();
  });
  const origins = process.env.CRAWLER_CORS_ORIGIN?.split(',').map((value) => value.trim()) ?? [];
  app.use(cors({ origin(origin, callback) { callback(null, !origin || origins.includes(origin)); } }));
  app.use(rateLimit(30, 60));
  app.get(ROUTES.HEALTH_CHECK, getHealthCheck);
  app.get(ROUTES.GET_WEBTOONS, getWebtoons);
  app.get(ROUTES.GET_WEBTOON_BY_ID, getWebtoonById);
  // Defense in depth: authorization also lives inside each mutation handler.
  app.put(ROUTES.UPDATE_NAVER, adminOnly, putNaver);
  app.put(ROUTES.UPDATE_KAKAO, adminOnly, putKakao);
  app.put(ROUTES.UPDATE_KAKAO_PAGE, adminOnly, putKakaoPage);
  app.put(ROUTES.ENRICH_NAVER, adminOnly, putEnrichNaver);
  app.get('/internal/jobs/:id', adminOnly, (req, res) => {
    const job = getJob(req.params.id);
    if (!job) { res.sendStatus(404); return; }
    res.json({ job });
  });
  app.use(ROUTES.SWAGGER, adminOnly, swaggerUi.serve, swaggerUi.setup(specs));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof URIError ? 400 : 500).json({ message: 'Request failed' });
  });
  return app;
}
