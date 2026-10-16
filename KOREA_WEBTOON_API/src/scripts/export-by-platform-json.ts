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
import { enrichWebtoonMeta } from '@/modules/enrich/enrichWebtoonMeta';
import { buildKakaoCardMetaIndex } from '@/modules/kakao/functions/findKakaoCardMeta';

const COUNT_PER_PLATFORM = Number(process.env.COUNT_PER_PLATFORM ?? 10);

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

async function enrichRows(
  rows: NaverWebtoon[] | KakaoWebtoon[] | KakaoPageWebtoon[],
  provider: Exclude<Provider, 'RIDI'>,
  kakaoMetaIndex?: Awaited<ReturnType<typeof buildKakaoCardMetaIndex>>,
) {
  const webtoons = [];

  for (const row of rows) {
    const enriched = await enrichWebtoonMeta(row, {
      kakaoMetaIndex:
        provider === 'KAKAO' ? kakaoMetaIndex : undefined,
    });
    assertCatalogItem(enriched);
    webtoons.push(enriched);
    console.info(`  ✓ ${provider} ${enriched.title}`);
  }

  return webtoons;
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

  for (const { provider, rows } of exports) {
    console.info(`\n🔹 ${provider} (${rows.length})`);
    const webtoons = await enrichRows(
      rows,
      provider,
      provider === 'KAKAO' ? kakaoMetaIndex : undefined,
    );

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
