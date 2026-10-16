// For a scheduler on the private network. Never call health-check to trigger collection.
const base = new URL(process.env.CRAWLER_BASE_URL ?? 'http://127.0.0.1:3000');
const secret = process.env.CRAWLER_ADMIN_SECRET;
if (!secret || secret.length < 32 || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Invalid crawler configuration');
const privateHttp = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.hostname.endsWith('.railway.internal');
if (base.protocol !== 'https:' && !(base.protocol === 'http:' && privateHttp)) throw new Error('Use HTTPS or a private crawler service');
async function request(path, method = 'GET') {
  const response = await fetch(new URL(path, base), {
    method, headers: { 'x-crawler-secret': secret }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Crawler returned ${response.status}`);
  return response.json();
}
for (const platform of ['naver', 'kakao', 'kakao-page']) {
  const { job } = await request(`/update/${platform}`, 'PUT');
  if (!job || typeof job.id !== 'string') throw new Error('Invalid job response');
  const deadline = Date.now() + 20 * 60_000;
  while (true) {
    const { job: status } = await request(`/internal/jobs/${encodeURIComponent(job.id)}`);
    if (status?.state === 'succeeded') { console.log(`Completed ${platform}`); break; }
    if (status?.state === 'failed') throw new Error(`Crawler job failed: ${platform}`);
    if (status?.state !== 'running' || Date.now() >= deadline) throw new Error(`Crawler job unavailable or timed out: ${platform}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
