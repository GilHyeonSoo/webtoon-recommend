import { AppDataSource } from './database/datasource';
import { migrateExtendedFields, recreateNormalizedWebtoonView } from './database/migrateExtendedFields';
import { createCrawlerApp } from './app';
import { runExclusive } from './security/jobs';

async function main() {
  const app = createCrawlerApp();
  await runExclusive(async () => {
    await AppDataSource.initialize();
    await migrateExtendedFields();
    await recreateNormalizedWebtoonView();
  });
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = app.listen(port, process.env.BIND_HOST ?? '127.0.0.1', () => console.log('Crawler ready (stored metadata only)'));
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
}
void main().catch(() => { console.error('Crawler startup failed'); process.exitCode = 1; });
