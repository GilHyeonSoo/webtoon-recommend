import { access, cp, rm, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn as spawnProcess } from 'node:child_process';
import { appendLog, runCommand } from './commands.mjs';
import { readCatalogSummary } from './integrate.mjs';
import { resolveProjectRoot } from './paths.mjs';

const ROBOCOPY_OK = [0, 1, 2, 3, 4, 5, 6, 7];

export function buildDeployConfig(raw) {
  const deploy = raw.deploy ?? {};
  if (deploy.enabled !== true) {
    return { enabled: false };
  }
  const git = deploy.git ?? {};
  const railway = deploy.railway ?? {};
  const vercel = deploy.vercel ?? {};
  const branch = typeof git.branch === 'string' && git.branch.trim() ? git.branch.trim() : 'main';
  const paths = Array.isArray(git.paths) && git.paths.length
    ? git.paths
    : [
        'data/webtoons/',
        'Frontend/src/data/webtoons.json',
        'Backend/data/webtoons.json',
      ];
  const messageTemplate =
    typeof git.commitMessageTemplate === 'string' && git.commitMessageTemplate.trim()
      ? git.commitMessageTemplate.trim()
      : 'chore(catalog): update webtoons ({{total}} titles, {{date}})';
  return {
    enabled: true,
    git: {
      enabled: git.enabled !== false,
      branch,
      paths,
      messageTemplate,
      remote: typeof git.remote === 'string' && git.remote.trim() ? git.remote.trim() : 'origin',
      allowEmpty: git.allowEmpty === true,
    },
    railway: {
      enabled: railway.enabled === true,
      serviceDir: railway.serviceDir?.trim() || 'Backend',
      useTempCopyOnWindows: railway.useTempCopyOnWindows !== false,
      cli: railway.cli?.trim() || 'railway',
    },
    vercel: {
      enabled: vercel.enabled === true,
      serviceDir: vercel.serviceDir?.trim() || 'Frontend',
      cli: vercel.cli?.trim() || 'npx',
      prod: vercel.prod !== false,
    },
    timeoutMs: Number(deploy.timeoutMinutes ?? 30) * 60_000,
  };
}

export function deployStatusFromConfig(raw) {
  const deploy = buildDeployConfig(raw);
  if (!deploy.enabled) {
    return { enabled: false, hint: 'config.json에서 deploy.enabled를 true로 설정하세요.' };
  }
  return {
    enabled: true,
    git: deploy.git.enabled,
    branch: deploy.git.branch,
    railway: deploy.railway.enabled,
    vercel: deploy.vercel.enabled,
  };
}

function formatCommitMessage(template, summary) {
  return template
    .replace(/\{\{total\}\}/g, String(summary?.total ?? '?'))
    .replace(/\{\{date\}\}/g, new Date().toISOString().slice(0, 10));
}

async function assertGitRepo(projectRoot) {
  await runCommand(null, projectRoot, 'git', ['rev-parse', '--is-inside-work-tree'], {}, {
    shell: process.platform === 'win32',
  });
}

async function gitPorcelainEsm(projectRoot, paths) {
  const args = ['status', '--porcelain', '--', ...paths];
  return new Promise((resolve, reject) => {
    const child = spawnProcess('git', args, { cwd: projectRoot, shell: process.platform === 'win32' });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`git status 실패 (${code})`));
    });
  });
}

async function runGit(job, projectRoot, args) {
  return runCommand(job, projectRoot, 'git', args, {}, { shell: process.platform === 'win32' });
}

