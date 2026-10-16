const platformButtons = document.getElementById('platform-buttons');
const countsEl = document.getElementById('counts');
const dataInfoEl = document.getElementById('data-info');
const catalogLine = document.getElementById('catalog-line');
const crawlerPill = document.getElementById('crawler-pill');
const logEl = document.getElementById('log');
const jobHint = document.getElementById('job-hint');
const refreshBtn = document.getElementById('refresh-btn');
const integrateBtn = document.getElementById('integrate-btn');
const deployBtn = document.getElementById('deploy-btn');
const deployCopy = document.getElementById('deploy-copy');

let activeJobId = null;
let pollTimer = null;

function appendLog(line) {
  const stamp = new Date().toLocaleTimeString('ko-KR');
  logEl.textContent = `[${stamp}] ${line}\n` + logEl.textContent;
}

function renderCounts(counts) {
  const items = [
    ['네이버 (DB)', counts.NAVER],
    ['카카오 (DB)', counts.KAKAO],
    ['카카오페이지 (DB)', counts.KAKAO_PAGE],
  ];
  countsEl.innerHTML = items
    .map(
      ([label, value]) =>
        `<div><dt>${label}</dt><dd>${value == null ? '—' : value.toLocaleString('ko-KR')}</dd></div>`,
    )
    .join('');
}

function renderCatalog(catalog) {
  if (!catalog) {
    catalogLine.textContent = '앱 카탈로그 JSON: 아직 없거나 읽을 수 없음';
    return;
  }
  const parts = Object.entries(catalog.byProvider ?? {}).map(
    ([provider, count]) => `${provider} ${count.toLocaleString('ko-KR')}`,
  );
  catalogLine.textContent = `앱 카탈로그: Frontend ${catalog.total.toLocaleString('ko-KR')}편 (${parts.join(', ')}) · Backend ${catalog.backendCount?.toLocaleString('ko-KR') ?? '—'}편`;
}

function renderDataInfo(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    dataInfoEl.innerHTML = '<li>마지막 수집 기록 없음</li>';
    return;
  }
  dataInfoEl.innerHTML = rows
    .map((row) => {
      const end = row.updateEndAt ? new Date(row.updateEndAt).toLocaleString('ko-KR') : '—';
      const health = row.isHealthy ? '성공' : '실패/미완';
      return `<li>${row.provider}: ${end} (${health})</li>`;
    })
    .join('');
}

function setActionButtonsDisabled(disabled) {
  platformButtons.querySelectorAll('button.primary').forEach((btn) => {
    btn.disabled = disabled;
  });
  integrateBtn.disabled = disabled;
  deployBtn.disabled = disabled || deployBtn.dataset.configOff === '1';
}

function renderDeploy(deploy) {
  if (!deploy?.enabled) {
    deployBtn.disabled = true;
    deployBtn.dataset.configOff = '1';
    deployCopy.textContent = deploy?.hint ?? 'config.json deploy.enabled를 true로 설정하세요.';
    return;
  }
  deployBtn.dataset.configOff = '0';
  const parts = [];
  if (deploy.git) parts.push(`Git → ${deploy.branch}`);
  if (deploy.railway) parts.push('Railway');
  if (deploy.vercel) parts.push('Vercel');
  deployCopy.textContent = parts.length
    ? `순서: ${parts.join(' · ')} (2단계 통합 후 실행 권장)`
    : 'deploy.git / railway / vercel 중 하나를 활성화하세요.';
}

function renderPlatforms(platforms) {
  platformButtons.innerHTML = '';
  for (const platform of platforms) {
    const btn = document.createElement('button');
    if (platform.enabled) {
      btn.type = 'button';
      btn.className = 'primary';
      btn.textContent = platform.label;
      btn.addEventListener('click', () => startCrawl(platform.key, platform.label));
    } else {
      btn.type = 'button';
      btn.className = 'soon';
      btn.disabled = true;
      btn.textContent = platform.comingSoon ? `${platform.label} (향후)` : platform.label;
    }
    platformButtons.appendChild(btn);
  }
}

