# Bug Fix — Fresh install startup race hides setup link and logs scheduler failure

## Symptom

A fresh `release/alpha-2` install using the documented quick start can show an
API log entry before the web app is ready:

- `Scheduler tick failed. reason: "Failed to reach scheduler tick endpoint."`
- no visible `http://localhost:3000/setup?token=…` setup link in the startup log

## Root cause

`SchedulerWorker.start()` registered the heartbeat job, installed its interval,
and immediately ran `tick()`. In the local `restart.sh` flow, `turbo dev` starts
`apps/api` and `apps/web` concurrently. The API process can reach its first tick
before Next.js has finished compiling and binding the web app, so the first POST
to `/api/internal/scheduler/tick` fails with a network error even though the stack
recovers once the web app is ready.

The setup link emitter was detached from `instrumentation.register()`. Next.js can
finish startup logging while the detached work is still waiting on module loading
and database I/O; if that work fails, the catch block swallowed the error. The
quick-start contract says the setup URL is printed by startup, so this made the
fresh-install path ambiguous.

## Fix

- Delay the scheduler heartbeat's first tick until the first configured interval,
  giving the web app time to become ready during concurrent local startup.
- Await the lightweight, container-free setup-link emitter in the Node.js
  instrumentation hook and print a warning if it cannot emit the link.

## Regression coverage

- `packages/adapters/src/scheduling/scheduler-worker.test.ts` asserts `start()`
  registers the scheduler without firing immediately, then fires on the first
  timer interval.
- Existing startup e2e coverage continues to exercise the quick-start environment
  path and scheduler tick endpoint.

## Version bump

PATCH: `0.20.0` → `0.20.1`.
