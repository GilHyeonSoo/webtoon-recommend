import type { RequestHandler } from 'express';

// Token buckets expire and have a hard cardinality bound. Full storage fails closed.
export function rateLimit(capacity: number, perMinute: number, maxKeys = 10_000): RequestHandler {
  const buckets = new Map<string, { tokens: number; updated: number }>();
  let swept = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now - swept > 60_000) {
      for (const [key, value] of buckets) if (now - value.updated > 120_000) buckets.delete(key);
      swept = now;
    }
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= maxKeys) { res.setHeader('Retry-After', '60'); res.status(429).json({ message: '요청이 많아요. 잠시 후 다시 시도해주세요.' }); return; }
      bucket = { tokens: capacity, updated: now }; buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.updated) * perMinute / 60_000);
    bucket.updated = now;
    if (bucket.tokens < 1) { res.setHeader('Retry-After', String(Math.ceil((1 - bucket.tokens) * 60 / perMinute))); res.status(429).json({ message: '요청이 많아요. 잠시 후 다시 시도해주세요.' }); return; }
    bucket.tokens--; next();
  };
}

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
};
