import type { NormalizedWebtoon, Provider } from '@/database/entity';
import { jobSleep } from '@/security/context';
import type { KakaoCardExtendedMeta } from '@/modules/kakao/functions/findKakaoCardMeta';
import {
  enrichRetryableHttpStatuses,
  enrichWebtoonMetaResult,
  type WebtoonWithExtendedMeta,
} from './enrichWebtoonMeta';

export type EnrichExportBatchOptions = {
  kakaoMetaIndex?: Map<number, KakaoCardExtendedMeta>;
  retryEnabled?: boolean;
  retryDelayMs?: number;
  retryGapMs?: number;
};

function isRetryableFailure(
  ok: boolean,
  httpStatus: number | undefined,
): boolean {
  return !ok && httpStatus !== undefined && enrichRetryableHttpStatuses.has(httpStatus);
}

async function enrichOne(
  row: NormalizedWebtoon,
  provider: Exclude<Provider, 'RIDI'>,
  options: EnrichExportBatchOptions,
) {
  return enrichWebtoonMetaResult(row, {
    kakaoMetaIndex:
      provider === 'KAKAO' ? options.kakaoMetaIndex : undefined,
  });
}

export async function enrichExportBatch(
  rows: NormalizedWebtoon[],
  provider: Exclude<Provider, 'RIDI'>,
  options: EnrichExportBatchOptions = {},
): Promise<WebtoonWithExtendedMeta[]> {
  const retryEnabled = options.retryEnabled !== false;
  const retryDelayMs =
    typeof options.retryDelayMs === 'number' && options.retryDelayMs >= 0
      ? options.retryDelayMs
      : 3_000;
  const retryGapMs =
    typeof options.retryGapMs === 'number' && options.retryGapMs >= 0
      ? options.retryGapMs
      : 2_000;

  const byId = new Map<string, WebtoonWithExtendedMeta>();
  const retryQueue: NormalizedWebtoon[] = [];

  for (const row of rows) {
    const { webtoon, ok, httpStatus } = await enrichOne(row, provider, options);
    byId.set(row.id, webtoon);
    console.info(`  ✓ ${provider} ${webtoon.title}`);
    if (isRetryableFailure(ok, httpStatus)) retryQueue.push(row);
  }

  if (!retryEnabled || !retryQueue.length) {
    return rows.map((row) => byId.get(row.id)!);
  }

  console.info(
    `\n↻ enrich 2차 재시도 (${retryQueue.length}건, ${retryDelayMs}ms 대기 후)…`,
  );
  await jobSleep(retryDelayMs);

  let recovered = 0;
  for (const row of retryQueue) {
    const { webtoon, ok, httpStatus } = await enrichOne(row, provider, options);
    byId.set(row.id, webtoon);
    if (ok) {
      recovered += 1;
      console.info(`  ✓ [enrich retry] ${provider} ${webtoon.title}`);
    } else {
      const statusLabel = httpStatus ? ` HTTP ${httpStatus}` : '';
      console.warn(`  ⚠️ [enrich retry] ${row.id} still failed${statusLabel}`);
    }
    if (retryGapMs > 0) await jobSleep(retryGapMs);
  }

  console.info(
    `↻ enrich 재시도 완료 — ${recovered}/${retryQueue.length}건 보강 성공`,
  );

  return rows.map((row) => byId.get(row.id)!);
}
