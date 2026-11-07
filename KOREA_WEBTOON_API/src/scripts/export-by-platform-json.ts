import { runExclusive } from '@/security/jobs';
import { assertCatalogItem } from '@/modules/common/catalogValidation';
import 'reflect-metadata';
import path from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { AppDataSource } from '@/database/datasource';
import {
  migrateExtendedFields,
  recreateNormalizedWebtoonView,
} from '@/database/migrateExtendedFields';
import {
  KakaoPageWebtoon,
  KakaoWebtoon,
  NaverWebtoon,
  type Provider,
} from '@/database/entity';
import { In } from 'typeorm';
import { enrichExportBatch } from '@/modules/enrich/enrichExportBatch';
import { buildKakaoCardMetaIndex } from '@/modules/kakao/functions/findKakaoCardMeta';

const COUNT_PER_PLATFORM = Number(process.env.COUNT_PER_PLATFORM ?? 10);

const parseEnrichRetryConfig = () => {
  const enabled = process.env.ENRICH_RETRY_ENABLED !== '0';
  const delayMs = Number(process.env.ENRICH_RETRY_DELAY_MS ?? 3_000);
  const gapMs = Number(process.env.ENRICH_RETRY_GAP_MS ?? 2_000);
  return {
    retryEnabled: enabled,
    retryDelayMs: Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 3_000,
    retryGapMs: Number.isFinite(gapMs) && gapMs >= 0 ? gapMs : 2_000,
  };
};

const OUTPUT_DIR =
  process.env.EXPORT_OUTPUT_DIR ??
  path.resolve(__dirname, '../../../data/webtoons');

const PREFERRED_IDS: Record<
  Exclude<Provider, 'RIDI'>,
  readonly string[]
> = {
  NAVER: [
    'naver_641253',
    'naver_783549',
    'naver_850650',
    'naver_818791',
    'naver_823195',
  ],
  KAKAO: ['kakao_3090', 'kakao_3727'],
  KAKAO_PAGE: ['kakopage_20031838', 'kakopage_63820853'],
};

const FILE_BY_PROVIDER: Record<Exclude<Provider, 'RIDI'>, string> = {
  NAVER: 'webtoons-naver.json',
  KAKAO: 'webtoons-kakao.json',
  KAKAO_PAGE: 'webtoons-kakao-page.json',
};

const ALL_EXPORT_PROVIDERS: Exclude<Provider, 'RIDI'>[] = [
  'NAVER',
  'KAKAO',
  'KAKAO_PAGE',
];

const parseExportProviders = (): Exclude<Provider, 'RIDI'>[] => {
  const raw = process.env.EXPORT_PROVIDERS?.trim();
  if (raw) {
    const list = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is Exclude<Provider, 'RIDI'> =>
        (ALL_EXPORT_PROVIDERS as string[]).includes(s),
      );
    if (list.length) return list;
  }
  if (process.env.EXPORT_SKIP_KAKAO_PAGE === '1') {
    return ['NAVER', 'KAKAO'];
  }
  return ALL_EXPORT_PROVIDERS;
};

async function pickRows(
  Entity: typeof NaverWebtoon | typeof KakaoWebtoon | typeof KakaoPageWebtoon,
  preferredIds: readonly string[],
  take: number,
) {
  const repo = AppDataSource.getRepository(Entity);
  const preferred = await repo.find({ where: { id: In([...preferredIds]) } });
  const seen = new Set(preferred.map((row) => row.id));
  const result = [...preferred];

  if (result.length < take) {
    let skip = 0;
    const pageSize = 500;
    while (result.length < take) {
      const pool = await repo
        .createQueryBuilder('webtoon')
        .where('LENGTH(webtoon.title) > 2')
        .orderBy('webtoon.title', 'ASC')
        .skip(skip)
        .take(pageSize)
        .getMany();
      if (!pool.length) break;
      for (const row of pool) {
        if (seen.has(row.id)) continue;
        result.push(row);
        seen.add(row.id);
        if (result.length >= take) break;
      }
      skip += pool.length;
    }
  }

  return result.slice(0, take);
}


runExclusive(async () => {
  if (!Number.isSafeInteger(COUNT_PER_PLATFORM) || COUNT_PER_PLATFORM < 1 || COUNT_PER_PLATFORM > 50000) throw new Error('Invalid export count');
  await AppDataSource.initialize();
  await migrateExtendedFields();
  await recreateNormalizedWebtoonView();

  await mkdir(OUTPUT_DIR, { recursive: true });

  const providers = parseExportProviders();
  console.info(
    `📦 ${COUNT_PER_PLATFORM} works per platform → ${OUTPUT_DIR} (${providers.join(', ')})`,
  );

  const exports: {
    provider: Exclude<Provider, 'RIDI'>;
    rows: NaverWebtoon[] | KakaoWebtoon[] | KakaoPageWebtoon[];
  }[] = [];

  if (providers.includes('NAVER')) {
    exports.push({
      provider: 'NAVER',
      rows: await pickRows(
        NaverWebtoon,
        PREFERRED_IDS.NAVER,
        COUNT_PER_PLATFORM,
      ),
    });
  }
  if (providers.includes('KAKAO')) {
    exports.push({
      provider: 'KAKAO',
      rows: await pickRows(
        KakaoWebtoon,
        PREFERRED_IDS.KAKAO,
        COUNT_PER_PLATFORM,
      ),
    });
  }
  if (providers.includes('KAKAO_PAGE')) {
    exports.push({
      provider: 'KAKAO_PAGE',
      rows: await pickRows(
        KakaoPageWebtoon,
        PREFERRED_IDS.KAKAO_PAGE,
        COUNT_PER_PLATFORM,
      ),
    });
  }

  const kakaoMetaIndex = providers.includes('KAKAO')
    ? await (async () => {
        console.info('⌛️ [KAKAO] building placement index...');
        return buildKakaoCardMetaIndex();
      })()
    : undefined;

  const enrichRetry = parseEnrichRetryConfig();
  if (enrichRetry.retryEnabled) {
    console.info(
      `↻ enrich 401/404 재시도: delay ${enrichRetry.retryDelayMs}ms, gap ${enrichRetry.retryGapMs}ms`,
    );
  }

  for (const { provider, rows } of exports) {
    console.info(`\n🔹 ${provider} (${rows.length})`);
    const webtoons = await enrichExportBatch(rows, provider, {
      kakaoMetaIndex:
        provider === 'KAKAO' ? kakaoMetaIndex : undefined,
      ...enrichRetry,
    });
    for (const item of webtoons) assertCatalogItem(item);

    const filePath = path.join(OUTPUT_DIR, FILE_BY_PROVIDER[provider]);
    const payload = {
      exportedAt: new Date().toISOString(),
      provider,
      count: webtoons.length,
      webtoons,
    };

    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.info(`✅ ${filePath}`);
  }

  await AppDataSource.destroy();
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