async function copyBackendForDeploy(job, projectRoot, src, dest) {
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.dirname(dest), { recursive: true });
  if (process.platform === 'win32') {
    appendLog(job, `Windows: Backend 임시 복사 (${dest})`);
    await runCommand(
      job,
      projectRoot,
      'robocopy',
      [src, dest, '/E', '/XD', 'node_modules', 'dist', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np'],
      {},
      { shell: true, acceptCodes: ROBOCOPY_OK },
    );
  } else {
    appendLog(job, `Backend 임시 복사 (${dest})`);
    await cp(src, dest, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`)
        && !source.includes(`${path.sep}dist${path.sep}`),
    });
  }
}

async function deployGit(job, projectRoot, deploy, summary) {
  const { git } = deploy;
  if (!git.enabled) return { pushed: false, skipped: true };

  await assertGitRepo(projectRoot);
  const dirty = await gitPorcelainEsm(projectRoot, git.paths);
  if (!dirty && !git.allowEmpty) {
    throw new Error('커밋할 카탈로그 변경이 없습니다. 먼저 통합(2단계)을 실행하세요.');
  }

  appendLog(job, `Git add (${git.paths.length} 경로)…`);
  await runGit(job, projectRoot, ['add', '--', ...git.paths]);

  const message = formatCommitMessage(git.messageTemplate, summary);
  appendLog(job, `Git commit: ${message}`);
  try {
    await runGit(job, projectRoot, ['commit', '-m', message]);
  } catch (error) {
    if (git.allowEmpty && String(error).includes('종료 코드 1')) {
      appendLog(job, '커밋할 변경 없음 — push 단계만 건너뜁니다.');
      return { pushed: false, skipped: true };
    }
    throw error;
  }

  appendLog(job, `Git push ${git.remote} ${git.branch}…`);
  await runGit(job, projectRoot, ['push', git.remote, git.branch]);
  return { pushed: true, skipped: false };
}

async function deployRailway(job, projectRoot, deploy) {
  const { railway } = deploy;
  if (!railway.enabled) return;

  const backendDir = path.join(projectRoot, railway.serviceDir);
  await access(backendDir, constants.R_OK);

  let cwd = backendDir;
  let tempDir = null;
  if (railway.useTempCopyOnWindows && process.platform === 'win32') {
    tempDir = path.join(os.tmpdir(), `webtoon-backend-deploy-${Date.now()}`);
    await copyBackendForDeploy(job, projectRoot, backendDir, tempDir);
    cwd = tempDir;
  }

  appendLog(job, 'Railway 배포 (railway up)…');
  await runCommand(
    job,
    cwd,
    railway.cli,
    ['up', '--detach'],
    {},
    { shell: true },
  );

  if (tempDir) {
    appendLog(job, '임시 배포 폴더 정리…');
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function deployVercel(job, projectRoot, deploy) {
  const { vercel } = deploy;
  if (!vercel.enabled) return;

  const frontendDir = path.join(projectRoot, vercel.serviceDir);
  await access(frontendDir, constants.R_OK);

  appendLog(job, 'Vercel 프로덕션 배포…');
  const args = vercel.cli === 'npx'
    ? ['vercel', ...(vercel.prod ? ['--prod'] : []), '--yes']
    : [...(vercel.prod ? ['--prod'] : []), '--yes'];

  await runCommand(
    job,
    frontendDir,
    vercel.cli,
    args,
    {},
    { shell: true },
  );
}

export async function runDeployPipeline(config, jobs, jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  const deploy = buildDeployConfig(config);
  if (!deploy.enabled) throw new Error('deploy.enabled가 false입니다.');

  const projectRoot = resolveProjectRoot(config);
  const summary = await readCatalogSummary(projectRoot);

  let step = 0;
  const steps = [];
  if (deploy.git.enabled) steps.push('git');
  if (deploy.railway.enabled) steps.push('railway');
  if (deploy.vercel.enabled) steps.push('vercel');
  if (!steps.length) throw new Error('git / railway / vercel 중 하나 이상을 활성화하세요.');

  const runStep = (name) => {
    step += 1;
    appendLog(job, `[${step}/${steps.length}] ${name}…`);
  };

  if (deploy.git.enabled) {
    runStep('Git commit & push');
    job.gitResult = await deployGit(job, projectRoot, deploy, summary);
  }

  if (deploy.railway.enabled) {
    runStep('Railway');
    await deployRailway(job, projectRoot, deploy);
  }

  if (deploy.vercel.enabled) {
    runStep('Vercel');
    await deployVercel(job, projectRoot, deploy);
  }

  job.state = 'succeeded';
  job.message = '배포 파이프라인이 완료되었습니다.';
  job.finishedAt = new Date().toISOString();
  job.updatedAt = job.finishedAt;
  job.summary = summary;
}

export function startDeployJob(config, jobs) {
  const running = [...jobs.values()].some((j) => j.state === 'running');
  if (running) throw new Error('다른 작업이 진행 중입니다. 완료 후 다시 시도하세요.');

  const deploy = buildDeployConfig(config);
  if (!deploy.enabled) throw new Error('배포가 비활성화되어 있습니다. config.json deploy.enabled를 true로 설정하세요.');

  const jobId = randomUUID();
  const job = {
    id: jobId,
    kind: 'deploy',
    platform: 'deploy',
    label: '배포',
    state: 'running',
    message: '배포 작업을 준비 중…',
    log: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    summary: null,
    gitResult: null,
  };
  jobs.set(jobId, job);

  void runDeployPipeline(config, jobs, jobId).catch((error) => {
    job.state = 'failed';
    job.message = error instanceof Error ? error.message : '배포 실패';
    job.finishedAt = new Date().toISOString();
    job.updatedAt = job.finishedAt;
    appendLog(job, job.message);
  });

  return job;
}
