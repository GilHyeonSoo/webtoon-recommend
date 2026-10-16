import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
export const jobContext = new AsyncLocalStorage<AbortSignal>();
export function checkJob() { jobContext.getStore()?.throwIfAborted(); }
export async function jobSleep(ms: number) {
  checkJob();
  await sleep(ms, undefined, { signal: jobContext.getStore() });
}
export function outboundSafety(client: { interceptors: { request: { use: (fn: (config: any) => any) => unknown } } }) {
  client.interceptors.request.use((config) => {
    checkJob();
    config.signal = jobContext.getStore() ?? config.signal;
    config.maxContentLength = 10 * 1024 * 1024;
    config.maxBodyLength = 1024 * 1024;
    config.maxRedirects = 0;
    return config;
  });
}
