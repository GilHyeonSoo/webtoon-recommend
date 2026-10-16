import { open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { jobContext } from './context';
export class JobBusy extends Error {}
export type Job = { id: string; kind: string; state: 'running' | 'succeeded' | 'failed'; startedAt: string; endedAt?: string; result?: unknown; error?: string };
const jobs = new Map<string, Job>();
let active = false;
export function getJob(id: string) { return jobs.get(id); }
// A non-expiring exclusive file lease also protects CLI and a second process on the same volume.
// A crash leaves the lock in place; an operator must verify no job is running before removing it.
const defaultJobTimeoutMs = () => {
  const fromEnv = Number(process.env.CRAWLER_JOB_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 60_000 ? fromEnv : 15 * 60_000;
};
export async function runExclusive<T>(run: () => Promise<T>, timeoutMs = defaultJobTimeoutMs()): Promise<T> {
  if (active) throw new JobBusy('A crawler job is already running');
  active = true;
  const lock = resolve(process.env.SQLITE_PATH ?? 'database.sqlite') + '.job.lock';
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    try { handle = await open(lock, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new JobBusy('Crawler volume is locked'); throw error; }
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    timer = setTimeout(() => controller.abort(new Error('Crawler job deadline exceeded')), timeoutMs);
    return await jobContext.run(controller.signal, async () => { const result = await run(); controller.signal.throwIfAborted(); return result; });
  } finally {
    if (timer) clearTimeout(timer);
    // Do not unlock on a timer while work can still write. Await actual task settlement.
    try { if (handle) { try { await handle.close(); } finally { await unlink(lock); } } }
    finally { active = false; }
  }
}
export async function submitJob(kind: string, run: () => Promise<unknown>): Promise<Job> {
  if (active) throw new JobBusy('A crawler job is already running');
  const job: Job = { id: randomUUID(), kind, state: 'running', startedAt: new Date().toISOString() };
  // Start and acquire the lease before acknowledging the request.
  let accepted!: () => void;
  let declined!: (error: unknown) => void;
  const admission = new Promise<void>((resolve, reject) => { accepted = resolve; declined = reject; });
  const task = runExclusive(async () => { accepted(); return run(); });
  void task.then((result) => { job.state = 'succeeded'; job.result = result; }, (error) => {
    job.state = 'failed'; job.error = error instanceof JobBusy ? 'Crawler is busy' : 'Crawler task failed';
    declined(error);
    console.error('Crawler job failed', job.id, job.kind);
  }).finally(() => { job.endedAt = new Date().toISOString(); });
  await admission;
  if (jobs.size >= 100) jobs.delete(jobs.keys().next().value!);
  jobs.set(job.id, job);
  return job;
}
