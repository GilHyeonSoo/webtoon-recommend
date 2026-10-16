import { runExclusive } from '@/security/jobs';
import 'reflect-metadata';
import { AppDataSource } from '@/database/datasource';
import {
  migrateExtendedFields,
  recreateNormalizedWebtoonView,
} from '@/database/migrateExtendedFields';
import { enrichNaverMetadataBatch } from '@/modules/naver/enrichNaverMetadataBatch';

const LIMIT = Number(process.env.ENRICH_LIMIT ?? 30);
const DELAY_MS = Number(process.env.ENRICH_DELAY_MS ?? 200);

runExclusive(async () => {
  await AppDataSource.initialize();
  await migrateExtendedFields();
  await recreateNormalizedWebtoonView();

  console.info(`📡 Naver metadata enrich (limit=${LIMIT}, delay=${DELAY_MS}ms)`);

  const result = await enrichNaverMetadataBatch({
    limit: LIMIT,
    delayMs: DELAY_MS,
  });

  console.info(JSON.stringify(result, null, 2));

  await AppDataSource.destroy();
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