async function loadStatus() {
  const response = await fetch('/api/status');
  const data = await response.json();
  crawlerPill.textContent = data.crawlerOnline ? '크롤러 연결됨' : '크롤러 오프라인';
  crawlerPill.className = `pill ${data.crawlerOnline ? 'pill-on' : 'pill-off'}`;
  renderCounts(data.counts ?? {});
  renderDataInfo(data.dataInfo ?? []);
  renderCatalog(data.catalog);
  renderPlatforms(data.platforms ?? []);
  renderDeploy(data.deploy);
  if (data.busy) {
    jobHint.textContent = '작업 진행 중…';
    setActionButtonsDisabled(true);
  } else if (!data.crawlerOnline) {
    jobHint.textContent =
      '크롤은 start-crawler.ps1 필요. 통합은 크롤러 없이도 SQLite 파일만 있으면 실행 가능합니다.';
    setActionButtonsDisabled(false);
  } else {
    jobHint.textContent = '크롤 후 통합 버튼으로 JSON·Backend 카탈로그를 갱신하세요.';
    setActionButtonsDisabled(false);
  }
}

async function startCrawl(platform, label) {
  setActionButtonsDisabled(true);
  appendLog(`${label} 크롤 요청…`);
  const response = await fetch('/api/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform }),
  });
  const data = await response.json();
  if (!response.ok) {
    appendLog(`오류: ${data.message ?? '시작 실패'}`);
    setActionButtonsDisabled(false);
    return;
  }
  activeJobId = data.job.id;
  appendLog(`${label} 작업 ID ${activeJobId}`);
  pollJob();
}

async function startDeploy() {
  setActionButtonsDisabled(true);
  appendLog('배포 작업 시작…');
  const response = await fetch('/api/deploy', { method: 'POST' });
  const data = await response.json();
  if (!response.ok) {
    appendLog(`오류: ${data.message ?? '배포 시작 실패'}`);
    setActionButtonsDisabled(false);
    renderDeploy((await (await fetch('/api/status')).json()).deploy);
    return;
  }
  activeJobId = data.job.id;
  appendLog(`배포 작업 ID ${activeJobId}`);
  pollJob();
}

async function startIntegrate() {
  setActionButtonsDisabled(true);
  appendLog('통합 작업 시작…');
  const response = await fetch('/api/integrate', { method: 'POST' });
  const data = await response.json();
  if (!response.ok) {
    appendLog(`오류: ${data.message ?? '통합 시작 실패'}`);
    setActionButtonsDisabled(false);
    return;
  }
  activeJobId = data.job.id;
  appendLog(`통합 작업 ID ${activeJobId}`);
  pollJob();
}

async function pollJob() {
  if (!activeJobId) return;
  const response = await fetch(`/api/jobs/${encodeURIComponent(activeJobId)}`);
  const data = await response.json();
  const job = data.job;
  if (!job) return;
  jobHint.textContent = job.message;
  if (Array.isArray(job.log) && job.log.length) {
    logEl.textContent = job.log.slice(0, 12).join('\n') + '\n' + logEl.textContent.split('\n').slice(0, 8).join('\n');
  }
  if (job.state === 'succeeded') {
    appendLog(job.message);
    activeJobId = null;
    setActionButtonsDisabled(false);
    await loadStatus();
    return;
  }
  if (job.state === 'failed') {
    appendLog(job.message);
    activeJobId = null;
    setActionButtonsDisabled(false);
    return;
  }
  pollTimer = setTimeout(pollJob, 2500);
}

integrateBtn.addEventListener('click', () => {
  void startIntegrate();
});

deployBtn.addEventListener('click', () => {
  void startDeploy();
});

refreshBtn.addEventListener('click', () => {
  void loadStatus();
});

loadStatus().catch((error) => {
  appendLog(error instanceof Error ? error.message : '상태 로드 실패');
});

window.addEventListener('beforeunload', () => {
  if (pollTimer) clearTimeout(pollTimer);
});
