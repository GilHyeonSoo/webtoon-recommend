import { checkJob, jobSleep as sleep } from '@/security/context';
import { NaverWebtoon } from '@/database/entity';
import { AppDataSource } from '@/database/datasource';
import {
  getNaverArticleListInfo,
  parseNaverExtendedMeta,
} from './functions/naverDetailApi';

export interface EnrichNaverBatchResult {
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
}

export const enrichNaverMetadataBatch = async ({
  limit = 50,
  delayMs = 200,
}: {
  limit?: number;
  delayMs?: number;
}): Promise<EnrichNaverBatchResult> => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(delayMs) || delayMs < 200 || delayMs > 5000) throw new Error('Invalid enrichment bounds');
  checkJob();
  const repo = AppDataSource.getRepository(NaverWebtoon);

  const rows = await repo
    .createQueryBuilder('webtoon')
    .where('webtoon.synopsis IS NULL')
    .orderBy('webtoon.title', 'ASC')
    .take(limit)
    .getMany();

  const result: EnrichNaverBatchResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  for (const row of rows) {
    checkJob();
    result.processed += 1;
    const titleId = Number(row.id.replace(/^naver_/, ''));

    if (!titleId) {
      result.skipped += 1;
      continue;
    }

    try {
      const { data, status } = await getNaverArticleListInfo(titleId);

      if (status === 404) {
        result.skipped += 1;
        await sleep(delayMs);
        continue;
      }

      const meta = parseNaverExtendedMeta(data);

      if (!meta.synopsis && !meta.genres.length && !meta.tags.length) {
        result.skipped += 1;
        await sleep(delayMs);
        continue;
      }

      await repo.update(row.id, meta);
      result.updated += 1;
    } catch (err) {
      checkJob();
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (status === 404) result.skipped += 1;
      else result.failed += 1;
      console.warn(`⚠️ [enrich-naver] ${row.id}:`, String(err));
    }

    await sleep(delayMs);
  }

  return result;
};
