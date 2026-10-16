import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalogSummary, startIntegrateJob } from './lib/integrate.mjs';
import { deployStatusFromConfig, startDeployJob } from './lib/deploy.mjs';
import { resolveProjectRoot } from './lib/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const configPath = path.join(__dirname, 'config.json');

const jobs = new Map();

function isJobRunning() {
  return [...jobs.values()].some((job) => job.state === 'running');
}

async function loadConfig() {
  try {
    await access(configPath, constants.R_OK);
  } catch {
    throw new Error('config.json이 없습니다. config.example.json을 복사해 adminSecret을 설정하세요.');
  }
  const raw = JSON.parse(await readFile(configPath, 'utf8'));
  const base = new URL(raw.crawlerBaseUrl ?? 'http://127.0.0.1:3000');
  const secret = raw.adminSecret;
  if (!secret || secret.length < 32) throw new Error('adminSecret은 32자 이상이어야 합니다.');
  if (base.username || base.password || base.search || base.hash) {
    throw new Error('crawlerBaseUrl 형식이 올바르지 않습니다.');
  }
  const port = Number(raw.consolePort ?? 3780);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('consolePort가 올바르지 않습니다.');
  const timeoutMs = Number(raw.jobTimeoutMinutes ?? 25) * 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 60_000) throw new Error('jobTimeoutMinutes가 올바르지 않습니다.');
  const platforms = Array.isArray(raw.platforms) ? raw.platforms : [];
  return { ...raw, base, secret, port, timeoutMs, platforms };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function crawlerFetch(config, pathname, { method = 'GET' } = {}) {
  const response = await fetch(new URL(pathname, config.base), {
    method,
    headers: { 'x-crawler-secret': config.secret },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data };
}

async function fetchCatalogTotal(config, provider) {
  const response = await fetch(
    new URL(`/webtoons?provider=${provider}&page=1&perPage=1`, config.base),
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) return null;
  const data = await response.json();
  return typeof data.total === 'number' ? data.total : null;
}

async function buildStatus(config) {
  const health = await fetch(new URL('/health-check', config.base), {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  const online = health?.ok ?? false;
  let dataInfo = [];
  if (online) {
    try {
      dataInfo = await health.json();
    } catch {
      dataInfo = [];
    }
  }

  const [naverTotal, kakaoTotal, kakaoPageTotal] = online
    ? await Promise.all([
        fetchCatalogTotal(config, 'NAVER'),
        fetchCatalogTotal(config, 'KAKAO'),
        fetchCatalogTotal(config, 'KAKAO_PAGE'),
      ])
    : [null, null, null];

  const projectRoot = resolveProjectRoot(config);
  const catalog = await readCatalogSummary(projectRoot);

  return {
    crawlerOnline: online,
    crawlerBaseUrl: config.base.origin,
    projectRoot,
    counts: { NAVER: naverTotal, KAKAO: kakaoTotal, KAKAO_PAGE: kakaoPageTotal },
    catalog,
    dataInfo,
    platforms: config.platforms,
    deploy: deployStatusFromConfig(config),
    busy: isJobRunning(),
  };
}

async function pollJob(config, jobId, platformKey) {
  const deadline = Date.now() + config.timeoutMs;
  const record = jobs.get(jobId);
  if (!record) return;

  while (Date.now() < deadline) {
    const { ok, status, data } = await crawlerFetch(config, `/internal/jobs/${encodeURIComponent(jobId)}`);
    if (!ok) {
      record.state = 'failed';
      record.message = `작업 상태 조회 실패 (${status})`;
      record.finishedAt = new Date().toISOString();
      return;
    }
    const state = data?.job?.state;
    record.state = state ?? 'unknown';
    record.updatedAt = new Date().toISOString();
    if (state === 'succeeded') {
      record.message = `${platformKey} 크롤이 완료되었습니다. SQLite에 저장되었습니다.`;
      record.finishedAt = record.updatedAt;
      return;
    }
    if (state === 'failed') {
      record.message = `${platformKey} 크롤이 실패했습니다. 크롤러 로그를 확인하세요.`;
      record.finishedAt = record.updatedAt;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  record.state = 'failed';
  record.message = '시간 초과 — 크롤러가 아직 실행 중일 수 있습니다.';
  record.finishedAt = new Date().toISOString();
}

async function startCrawl(config, platformKey) {
  const platform = config.platforms.find((p) => p.key === platformKey);
  if (!platform?.enabled) throw new Error('비활성화된 플랫폼입니다.');
  if (isJobRunning()) throw new Error('다른 작업이 진행 중입니다. 완료 후 다시 시도하세요.');

  const { ok, status, data } = await crawlerFetch(config, `/update/${platformKey}`, { method: 'PUT' });
  if (status === 409) throw new Error('크롤러가 이미 다른 작업을 실행 중입니다 (409).');
  if (!ok || !data?.job?.id) {
    throw new Error(
      status === 401 || status === 404
        ? '크롤러 관리 API에 연결하지 못했습니다. ENABLE_ADMIN_HTTP=true 와 adminSecret을 확인하세요.'
        : `크롤 시작 실패 (HTTP ${status})`,
    );
  }

  const jobId = data.job.id;
  const record = {
    id: jobId,
    kind: 'crawl',
    platform: platformKey,
    label: platform.label,
    state: 'running',
    message: `${platform.label} 크롤을 시작했습니다…`,
    log: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(jobId, record);
  void pollJob(config, jobId, platformKey);
  return record;
}

function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, safe);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end();
    return;
  }
  readFile(filePath)
    .then((body) => {
      const type = filePath.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : filePath.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'application/javascript; charset=utf-8';
      res.writeHead(200, { 'Content-Type': type });
      res.end(body);
    })
    .catch(() => {
      res.writeHead(404);
      res.end('Not found');
    });
}

async function main() {
  const config = await loadConfig();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return json(res, 200, await buildStatus(config));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/jobs/'.length));
        const job = jobs.get(id);
        if (!job) return json(res, 404, { message: '작업을 찾을 수 없습니다.' });
        return json(res, 200, { job });
      }
      if (req.method === 'POST' && url.pathname === '/api/crawl') {
        const body = await readBody(req);
        const platform = body?.platform;
        if (typeof platform !== 'string') return json(res, 400, { message: 'platform이 필요합니다.' });
        try {
          const job = await startCrawl(config, platform);
          return json(res, 202, { job });
        } catch (error) {
          return json(res, 400, { message: error instanceof Error ? error.message : '크롤 시작 실패' });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/integrate') {
        try {
          const job = startIntegrateJob(config, jobs);
          return json(res, 202, { job });
        } catch (error) {
          return json(res, 400, { message: error instanceof Error ? error.message : '통합 시작 실패' });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/deploy') {
        try {
          const job = startDeployJob(config, jobs);
          return json(res, 202, { job });
        } catch (error) {
          return json(res, 400, { message: error instanceof Error ? error.message : '배포 시작 실패' });
        }
      }
      if (req.method === 'GET') return serveStatic(req, res);
      json(res, 405, { message: 'Method not allowed' });
    } catch (error) {
      json(res, 500, { message: error instanceof Error ? error.message : '서버 오류' });
    }
  });

  server.listen(config.port, '127.0.0.1', () => {
    console.log(`Crawler Console: http://127.0.0.1:${config.port}/`);
    console.log(`대상 크롤러: ${config.base.origin}`);
    console.log(`프로젝트: ${resolveProjectRoot(config)}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
