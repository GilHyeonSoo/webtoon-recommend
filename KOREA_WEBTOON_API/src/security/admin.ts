import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
export function validateAdminConfig() {
  if (process.env.ENABLE_ADMIN_HTTP === 'true' && (!process.env.CRAWLER_ADMIN_SECRET || process.env.CRAWLER_ADMIN_SECRET.length < 32)) {
    throw new Error('CRAWLER_ADMIN_SECRET (32+ characters) required when admin HTTP is enabled');
  }
}
export function authorizeAdmin(req: Request, res: Response): boolean {
  if (process.env.ENABLE_ADMIN_HTTP !== 'true') { res.sendStatus(404); return false; }
  const key = process.env.CRAWLER_ADMIN_SECRET;
  const provided = req.header('x-crawler-secret');
  if (!key || key.length < 32 || typeof provided !== 'string' || provided.length > 512
    || Buffer.byteLength(key) !== Buffer.byteLength(provided) || !timingSafeEqual(Buffer.from(key), Buffer.from(provided))) {
    res.sendStatus(401); return false;
  }
  return true;
}
export function adminOnly(req: Request, res: Response, next: NextFunction) { if (authorizeAdmin(req, res)) next(); }
