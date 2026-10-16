import { checkJob } from '@/security/context';
export async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed) {
      const index = cursor++;
      if (index >= items.length) break;
      try { checkJob(); output[index] = await fn(items[index]); }
      catch (error) { failed = true; failure = error; }
    }
  }));
  // Await every active slot before releasing the job's exclusive lease.
  if (failed) throw failure;
  return output;
}
