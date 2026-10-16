import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const consoleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resolveProjectRoot(config) {
  if (config.projectRoot?.trim()) return path.resolve(config.projectRoot.trim());
  return path.resolve(consoleDir, '..', '..');
}

export function resolveCrawlerRunDir(config) {
  if (config.crawlerRunDir?.trim()) return path.resolve(config.crawlerRunDir.trim());
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'webtoon-crawler', 'KOREA_WEBTOON_API');
  }
  return path.join(os.homedir(), '.local', 'share', 'webtoon-crawler', 'KOREA_WEBTOON_API');
}

export function resolveSqlitePath(config, crawlerRunDir) {
  if (config.sqlitePath?.trim()) return path.resolve(config.sqlitePath.trim());
  return path.join(crawlerRunDir, 'database.sqlite');
}
