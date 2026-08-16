/**
 * seed.setup.ts
 *
 * Runs after auth setup and before the suite. Calls the test-only seed endpoint
 * so specs gated on existing flows/sessions run their real assertions instead of
 * skipping. Removed afterwards by cleanup.teardown.ts.
 */

import { test as setup, expect } from '@playwright/test';
import { SEED_FIXTURE_KEYS, writeSeedFixtures, type SeedFixtures } from './helpers/seed';

setup('seed e2e fixtures', async ({ request }) => {
  const response = await request.post('/api/test/seed');
  expect(
    response.ok(),
    `Seed failed (${response.status()}): ${await response.text()}`,
  ).toBeTruthy();

  const result = (await response.json()) as Record<string, unknown>;

  // Copying the ids field by field is what let approvalWithdrawSessionId go
  // missing: the endpoint returned it, the type declared it, and the copy
  // simply never listed it, so eight specs skipped themselves quietly. Take
  // whatever the endpoint sends and assert the full set arrived instead.
  const missing = SEED_FIXTURE_KEYS.filter((key) => typeof result[key] !== 'string');
  expect(
    missing,
    `Seed response is missing ${missing.length} id(s): ${missing.join(', ')}. ` +
      `Add them to SeedResult in apps/web/src/lib/e2e-fixtures.ts, or drop them ` +
      `from SEED_FIXTURE_KEYS if the fixture is gone.`,
  ).toEqual([]);

  const fixtures = Object.fromEntries(
    SEED_FIXTURE_KEYS.map((key) => [key, result[key]]),
  ) as SeedFixtures;

  writeSeedFixtures(fixtures);
  console.log(
    `✅ Seed: ${SEED_FIXTURE_KEYS.length} fixtures — flow=${fixtures.flowId} session=${fixtures.sessionId}`,
  );
});
