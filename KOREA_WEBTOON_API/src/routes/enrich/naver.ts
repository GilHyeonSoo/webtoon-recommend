import type { Request, Response } from 'express';
import { enrichNaverMetadataBatch } from '@/modules/naver/enrichNaverMetadataBatch';
import { authorizeAdmin } from '@/security/admin';
import { allowedQuery, integer, BadInput } from '@/security/input';
import { submitJob, JobBusy } from '@/security/jobs';

export const putEnrichNaver = async (req: Request, res: Response) => {
  if (!authorizeAdmin(req, res)) return undefined;
  try {
    allowedQuery(req.query, ['limit', 'delayMs']);
    const limit = integer(req.query.limit, 50, 1, 500);
    const delayMs = integer(req.query.delayMs, 200, 200, 5000);
    const job = await submitJob('enrich:naver', () => enrichNaverMetadataBatch({ limit, delayMs }));
    return res.status(202).json({ job });
  } catch (error) {
    return res.status(error instanceof BadInput ? 400 : error instanceof JobBusy ? 409 : 500).json({ message: error instanceof BadInput ? 'Invalid query' : error instanceof JobBusy ? 'Crawler is busy' : 'Unable to start enrichment' });
  }
};
