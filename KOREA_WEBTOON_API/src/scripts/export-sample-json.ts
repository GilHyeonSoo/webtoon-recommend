import { runExclusive } from '@/security/jobs';
import { assertCatalogItem } from '@/modules/common/catalogValidation';
import 'reflect-metadata';
import path from 'path';
import { writeFile } from 'fs/promises';
import { AppDataSource } from '@/database/datasource';
import {
  migrateExtendedFields,
  recreateNormalizedWebtoonView,
} from '@/database/migrateExtendedFields';
import {
  KakaoPageWebtoon,
  KakaoWebtoon,
  NaverWebtoon,
} from '@/database/entity';
import { In } from 'typeorm';
import { enrichWebtoonMeta } from '@/modules/enrich/enrichWebtoonMeta';

const SAMPLE_PER_PROVIDER = Number(process.env.SAMPLE_PER_PROVIDER ?? 2);

/** 상세 API가 동작하는 작품 ID (없으면 DB에서 추가 샘플) */
const PREFERRED_IDS = {
  NAVER: ['naver_641253', 'naver_783549'],
  KAKAO: ['kakao_3090', 'kakao_3727'],
  KAKAO_PAGE: ['kakopage_20031838', 'kakopage_63820853'],
} as const;

const OUTPUT_PATH =
  process.env.EXPORT_OUTPUT_PATH ??
  path.resolve(__dirname, '../../../webtoons-sample.json');

async function sampleFromTable(
  Entity: typeof NaverWebtoon | typeof KakaoWebtoon | typeof KakaoPageWebtoon,
  take: number,
) {
  return AppDataSource.getRepository(Entity)
    .createQueryBuilder('webtoon')
    .where('LENGTH(webtoon.title) > 4')
    .orderBy('webtoon.title', 'ASC')
    .take(take)
    .getMany();
}

runExclusive(async () => {
  if (!Number.isSafeInteger(SAMPLE_PER_PROVIDER) || SAMPLE_PER_PROVIDER < 1 || SAMPLE_PER_PROVIDER > 50000) throw new Error('Invalid export count');
  await AppDataSource.initialize();
  await migrateExtendedFields();
  await recreateNormalizedWebtoonView();

  async function pickByPreferredIds(
    Entity: typeof NaverWebtoon | typeof KakaoWebtoon | typeof KakaoPageWebtoon,
    ids: readonly string[],
    fallbackTake: number,
  ) {
    const repo = AppDataSource.getRepository(Entity);
    const preferred = await repo.find({ where: { id: In([...ids]) } });
    if (preferred.length >= fallbackTake) return preferred.slice(0, fallbackTake);

    const extra = await sampleFromTable(Entity, fallbackTake - preferred.length);
    const seen = new Set(preferred.map((row) => row.id));
    return [
      ...preferred,
      ...extra.filter((row) => !seen.has(row.id)),
    ].slice(0, fallbackTake);
  }

  const [naverRows, kakaoRows, kakaoPageRows] = await Promise.all([
    pickByPreferredIds(NaverWebtoon, PREFERRED_IDS.NAVER, SAMPLE_PER_PROVIDER),
    pickByPreferredIds(KakaoWebtoon, PREFERRED_IDS.KAKAO, SAMPLE_PER_PROVIDER),
    pickByPreferredIds(
      KakaoPageWebtoon,
      PREFERRED_IDS.KAKAO_PAGE,
      SAMPLE_PER_PROVIDER,
    ),
  ]);

  const picked = [...naverRows, ...kakaoRows, ...kakaoPageRows];

  console.info(
    `📦 Enriching ${picked.length} webtoons (live API for synopsis/genres/tags)...`,
  );

  const webtoons = [];
  for (const row of picked) {
    const enriched = await enrichWebtoonMeta(row);
    assertCatalogItem(enriched);
    webtoons.push(enriched);
    console.info(`  ✓ ${enriched.provider} ${enriched.title}`);
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    samplePerProvider: SAMPLE_PER_PROVIDER,
    count: webtoons.length,
    webtoons,
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.info(`\n✅ Wrote ${OUTPUT_PATH}`);
  await AppDataSource.destroy();
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
