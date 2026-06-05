/**
 * seed.setup.ts
 *
 * Runs after auth setup and before the suite. Calls the test-only seed endpoint
 * so specs gated on existing flows/sessions run their real assertions instead of
 * skipping. Removed afterwards by cleanup.teardown.ts.
 */

import { test as setup, expect } from '@playwright/test';

setup('seed e2e fixtures', async ({ request }) => {
  const response = await request.post('/api/test/seed');
  expect(
    response.ok(),
    `Seed failed (${response.status()}): ${await response.text()}`,
  ).toBeTruthy();

  const result = await response.json();
  console.log(`✅ Seed: flow=${result.flowId} session=${result.sessionId} extras=${result.extraFlowIds?.length ?? 0}`);
});
