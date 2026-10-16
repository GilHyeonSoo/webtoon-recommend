import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { assertCatalogItem } from '../src/lib/catalogValidation.ts';
const source = new URL('../../Frontend/src/data/webtoons.json', import.meta.url);
const destination = new URL('../data/webtoons.json', import.meta.url);
const contents = await readFile(source, 'utf8');
const items = JSON.parse(contents);
if (!Array.isArray(items) || !items.length || items.length > 50_000) throw new Error('Invalid catalog size');
const ids = new Set();
for (const item of items) {
  assertCatalogItem(item);
  if (ids.has(item.id)) throw new Error('Duplicate catalog ID');
  ids.add(item.id);
}
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const temporary = new URL(`../data/catalog-${randomUUID()}.tmp`, import.meta.url);
try {
  await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, destination);
} finally { await unlink(temporary).catch(() => {}); }
console.log(`Validated and copied ${items.length} webtoons`);
