import type { Request, Response } from 'express';
import { NormalizedWebtoon } from '@/database/entity';
import { AppDataSource } from '@/database/datasource';
import { allowedQuery, BadInput } from '@/security/input';

/** Stored metadata only; collection and persistence are administrative jobs. */
export const getWebtoonById = async (req: Request, res: Response) => {
  try {
    allowedQuery(req.query, []);
    if (typeof req.params.id !== 'string' || req.params.id.length > 200) throw new BadInput('Invalid ID');
    const webtoon = await AppDataSource.getRepository(NormalizedWebtoon).findOne({ where: { id: req.params.id } });
    if (!webtoon) return res.status(404).json({ message: 'Webtoon not found' });
    return res.json({ webtoon });
  } catch (error) { return res.status(error instanceof BadInput ? 400 : 500).json({ message: error instanceof BadInput ? 'Unsupported query' : 'Internal server error' }); }
};
