#!/usr/bin/env node
import { access, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data/webtoons');
const out = path.join(root, 'Frontend/src/data/webtoons.json');

const defaultFiles = [
  'webtoons-naver.json',
  'webtoons-kakao.json',
  'webtoons-kakao-page.json',
];
const files = process.env.MERGE_WEBTOON_FILES
  ? process.env.MERGE_WEBTOON_FILES.split(',').map((f) => f.trim())
  : defaultFiles;

const webtoons = [];

for (const file of files) {
  const filePath = path.join(dataDir, file);
  try {
    await access(filePath);
  } catch {
    console.warn(`skip (missing): ${file}`);
    continue;
  }
  const raw = JSON.parse(await readFile(filePath, 'utf8'));
  webtoons.push(...raw.webtoons);
}

await writeFile(out, JSON.stringify(webtoons, null, 2) + '\n');
console.log(`Wrote ${webtoons.length} webtoons → ${out}`);
