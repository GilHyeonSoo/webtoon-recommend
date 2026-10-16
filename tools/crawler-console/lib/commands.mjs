import { spawn } from 'node:child_process';

export function appendLog(job, line) {
  if (!job) return;
  const trimmed = line.trim();
  if (!trimmed) return;
  if (!Array.isArray(job.log)) job.log = [];
  job.log.unshift(trimmed);
  if (job.log.length > 80) job.log.length = 80;
  job.message = trimmed.slice(0, 500);
  job.updatedAt = new Date().toISOString();
}

export function runCommand(job, cwd, command, args, env, { shell = false, acceptCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell,
    });
    child.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) appendLog(job, line);
    });
    child.stderr.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) appendLog(job, line);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (acceptCodes.includes(code ?? -1)) resolve(code ?? 0);
      else reject(new Error(`${command} ${args.join(' ')} 종료 코드 ${code}`));
    });
  });
}
