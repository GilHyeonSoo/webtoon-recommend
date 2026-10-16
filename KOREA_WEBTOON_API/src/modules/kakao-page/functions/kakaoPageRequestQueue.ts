import { checkJob, jobSleep } from '@/security/context';
const configured = Number(process.env.KAKAO_PAGE_MIN_GAP_MS ?? 800);
if (!Number.isSafeInteger(configured) || configured < 800 || configured > 60_000) throw new Error('Invalid KAKAO_PAGE_MIN_GAP_MS');
let lastRequestAt = 0;
let pending = 0;
let chain: Promise<unknown> = Promise.resolve();
export const runKakaoPageRequest = <T>(fn: () => Promise<T>): Promise<T> => {
  checkJob();
  if (pending >= 128) return Promise.reject(new Error('Kakao Page queue is full'));
  pending++;
  const queued = Date.now();
  const run = async () => {
    checkJob();
    if (Date.now() - queued > 60_000) throw new Error('Kakao Page queue deadline exceeded');
    const wait = Math.max(0, lastRequestAt + configured - Date.now());
    if (wait) await jobSleep(wait);
    checkJob(); lastRequestAt = Date.now();
    return fn();
  };
  const result = chain.then(run).finally(() => { pending--; });
  chain = result.then(() => undefined, () => undefined);
  return result;
};
