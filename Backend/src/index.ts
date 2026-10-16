import 'dotenv/config';
import { createApp } from './app.js';
import { createLocalCatalogRepository } from './lib/localCatalog.js';

const repository = await createLocalCatalogRepository();
const app = createApp(repository);
await app.locals.prepare();
const server = app.listen(Number(process.env.PORT ?? 3001), () => console.log('webtoon-api ready (indexed JSON catalog)'));
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  await app.locals.close();
  server.closeAllConnections();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
