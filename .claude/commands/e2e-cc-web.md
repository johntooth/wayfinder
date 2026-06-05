# /e2e-cc-web — Bootstrap & Run Playwright E2E in the Claude Code Web Sandbox

Use this skill to run the Playwright e2e suite from **inside a Claude Code web
container**, where there is **no database, no app server, and no browser**, and
where the Playwright/Chrome download CDNs are blocked (403). This is the
"stand everything up from nothing" recipe.

> Difference from `/e2e`: `/e2e` assumes the dev server and a Playwright browser
> are already available and drives tests via the MCP connector. `/e2e-cc-web`
> provisions Postgres, the app server, and a Chromium binary first, then runs
> the suite via the CLI. Reach for this one in a fresh web session.

---

## Environment constraints (why this recipe exists)

- The CI workflow (`.github/workflows/e2e.yml`) only runs against `main`.
- The web container starts with no DB, no app server, no browser.
- Outbound network is restricted: the **npm registry and Ubuntu apt mirrors are
  reachable**, but the **Playwright/Chrome download CDNs return 403**, so
  `npx playwright install` fails. We sidestep this with `@sparticuz/chromium`,
  which ships a headless Chromium inside its npm tarball.

---

## 1. Postgres (with pgvector), run locally as the `ubuntu` user

```bash
# pgvector isn't preinstalled; the apt mirror has it
apt-get install -y postgresql-16-pgvector

# Postgres refuses to run as root → run the cluster as the `ubuntu` user,
# and use a writable socket dir (/var/run/postgresql is root-owned)
PGBIN=/usr/lib/postgresql/16/bin
rm -rf /tmp/pgdata && mkdir -p /tmp/pgdata /tmp/pgsock
chown ubuntu:ubuntu /tmp/pgdata /tmp/pgsock
su ubuntu -c "$PGBIN/initdb -D /tmp/pgdata -U postgres --auth=trust"
su ubuntu -c "$PGBIN/pg_ctl -D /tmp/pgdata -o '-p 5432 -k /tmp/pgsock' -l /tmp/pg.log start"

PGPASSWORD=postgres psql -h localhost -U postgres -c "CREATE DATABASE wayfinder_e2e;"
PGPASSWORD=postgres psql -h localhost -U postgres -d wayfinder_e2e -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

---

## 2. Install deps, migrate, start the app

The env mirrors `.github/workflows/e2e.yml`. MinIO is **not** required for the
admin/flow/scheduling/dashboard specs (the CI job doesn't run it either).

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wayfinder_e2e
export BETTER_AUTH_SECRET=e2e-test-secret-must-be-at-least-32-chars-long
export BETTER_AUTH_URL=http://localhost:3000
export AI_DEFAULT_PROVIDER=anthropic
export ADMIN_SEED_EMAIL=admin@example.com
export TEST_AUTH_BYPASS=true
export TEST_ADMIN_EMAIL=admin@example.com
export USE_REAL_AI=false              # specs mock AI via tests/e2e/helpers/base.ts
export BASE_URL=http://localhost:3000

pnpm install --frozen-lockfile
pnpm db:migrate
nohup pnpm --filter @wayfinder/web dev >/tmp/web.log 2>&1 &
# wait until http://localhost:3000 answers (307 redirect to /login is fine)
```

---

## 3. A Chromium that doesn't need the blocked CDN

`@sparticuz/chromium` ships a real headless Chromium **inside its npm tarball**,
so it installs from the reachable registry. Extract it once:

```bash
cd /tmp && mkdir -p chrome-npm && cd chrome-npm && npm init -y
npm install @sparticuz/chromium@123
node -e "require('@sparticuz/chromium').executablePath().then(p=>console.log(p))"
# → /tmp/claude-0/chromium  (run with --no-sandbox since the container is root)
```

Point Playwright at it with a throwaway config that extends the repo one
(do **not** commit this file):

```ts
// tests/e2e/playwright.local.config.ts
import base from './playwright.config';
const config: any = { ...base };
config.projects = (base as any).projects.map((p: any) => ({
  ...p,
  use: {
    ...p.use,
    launchOptions: {
      executablePath: '/tmp/claude-0/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  },
}));
export default config;
```

---

## 4. Run

```bash
cd tests/e2e && npm install                       # e2e has its own package.json
npx playwright test --config playwright.local.config.ts --project=setup   # auth
npx playwright test --config playwright.local.config.ts --project=chromium \
  phase-scheduling.spec.ts admin-flow-editing.spec.ts --reporter=list
```

To run the **full** suite, drop the per-file arguments and run all chromium specs:

```bash
npx playwright test --config playwright.local.config.ts --project=chromium --reporter=list
```

---

## 5. Report

After the run, produce a structured report:

- **Summary table**: Passed / Failed / Skipped counts.
- **Failures**: for each — test name + file, verbatim error (first 3 lines),
  diagnosed root cause (read the source, don't assume), proposed fix.
- **Skips**: categorise as *by design* (needs specific DB state) vs *needs
  investigation*.
- **Recommendations**: actionable next steps only, distinguishing test bugs from
  application bugs.

---

## Gotchas

- The app runs in **dev mode**, so the first navigation to a heavy route (the
  ReactFlow canvas) triggers on-demand compilation and can take >10s — size
  navigation timeouts accordingly.
- Specs run sequentially (`workers: 1`, shared auth state) and the DB is **not**
  reset between files, so flows created by `admin-flow-editing` are still there
  when later specs run.
- `@sparticuz/chromium` is ~Chromium 123 while Playwright bundles a newer build;
  basic interactions work, but if a spec needs a very new Chromium feature this
  may not match CI exactly.
- The background Postgres/dev-server can be reaped on container inactivity —
  just re-run steps 1–2's `pg_ctl start` / `pnpm dev` to bring them back.
