import { setTimeout as sleep } from 'node:timers/promises';
import type { ThumbnailProvider } from './source';

const imageHosts = new Set([
  'image-comic.pstatic.net',
  'kr-a.kakaopagecdn.com',
  'kr-a.kakaocdn.net',
  'page-images.kakaoentcdn.com',
]);
const referers: Record<ThumbnailProvider, string> = {
  NAVER: 'https://comic.naver.com/',
  KAKAO: 'https://webtoon.kakao.com/',
  KAKAO_PAGE: 'https://page.kakao.com/',
};

export function validateImageUrl(value: string): URL {
  const url = new URL(value);
  if (value.length > 4096 || url.protocol !== 'https:' || url.username || url.password
    || url.port || !imageHosts.has(url.hostname)) {
    throw new Error('Unsupported image URL (only project image CDN HTTPS hosts are allowed)');
  }
  return url;
}

// File extension comes from the bytes, including CDN URLs without any extension.
export function imageExtension(bytes: Buffer): string {
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))) return 'png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) return 'jpg';
  if (bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
    && bytes[bytes.length - 1] === 0x3b) return 'gif';
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) return 'webp';
  if (bytes.length >= 24 && bytes.toString('ascii', 4, 8) === 'ftyp'
    && /avif|avis/.test(bytes.toString('ascii', 8, Math.min(bytes.length, 32)))) return 'avif';
  throw new Error('Response is not a supported image (JPEG, PNG, WebP, GIF, AVIF)');
}

class DownloadError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly retryAfterMs = 0) { super(message); }
}

export type DownloadOptions = {
  timeoutMs: number;
  retries: number;
  maxBytes: number;
  signal: AbortSignal;
  beforeRequest: () => Promise<void>;
  fetcher?: typeof fetch;
};

function retryAfterMs(header: string | null): number {
  if (!header) return 0;
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(delay) ? Math.min(60_000, Math.max(0, delay)) : 0;
}

export async function downloadImage(url: string, provider: ThumbnailProvider, options: DownloadOptions) {
  validateImageUrl(url);
  let attempts = 0;
  for (;;) {
    options.signal.throwIfAborted();
    attempts++;
    try {
      let current = url;
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
      for (let redirects = 0; ; redirects++) {
        validateImageUrl(current); // Validate every redirect before making another request.
        await options.beforeRequest();
        signal.throwIfAborted();
        const response = await (options.fetcher ?? fetch)(current, {
          redirect: 'manual',
          signal,
          headers: {
            'user-agent': 'WebtoonThumbnailCrawler/1.0',
            accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1',
            referer: referers[provider],
          },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location || redirects >= 3) throw new DownloadError('Invalid or excessive image redirects', false);
          current = new URL(location, current).href;
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new DownloadError(`HTTP ${response.status}`, [408, 425, 429].includes(response.status)
            || response.status >= 500, retryAfterMs(response.headers.get('retry-after')));
        }
        const length = Number(response.headers.get('content-length'));
        if (length > options.maxBytes) {
          await response.body?.cancel();
          throw new DownloadError('Image exceeds maximum file size', false);
        }
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
          await response.body?.cancel();
          throw new DownloadError(`Unexpected content type: ${contentType}`, false);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new DownloadError('Empty image response', true);
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > options.maxBytes) throw new DownloadError('Image exceeds maximum file size', false);
            chunks.push(Buffer.from(value));
          }
        } finally { await reader.cancel().catch(() => {}); }
        if (length > 0 && !response.headers.get('content-encoding') && length !== size) {
          throw new DownloadError('Incomplete image response', true);
        }
        const bytes = Buffer.concat(chunks, size);
        const extension = imageExtension(bytes);
        return { bytes, extension, attempts };
      }
    } catch (error) {
      options.signal.throwIfAborted();
      if (attempts > options.retries || (error instanceof DownloadError && !error.retryable)) throw error;
      const delay = Math.max(1000 * 2 ** (attempts - 1), error instanceof DownloadError ? error.retryAfterMs : 0);
      await sleep(delay, undefined, { signal: options.signal });
    }
  }
}

export function createRequestGate(delayMs: number, signal: AbortSignal): () => Promise<void> {
  let queue = Promise.resolve();
  let nextStart = 0;
  return () => {
    const request = queue.then(async () => {
      signal.throwIfAborted();
      const wait = Math.max(0, nextStart - Date.now());
      if (wait) await sleep(wait, undefined, { signal });
      signal.throwIfAborted();
      nextStart = Date.now() + delayMs;
    });
    queue = request.catch(() => {});
    return request;
  };
}
