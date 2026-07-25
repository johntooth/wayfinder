"use client";

import dynamic from "next/dynamic";
import { trpc } from "@/trpc/client";

// The wizard reuses seven settings cards, so mounting it directly in the admin
// layout put all of them in every admin page's bundle — for a dialog that only
// opens on a fresh install. This gate runs the cheap onboarding query and pulls
// the wizard in only once it is actually going to open.
const SetupWizard = dynamic(
  () => import("./setup-wizard").then((module) => module.SetupWizard),
  { ssr: false },
);

export function SetupWizardMount() {
  const onboardingQuery = trpc.settings.getOnboardingState.useQuery();

  if (onboardingQuery.isLoading || onboardingQuery.data?.completed) return null;

  return <SetupWizard />;
}
