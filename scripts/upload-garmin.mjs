import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// npm loads .env.local in this Node process. Forward only the configuration
// needed by the uploader; no OAuth, weather, or other application secrets.
try {
  const python = process.env.TRAINI_COLLECTOR_PYTHON;
  if (!python || !path.isAbsolute(python)) throw new Error('수집기 Python의 절대 경로를 설정해 주세요.');
  await access(python, constants.X_OK);
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--dry-run')) throw new Error('지원 옵션: --dry-run');
  const child = spawn(python, ['-m', 'traini_collector.upload_cli', ...args], {
    cwd: homedir(), stdio: 'inherit',
    env: {
      HOME: homedir(), PATH: process.env.PATH, LANG: 'en_US.UTF-8',
      PYTHONUNBUFFERED: '1', PYTHONNOUSERSITE: '1',
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      TRAINI_ADMIN_USER_ID: process.env.TRAINI_ADMIN_USER_ID,
    },
  });
  const interrupt = () => child.kill('SIGINT');
  process.on('SIGINT', interrupt);
  child.once('error', () => { console.error('업로더 실행에 실패했습니다. 수집기 설치를 확인해 주세요.'); process.exitCode = 1; });
  child.once('exit', (code) => { process.off('SIGINT', interrupt); process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error?.code ? '수집기 Python 실행 경로와 설치를 확인해 주세요.' : error.message);
  process.exitCode = 1;
}
