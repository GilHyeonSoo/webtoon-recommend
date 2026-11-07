import path from 'node:path';
import { parseArgs } from 'node:util';
import { crawlDefaults, crawlThumbnails, planThumbnails, summarize } from '../modules/thumbnails/engine';
import { readCatalogWorks, readSqliteWorks } from '../modules/thumbnails/source';

const projectRoot = path.resolve(__dirname, '../../..');
const supportedProviders = ['NAVER', 'KAKAO'];
const help = `전체 작품 썸네일 수집 → 프로젝트 루트/이미지

루트에서: node scripts/crawl-thumbnails.mjs [옵션]
또는: npm --prefix KOREA_WEBTOON_API run crawl:thumbnails -- [옵션]

  --catalog <경로>     JSON 카탈로그 (기본: 프로젝트 루트/Backend/data/webtoons.json)
  --db <경로>          선택: 명시한 SQLite 파일에서 수집
  --output <경로>      저장 폴더 (기본: 프로젝트 루트/이미지)
  --provider <목록>    NAVER,KAKAO 중 선택 (기본: 둘 다; 카카오페이지 제외)
  --limit <수>         최대 작품 수 (기본: 전체; 작품의 모든 썸네일 저장)
  --concurrency <수>   동시 다운로드 수 (1~16, 기본: ${crawlDefaults.concurrency})
  --delay-ms <수>      전체 요청 시작 간 최소 간격 (기본: ${crawlDefaults.delayMs}ms)
  --timeout-ms <수>    요청 시도별 제한 시간 (기본: ${crawlDefaults.timeoutMs}ms)
  --retries <수>       일시적 오류 추가 재시도 횟수 (0~5, 기본: ${crawlDefaults.retries})
  --force             기존 이미지도 다시 다운로드
  --dry-run           다운로드/파일 변경 없이 전체 대상 집계
  --help              도움말

상대 경로는 명령을 실행한 폴더 기준입니다. Ctrl+C로 중단 후 같은 명령으로 재개합니다.
결과/실패 내역: 저장 폴더/manifest.json. 정상 이미지 재사용, 누락/실패 파일 자동 재시도.
종료 코드: 0=모두 성공, 1=실행 오류, 2=실패/썸네일 누락 있음, 130=중단.
`;

function integer(value: string | undefined, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`--${name}: 정수를 입력하세요`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`--${name}: ${min}~${max} 범위여야 합니다`);
  return number;
}

async function main() {
  const { values } = parseArgs({ options: {
    db: { type: 'string' }, catalog: { type: 'string' }, output: { type: 'string' },
    provider: { type: 'string' }, limit: { type: 'string' }, concurrency: { type: 'string' },
    'delay-ms': { type: 'string' }, 'timeout-ms': { type: 'string' }, retries: { type: 'string' },
    force: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.info(help); return; }
  if (values.db && values.catalog) throw new Error('--db와 --catalog는 함께 사용할 수 없습니다');
  const selected = values.provider?.split(',').map((value) => value.trim().toUpperCase()) ?? supportedProviders;
  if (!selected.length || selected.some((value) => !supportedProviders.includes(value))) {
    throw new Error('--provider: NAVER,KAKAO 중 선택하세요 (카카오페이지는 수집 대상에서 제외됩니다)');
  }
  const limit = integer(values.limit, 'limit', Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
  const config = {
    concurrency: integer(values.concurrency, 'concurrency', crawlDefaults.concurrency, 1, 16),
    delayMs: integer(values['delay-ms'], 'delay-ms', crawlDefaults.delayMs, 0, 60_000),
    timeoutMs: integer(values['timeout-ms'], 'timeout-ms', crawlDefaults.timeoutMs, 100, 120_000),
    retries: integer(values.retries, 'retries', crawlDefaults.retries, 0, 5),
  };
  const input = path.resolve(values.db ?? values.catalog ?? path.join(projectRoot, 'Backend/data/webtoons.json'));
  const source = `${values.db ? 'sqlite' : 'catalog'}:${input}`;
  const all = values.db ? await readSqliteWorks(input) : await readCatalogWorks(input);
  const works = all.filter((work) => selected.includes(work.provider)).slice(0, limit);
  if (!works.length) throw new Error('수집할 작품이 없습니다. 입력 데이터와 플랫폼 필터를 확인하세요');
  const outputDir = path.resolve(values.output ?? path.join(projectRoot, '이미지'));
  console.info(`입력: ${source}\n저장: ${outputDir}`);
  for (const provider of supportedProviders) {
    const rows = works.filter((work) => work.provider === provider);
    if (rows.length) console.info(`${provider}: ${rows.length}작품 / ${rows.reduce((n, work) => n + work.thumbnail.length, 0)}이미지`);
  }
  const summary = summarize(works.length, planThumbnails(works));
  console.info(`전체 ${summary.works}작품 / ${summary.images}이미지 / 썸네일 미등록 ${summary.missing}작품`);
  if (values['dry-run']) { console.info('대상 확인 완료 (다운로드/파일 변경 없음)'); return; }
  const controller = new AbortController();
  const stop = () => {
    if (controller.signal.aborted) return;
    console.info('중단 요청: 진행 중인 요청을 취소하고 결과를 저장합니다.');
    controller.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const started = Date.now();
  try {
    const manifest = await crawlThumbnails(works, {
      ...config, outputDir, source, force: values.force, signal: controller.signal,
      onProgress: (status) => console.info(`저장 ${status.downloaded} / 재사용 ${status.skipped} / 실패 ${status.failed} / 미등록 ${status.missing} / 남음 ${status.pending} (${Math.round((Date.now() - started) / 1000)}초)`),
    });
    console.info(`결과: ${path.join(outputDir, 'manifest.json')} (${manifest.state})`);
    if (manifest.state === 'cancelled') process.exitCode = 130;
    else if (manifest.summary.failed || manifest.summary.missing) process.exitCode = 2;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
