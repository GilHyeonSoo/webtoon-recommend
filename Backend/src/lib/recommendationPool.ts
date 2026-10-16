import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { WebtoonDto } from './mapWebtoon.js';
import type { RecommendationPreferences } from './preferences.js';
import type { SimilarRecommendation } from './similarity.js';

export class ServiceBusy extends Error {
  constructor(public status = 503) { super('추천 요청이 많아요. 잠시 후 다시 시도해주세요.'); }
}
type Task = {
  id: number; ids: string[]; limit: number; preferences?: RecommendationPreferences; excludeIds: string[];
  resolve: (result: SimilarRecommendation[]) => void; reject: (error: Error) => void;
  timer: NodeJS.Timeout; cleanup: () => void; cancelFlag: Int32Array;
};

// One CPU worker, bounded queue, no result cache keyed by attacker-controlled input.
export class RecommendationPool {
  private worker?: Worker;
  private initialized = false;
  private loading?: Promise<void>;
  private active?: Task;
  private queue: Task[] = [];
  private serial = 0;
  private stopped = false;
  private catalog?: WebtoonDto[];
  private recovery?: NodeJS.Timeout;
  private recoveryFailures = 0;
  constructor(private maxWaiting = 8, private deadlineMs = 5000, private workerSource?: URL) {}

  async prepare(items: WebtoonDto[]) {
    if (this.stopped) throw new ServiceBusy();
    if (this.initialized) return;
    if (this.loading) return this.loading;
    this.catalog = items;
    if (this.recovery) clearTimeout(this.recovery);
    this.loading = new Promise<void>((resolve, reject) => {
      const development = !this.workerSource && import.meta.url.endsWith('.ts');
      const source = this.workerSource ?? new URL(`./recommendationWorker.${development ? 'ts' : 'js'}`, import.meta.url);
      const options = { workerData: items, resourceLimits: { maxOldGenerationSizeMb: 256 } };
      const worker = development
        ? new Worker(`require(${JSON.stringify(createRequire(import.meta.url).resolve('tsx/cjs'))}); require(${JSON.stringify(fileURLToPath(source))});`, { ...options, eval: true })
        : new Worker(source, options);
      this.worker = worker;
      let settled = false;
      const startup = setTimeout(() => { fail(); }, 30_000);
      const fail = () => {
        if (this.worker !== worker) return;
        clearTimeout(startup);
        this.worker = undefined; this.initialized = false; this.loading = undefined;
        void worker.terminate();
        if (!settled) { settled = true; reject(new ServiceBusy()); }
        if (this.active) this.finish(this.active, new ServiceBusy());
        for (const task of this.queue.splice(0)) this.finish(task, new ServiceBusy());
        this.recover();
      };
      worker.on('error', fail);
      worker.on('exit', fail);
      worker.on('message', (message) => {
        if (this.worker !== worker) return;
        if (message.ready) {
          clearTimeout(startup); settled = true; this.initialized = true;
          worker.unref(); resolve(); this.dispatch(); return;
        }
        if (this.active?.id !== message.id) return;
        const task = this.active!; this.active = undefined;
        this.recoveryFailures = 0;
        this.finish(task, message.error ? new ServiceBusy() : undefined, message.result);
        this.dispatch();
      });
    });
    return this.loading;
  }

  run(items: WebtoonDto[], ids: string[], limit: number, preferences?: RecommendationPreferences, excludeIds: string[] = [], signal?: AbortSignal): Promise<SimilarRecommendation[]> {
    if (this.stopped || this.queue.length + (this.active ? 1 : 0) >= this.maxWaiting + 1) return Promise.reject(new ServiceBusy());
    if (signal?.aborted) return Promise.reject(new ServiceBusy());
    return new Promise((resolve, reject) => {
      const expire = () => {
        const index = this.queue.indexOf(task);
        if (index >= 0) this.queue.splice(index, 1);
        if (this.active === task) {
          const worker = this.worker; this.worker = undefined;
          this.initialized = false; this.loading = undefined; this.active = undefined;
          if (worker) void worker.terminate();
          for (const waiting of this.queue.splice(0)) this.finish(waiting, new ServiceBusy());
          this.recover();
        }
        this.finish(task, new ServiceBusy());
      };
      const cancel = () => {
        if (this.active === task) {
          // Cooperative cancellation retains the expensive index and avoids disconnect/restart DoS.
          Atomics.store(task.cancelFlag, 0, 1);
          task.reject(new ServiceBusy()); task.cleanup();
          // Keep the watchdog until the worker actually acknowledges completion.
        } else {
          const index = this.queue.indexOf(task);
          if (index >= 0) this.queue.splice(index, 1);
          this.finish(task, new ServiceBusy());
        }
      };
      const task: Task = { id: ++this.serial, ids, limit, preferences, excludeIds, resolve, reject,
        timer: setTimeout(expire, this.deadlineMs), cleanup: () => signal?.removeEventListener('abort', cancel),
        cancelFlag: new Int32Array(new SharedArrayBuffer(4)) };
      signal?.addEventListener('abort', cancel, { once: true });
      this.queue.push(task);
      void this.prepare(items).then(() => this.dispatch(), () => {
        const index = this.queue.indexOf(task);
        if (index >= 0) { this.queue.splice(index, 1); this.finish(task, new ServiceBusy()); }
      });
    });
  }
  private recover() {
    if (this.stopped || !this.catalog || this.recovery) return;
    this.recovery = setTimeout(() => {
      this.recovery = undefined;
      void this.prepare(this.catalog!).catch(() => {});
    }, Math.min(60_000, 1000 * 2 ** Math.min(this.recoveryFailures++, 6)));
    this.recovery.unref();
  }
  private finish(task: Task, error?: Error, result?: SimilarRecommendation[]) {
    clearTimeout(task.timer); task.cleanup();
    if (this.active === task) this.active = undefined;
    if (error) task.reject(error); else task.resolve(result!);
  }
  private dispatch() {
    if (!this.initialized || !this.worker || this.active) return;
    const task = this.queue.shift();
    if (!task) { this.worker.unref(); return; }
    this.active = task; this.worker.ref();
    this.worker.postMessage({ id: task.id, ids: task.ids, limit: task.limit, preferences: task.preferences, excludeIds: task.excludeIds, cancel: task.cancelFlag.buffer });
  }
  get ready() { return this.initialized; }
  get waiting() { return this.queue.length; }
  async close() {
    this.stopped = true;
    if (this.recovery) clearTimeout(this.recovery);
    if (this.active) this.finish(this.active, new ServiceBusy());
    for (const task of this.queue.splice(0)) this.finish(task, new ServiceBusy());
    const worker = this.worker;
    // Allow exit handler to settle an in-progress prepare promise.
    if (worker) await worker.terminate();
    this.worker = undefined; this.initialized = false;
  }
}
