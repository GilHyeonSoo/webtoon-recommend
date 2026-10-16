import { assertCatalogItem } from '../lib/catalogValidation.js';
import 'dotenv/config';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../lib/supabase.js';
import { jsonItemToRow, type WebtoonDto } from '../lib/mapWebtoon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir =
  process.env.WEBTOON_JSON_DIR ??
  path.resolve(__dirname, '../../../data/webtoons');

type ExportFile = {
  webtoons: WebtoonDto[];
};

(async () => {
  const files = (await readdir(dataDir)).filter((f) => f.endsWith('.json'));
  const rows = [];

  for (const file of files) {
    const raw = await readFile(path.join(dataDir, file), 'utf8');
    const parsed = JSON.parse(raw) as ExportFile;
    if (!Array.isArray(parsed.webtoons) || parsed.webtoons.length > 50_000) throw new Error('Invalid seed size');
    for (const item of parsed.webtoons) {
      assertCatalogItem(item);
      rows.push(jsonItemToRow(item));
    }
  }

  const { error } = await supabase.from('webtoons').upsert(rows, {
    onConflict: 'id',
  });

  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(`✅ Upserted ${rows.length} webtoons from ${files.length} files`);
})();
