import { AppDataSource } from './datasource';

const WEBTOON_TABLES = [
  'naver_webtoon',
  'kakao_webtoon',
  'kakao_page_webtoon',
] as const;

const NEW_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'synopsis', ddl: 'synopsis text' },
  { name: 'genres', ddl: "genres text DEFAULT ''" },
  { name: 'tags', ddl: "tags text DEFAULT ''" },
  { name: 'averageRating', ddl: 'averageRating REAL' },
  { name: 'primaryGenre', ddl: "primaryGenre text DEFAULT 'unknown'" },
  { name: 'totalEpisodeCount', ddl: 'totalEpisodeCount INTEGER' },
  { name: 'isOnHiatus', ddl: 'isOnHiatus boolean' },
  { name: 'popularityCount', ddl: 'popularityCount INTEGER' },
];

async function tableHasColumn(table: string, column: string): Promise<boolean> {
  const rows: { name: string }[] = await AppDataSource.query(
    `PRAGMA table_info(${table})`,
  );
  return rows.some((row) => row.name === column);
}

export async function migrateExtendedFields(): Promise<void> {
  for (const table of WEBTOON_TABLES) {
    for (const column of NEW_COLUMNS) {
      const exists = await tableHasColumn(table, column.name);
      if (!exists) {
        await AppDataSource.query(
          `ALTER TABLE ${table} ADD COLUMN ${column.ddl}`,
        );
        console.info(`✅ [migrate] ${table}.${column.name} added`);
      }
    }
  }
}

export async function recreateNormalizedWebtoonView(): Promise<void> {
  const columns =
    'id, title, provider, updateDays, url, thumbnail, isEnd, isFree, isUpdated, ageGrade, freeWaitHour, authors, synopsis, genres, tags, averageRating, primaryGenre, totalEpisodeCount, isOnHiatus, popularityCount';

  await AppDataSource.query('DROP VIEW IF EXISTS normalized_webtoon');

  await AppDataSource.query(`
    CREATE VIEW normalized_webtoon AS
    SELECT ${columns} FROM naver_webtoon
    UNION ALL
    SELECT ${columns} FROM kakao_webtoon
    UNION ALL
    SELECT ${columns} FROM kakao_page_webtoon;
  `);
}
