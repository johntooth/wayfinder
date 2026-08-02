/**
 * fix-startup-env-and-db-notices.spec.ts
 *
 * Regression guard for the broken quick start (fix:
 * startup-env-and-db-notices).
 *
 * Root cause (fixed in this patch):
 *   restart.sh loads .env into its own shell and then execs `pnpm turbo dev`.
 *   Turborepo 2.x defaults to strict environment mode, so a task inherits only a
 *   system allowlist — `next dev` started with no DATABASE_URL, no
 *   BETTER_AUTH_SECRET and no SETTINGS_ENCRYPTION_KEY, and serverEnv() threw a
 *   ZodError on every server-side call. apps/api was unaffected only because it
 *   re-reads ../../.env through dotenv; apps/web now does the equivalent through
 *   scripts/with-root-env.sh, and the dev task declares its passthrough.
 *
 * What is tested:
 *   1. The two startup contracts, asserted against the real turbo binary and the
 *      real loader script. Both fail on the unfixed code: the dev task reports
 *      `passThroughEnv: null`, and apps/web's dev script does not go through a
 *      loader, so a variable that exists only in the repo-root .env never
 *      reaches the command.
 *   2. The reported symptom itself — POST /api/internal/scheduler/tick answering
 *      instead of 500ing with a serverEnv() ZodError. The CI stack sets its
 *      variables in the job environment rather than in a root .env, so this one
 *      guards the endpoint rather than the loading path.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './helpers/base';

const repoRoot = join(__dirname, '../../..');
const SCHEDULER_TICK_SECRET = process.env.SCHEDULER_TICK_SECRET;

test.describe('fix: the documented quick start boots a configured web app', () => {
  test('the turbo dev task passes the developer environment through to the command', async () => {
    const dryRun = execFileSync(
      join(repoRoot, 'node_modules/.bin/turbo'),
      ['run', 'dev', '--dry=json'],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );

    const webDevTask = JSON.parse(dryRun).tasks.find(
      (task: { package: string }) => task.package === '@wayfinder/web',
    );

    // Without this, strict mode drops DATABASE_URL/BETTER_AUTH_SECRET/
    // SETTINGS_ENCRYPTION_KEY between restart.sh and `next dev`.
    expect(webDevTask.environmentVariables.specified.passThroughEnv).toContain('*');
  });

  test('the web dev and start scripts read the repo-root .env', async () => {
    const webPackage = JSON.parse(
      execFileSync('node', ['-p', 'JSON.stringify(require("./apps/web/package.json"))'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }),
    );

    expect(webPackage.scripts.dev).toContain('with-root-env.sh');
    expect(webPackage.scripts.start).toContain('with-root-env.sh');

    // Exercise the loader itself against an isolated root, so this asserts
    // behaviour rather than the presence of a filename.
    const stagedRoot = mkdtempSync(join(tmpdir(), 'quick-start-env-'));
    mkdirSync(join(stagedRoot, 'scripts'));
    const stagedLoader = join(stagedRoot, 'scripts', 'with-root-env.sh');
    copyFileSync(join(repoRoot, 'scripts/with-root-env.sh'), stagedLoader);
    chmodSync(stagedLoader, 0o755);
    writeFileSync(
      join(stagedRoot, '.env'),
      'DATABASE_URL=postgresql://postgres:postgres@localhost:5433/wayfinder\n',
    );

    const seenByCommand = execFileSync(
      stagedLoader,
      ['node', '-e', 'process.stdout.write(String(process.env.DATABASE_URL))'],
      { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } },
    );

    expect(seenByCommand).toBe('postgresql://postgres:postgres@localhost:5433/wayfinder');
  });

  // The reported symptom: the API's heartbeat drove this endpoint once a minute
  // and logged "Scheduler tick endpoint returned 500" every time, because
  // getContainer() → serverEnv() threw on the missing variables.
  test('the scheduler tick endpoint answers instead of 500ing on a server env error', async ({
    page,
  }) => {
    test.skip(!SCHEDULER_TICK_SECRET, 'SCHEDULER_TICK_SECRET not configured for this stack');

    const response = await page.request.post('/api/internal/scheduler/tick', {
      headers: { 'x-scheduler-secret': SCHEDULER_TICK_SECRET as string },
    });

    expect(response.status()).not.toBe(500);
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('data');
    expect(body).not.toHaveProperty('error');
  });
});
