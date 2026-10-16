import { AppDataSource } from '@/database/datasource';
import { DataInfo, type NormalizedWebtoon, Provider, NaverWebtoon, KakaoWebtoon, KakaoPageWebtoon } from '@/database/entity';
import type { Response, Request } from 'express';
import { authorizeAdmin } from '@/security/admin';
import { allowedQuery, boolean, BadInput } from '@/security/input';
import { submitJob, JobBusy } from '@/security/jobs';
import { checkJob } from '@/security/context';
import { assertCatalogItem } from '@/modules/common/catalogValidation';

interface CreateUpdateMethodProps {
  provider: Exclude<Provider, 'RIDI'>;
  webtoonCrawler: () => Promise<NormalizedWebtoon[]>;
}
export const createUpdateMethod = ({ provider, webtoonCrawler }: CreateUpdateMethodProps) =>
  async (req: Request, res: Response) => {
    if (!authorizeAdmin(req, res)) return undefined;
    try {
      allowedQuery(req.query, ['force']);
      const force = boolean(req.query.force) ?? false;
      const job = await submitJob(`update:${provider}`, async () => {
        const metadata = AppDataSource.getRepository(DataInfo);
        const previous = await metadata.findOneBy({ provider });
        if (!force && previous?.updateStartAt && Date.now() - new Date(previous.updateStartAt).getTime() < 21_600_000) {
          return { skipped: true, provider };
        }
        const start = { provider, updateStartAt: new Date(), updateEndAt: null, isHealthy: false };
        await metadata.save(start);
        let connection: ReturnType<typeof AppDataSource.createQueryRunner> | undefined;
        try {
          // Network collection never holds a SQLite transaction open.
          const items = await webtoonCrawler();
          checkJob();
          if (!Array.isArray(items) || !items.length || items.length > 50_000) throw new Error('Invalid crawler result size');
          const ids = new Set<string>();
          for (const item of items) {
            assertCatalogItem(item);
            if (item.provider !== provider || ids.has(item.id)) throw new Error('Invalid crawler result identity');
            ids.add(item.id);
          }
          const Entity = { NAVER: NaverWebtoon, KAKAO: KakaoWebtoon, KAKAO_PAGE: KakaoPageWebtoon }[provider];
          connection = AppDataSource.createQueryRunner();
          await connection.connect();
          await connection.startTransaction();
          for (let i = 0; i < items.length; i += 100) { checkJob(); await connection.manager.save(Entity, items.slice(i, i + 100)); }
          checkJob();
          await connection.manager.save(DataInfo, { ...start, isHealthy: true, updateEndAt: new Date() });
          await connection.commitTransaction();
          return { provider, updated: items.length };
        } catch (error) {
          if (connection?.isTransactionActive) {
            try { await connection.rollbackTransaction(); }
            catch {
              // Never reuse a connection whose transaction could not be rolled back.
              await AppDataSource.destroy().catch(() => {});
              throw new Error('Database recovery requires restart');
            }
          }
          await metadata.save({ ...start, isHealthy: false, updateEndAt: new Date() });
          throw error;
        } finally { if (connection) await connection.release(); }
      });
      return res.status(202).json({ job });
    } catch (error) {
      return res.status(error instanceof BadInput ? 400 : error instanceof JobBusy ? 409 : 500).json({ message: error instanceof BadInput ? 'Invalid query' : error instanceof JobBusy ? 'Crawler is busy' : 'Unable to start crawler job' });
    }
  };
