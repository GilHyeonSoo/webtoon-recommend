import type { Response, Request } from 'express';
import { DataInfo } from '@/database/entity';
import { AppDataSource } from '@/database/datasource';
export const getHealthCheck = async (_req: Request, res: Response) => {
  try { return res.json(await AppDataSource.getRepository(DataInfo).find()); }
  catch { return res.status(503).json({ message: 'Status unavailable' }); }
};
