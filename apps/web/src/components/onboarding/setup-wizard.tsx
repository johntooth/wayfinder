"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConnectivity } from "@/components/settings/connectivity";
import { OrganisationNameCard } from "@/components/settings/organisation-name-card";
import { StorageCard } from "@/components/settings/storage-card";
import { AiProviderCard } from "@/components/settings/ai-provider-card";
import { AuthMethodsCard } from "@/components/settings/auth-methods-card";
import { EmailCard } from "@/components/settings/email-card";
import { ExtractionConfigCard } from "@/components/settings/extraction-config-card";
import { N8nIntegrationCard } from "@/components/settings/n8n-integration-card";
import { trpc } from "@/trpc/client";

type Props = {
  // When true, the wizard opens from the admin Settings "Re-run setup" control
  // and ignores onboarding_state (re-running never clears the flag).
  forceOpen?: boolean;
  onClose?: () => void;
};

type StepIndex = 0 | 1 | 2;

const STEP_TITLES = ["Deployment", "Setup", "Site options"] as const;

// The state each wizard-offered flag ships in. Only consulted while the flag
// list query is in flight or if a key is missing entirely — ListFeatureFlags
// merges these same defaults server-side.
const FLAG_SHIPPED_ENABLED: Record<string, boolean> = {
  skills: false,
  mcp: false,
  extraction_flows: true,
};

// A short explainer shown above each step's reused settings cards.
function StepIntro({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function ToggleRow({
  id,
  title,
  explainer,
  enabled,
  onToggle,
  disabled,
}: {
  id: string;
  title: string;
  explainer: string;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
      <div>
        <label htmlFor={id} className="font-medium">
          {title}
        </label>
        <span className="mt-1 block text-xs text-muted-foreground">{explainer}</span>
      </div>
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={enabled}
        disabled={disabled}
        onChange={(event) => onToggle(event.target.checked)}
      />
    </div>
  );
}

export function SetupWizard({ forceOpen = false, onClose }: Props) {
  const utils = trpc.useUtils();
  const onboardingQuery = trpc.settings.getOnboardingState.useQuery(undefined, {
    enabled: !forceOpen,
  });
  const flagsQuery = trpc.featureFlag.list.useQuery();
  const deploymentQuery = trpc.settings.getDeploymentConfig.useQuery();

  const setDeployment = trpc.settings.setDeploymentConfig.useMutation();
  const upsertFlag = trpc.featureFlag.upsert.useMutation();
  const completeOnboarding = trpc.settings.completeOnboarding.useMutation();

  // One shared connectivity controller so every reused card's Test button
  // behaves exactly as it does on the admin Settings page.
  const connectivity = useConnectivity();

  const [step, setStep] = useState<StepIndex>(0);
  const [manuallyClosed, setManuallyClosed] = useState(false);

  const multiOrg = deploymentQuery.data?.multiOrganisation ?? false;

  const shouldOpen = forceOpen || (!onboardingQuery.data?.completed && !onboardingQuery.isLoading);
  const open = shouldOpen && !manuallyClosed;

  const flagEnabled = useMemo(() => {
    const map = new Map(flagsQuery.data?.map((flag) => [flag.key, flag.enabled]));
    return (key: string) => map.get(key) ?? FLAG_SHIPPED_ENABLED[key] ?? false;
  }, [flagsQuery.data]);

  const close = (): void => {
    setManuallyClosed(true);
    onClose?.();
  };

  const finish = async (): Promise<void> => {
    await completeOnboarding.mutateAsync();
    await utils.settings.getOnboardingState.invalidate();
    close();
  };

  const toggleMultiOrg = async (next: boolean): Promise<void> => {
    await setDeployment.mutateAsync({ multiOrganisation: next });
    await utils.settings.getDeploymentConfig.invalidate();
  };

  const toggleFlag = async (key: string, enabled: boolean): Promise<void> => {
    await upsertFlag.mutateAsync({ key, enabled, rolloutPct: 100 });
    await utils.featureFlag.list.invalidate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle data-testid="setup-wizard-title">
            Set up Wayfinder — Step {step + 1} of 3: {STEP_TITLES[step]}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
          {step === 0 && (
            <div className="space-y-4">
              <StepIntro>
                Name the organisation using this installation, and indicate whether
                more than one organisation will share it.
              </StepIntro>
              <OrganisationNameCard />
              <ToggleRow
                id="wizard-multi-org"
                title="Multiple organisations"
                explainer="Enable if several organisations share this installation. Configure how users are assigned from admin Settings → Organisations."
                enabled={multiOrg}
                onToggle={(next) => void toggleMultiOrg(next)}
                disabled={setDeployment.isPending}
              />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <StepIntro>
                Wayfinder needs object storage, an AI provider and a sign-in method.
                Configure each below and use its Test button to confirm it connects. A
                failed test warns but does not block you.
              </StepIntro>
              <StorageCard connectivity={connectivity} />
              <AiProviderCard connectivity={connectivity} />
              <AuthMethodsCard />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <StepIntro>
                These are optional — you can skip and configure them later from admin
                Settings.
              </StepIntro>
              <EmailCard connectivity={connectivity} />
              <N8nIntegrationCard connectivity={connectivity} />
              <ToggleRow
                id="wizard-flag-extraction-flows"
                title="Synthesise Information"
                explainer="Extract structured information from batches of documents and review the results. On by default; turn it off to hide the Synthesise Information surface."
                enabled={flagEnabled("extraction_flows")}
                onToggle={(next) => void toggleFlag("extraction_flows", next)}
                disabled={upsertFlag.isPending}
              />
              {flagEnabled("extraction_flows") && <ExtractionConfigCard />}
              <ToggleRow
                id="wizard-flag-skills"
                title="Skills"
                explainer="Enable the Skills library and per-step skill selection. Off by default; configuring skills happens later."
                enabled={flagEnabled("skills")}
                onToggle={(next) => void toggleFlag("skills", next)}
                disabled={upsertFlag.isPending}
              />
              <ToggleRow
                id="wizard-flag-mcp"
                title="MCP"
                explainer="Enable MCP servers and tools in the flow builder. Off by default; connecting servers happens later."
                enabled={flagEnabled("mcp")}
                onToggle={(next) => void toggleFlag("mcp", next)}
                disabled={upsertFlag.isPending}
              />
            </div>
          )}
        </DialogBody>

        <DialogFooter className="flex items-center justify-between gap-2">
          <div>
            {step > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep((current) => (current - 1) as StepIndex)}
              >
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <Button
                type="button"
                variant="outline"
                data-testid="wizard-skip"
                onClick={() => void finish()}
              >
                Skip
              </Button>
            )}
            {step < 2 && (
              <Button
                type="button"
                data-testid="wizard-continue"
                onClick={() => setStep((current) => (current + 1) as StepIndex)}
              >
                Continue
              </Button>
            )}
            {step === 2 && (
              <Button
                type="button"
                data-testid="wizard-finish"
                onClick={() => void finish()}
                disabled={completeOnboarding.isPending}
              >
                Finish
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
