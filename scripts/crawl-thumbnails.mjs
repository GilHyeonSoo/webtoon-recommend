#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiDir = new URL('../KOREA_WEBTOON_API/', import.meta.url);
const require = createRequire(new URL('package.json', apiDir));
let registration;
try { registration = require.resolve('ts-node/register'); }
catch {
  console.error('크롤러 의존성을 먼저 설치하세요: npm --prefix KOREA_WEBTOON_API ci');
  process.exit(1);
}
const child = spawn(process.execPath, [
  '-r', registration,
  fileURLToPath(new URL('src/scripts/crawl-thumbnails.ts', apiDir)),
  ...process.argv.slice(2),
], {
  stdio: 'inherit',
  env: { ...process.env, TS_NODE_PROJECT: fileURLToPath(new URL('tsconfig.json', apiDir)) },
});
// The terminal signals both processes. Forward signals sent only to this wrapper as well.
const interrupt = () => child.kill('SIGINT');
const terminate = () => child.kill('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', terminate);
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
