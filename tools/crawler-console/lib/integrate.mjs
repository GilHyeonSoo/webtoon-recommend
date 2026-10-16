import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendLog, runCommand } from './commands.mjs';
import { resolveCrawlerRunDir, resolveProjectRoot, resolveSqlitePath } from './paths.mjs';

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function nodeCommand() {
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

export function buildIntegrateConfig(raw) {
  const exportConfig = raw.export ?? {};
  const count = Number(exportConfig.countPerPlatform ?? 50_000);
  if (!Number.isSafeInteger(count) || count < 1 || count > 50_000) {
    throw new Error('export.countPerPlatform은 1~50000 사이여야 합니다.');
  }
  let providers = exportConfig.providers;
  if (!Array.isArray(providers) || !providers.length) {
    providers = exportConfig.skipKakaoPage === false
      ? ['NAVER', 'KAKAO', 'KAKAO_PAGE']
      : ['NAVER', 'KAKAO'];
  }
  const mergeFiles = Array.isArray(raw.mergeFiles) && raw.mergeFiles.length
    ? raw.mergeFiles
    : providers.map((p) => ({
        NAVER: 'webtoons-naver.json',
        KAKAO: 'webtoons-kakao.json',
        KAKAO_PAGE: 'webtoons-kakao-page.json',
      }[p])).filter(Boolean);
  const timeoutMs = Number(raw.integrateTimeoutMinutes ?? 180) * 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 60_000) {
    throw new Error('integrateTimeoutMinutes가 올바르지 않습니다.');
  }
  return { count, providers, mergeFiles, timeoutMs };
}

export async function readCatalogSummary(projectRoot) {
  const frontend = path.join(projectRoot, 'Frontend/src/data/webtoons.json');
  const backend = path.join(projectRoot, 'Backend/data/webtoons.json');
  try {
    const items = JSON.parse(await readFile(frontend, 'utf8'));
    if (!Array.isArray(items)) return null;
    const byProvider = {};
    for (const item of items) {
      byProvider[item.provider] = (byProvider[item.provider] ?? 0) + 1;
    }
    let backendCount = null;
    try {
      const backendItems = JSON.parse(await readFile(backend, 'utf8'));
      backendCount = Array.isArray(backendItems) ? backendItems.length : null;
    } catch {
      backendCount = null;
    }
    return { total: items.length, byProvider, backendCount, updatedPath: frontend };
  } catch {
    return null;
  }
}

export async function runIntegratePipeline(config, jobs, jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  const integrate = buildIntegrateConfig(config);
  const projectRoot = resolveProjectRoot(config);
  const crawlerRunDir = resolveCrawlerRunDir(config);
  const sqlitePath = resolveSqlitePath(config, crawlerRunDir);
  const exportDir = path.join(projectRoot, 'data/webtoons');
  const mergeScript = path.join(projectRoot, 'scripts/merge-frontend-webtoons.mjs');
  const backendDir = path.join(projectRoot, 'Backend');

  try {
    await access(crawlerRunDir, constants.R_OK);
    await access(path.join(crawlerRunDir, 'package.json'), constants.R_OK);
    await access(sqlitePath, constants.R_OK);
    await access(mergeScript, constants.R_OK);
    await access(path.join(backendDir, 'package.json'), constants.R_OK);
  } catch {
    throw new Error('프로젝트 경로·크롤러 실행 폴더·SQLite를 찾을 수 없습니다. config.json의 projectRoot/crawlerRunDir/sqlitePath를 확인하세요.');
  }

  const exportEnv = {
    SQLITE_PATH: sqlitePath,
    EXPORT_OUTPUT_DIR: exportDir,
    COUNT_PER_PLATFORM: String(integrate.count),
    EXPORT_PROVIDERS: integrate.providers.join(','),
    CRAWLER_JOB_TIMEOUT_MS: String(integrate.timeoutMs),
  };

  appendLog(job, `1/3 플랫폼 JSON export (${integrate.providers.join(', ')})…`);
  const npmShell = process.platform === 'win32';
  await runCommand(job, crawlerRunDir, npmCommand(), ['run', 'export:platform'], exportEnv, { shell: npmShell });

  appendLog(job, '2/3 Frontend 카탈로그 merge…');
  await runCommand(job, projectRoot, nodeCommand(), [mergeScript], {
    MERGE_WEBTOON_FILES: integrate.mergeFiles.join(','),
  });

  appendLog(job, '3/3 Backend sync:catalog…');
  await runCommand(job, backendDir, npmCommand(), ['run', 'sync:catalog'], {}, { shell: npmShell });

  const summary = await readCatalogSummary(projectRoot);
  job.state = 'succeeded';
  job.message = summary
    ? `통합 완료 — Frontend ${summary.total.toLocaleString('ko-KR')}편, Backend ${summary.backendCount?.toLocaleString('ko-KR') ?? '—'}편`
    : '통합이 완료되었습니다.';
  job.finishedAt = new Date().toISOString();
  job.updatedAt = job.finishedAt;
  job.summary = summary;
}

export function startIntegrateJob(config, jobs) {
  const running = [...jobs.values()].some((j) => j.state === 'running');
  if (running) throw new Error('다른 작업이 진행 중입니다. 완료 후 다시 시도하세요.');

  const jobId = randomUUID();
  const job = {
    id: jobId,
    kind: 'integrate',
    platform: 'integrate',
    label: '통합',
    state: 'running',
    message: '통합 작업을 준비 중…',
    log: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    summary: null,
  };
  jobs.set(jobId, job);

  void runIntegratePipeline(config, jobs, jobId).catch((error) => {
    job.state = 'failed';
    job.message = error instanceof Error ? error.message : '통합 실패';
    job.finishedAt = new Date().toISOString();
    job.updatedAt = job.finishedAt;
    appendLog(job, job.message);
  });

  return job;
}
