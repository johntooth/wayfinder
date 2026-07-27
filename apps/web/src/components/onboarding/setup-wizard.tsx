"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import { StorageCard } from "@/components/settings/storage-card";
import { AiProviderCard } from "@/components/settings/ai-provider-card";
import { AuthMethodsCard } from "@/components/settings/auth-methods-card";
import { trpc } from "@/trpc/client";
import { WizardDeploymentStep, type DeploymentMode } from "./wizard-deployment-step";
import { WizardRequirement } from "./wizard-requirement";
import { WizardSkipDialog } from "./wizard-skip-dialog";

type Props = {
  // When true, the wizard opens from the admin Settings "Re-run setup" control
  // and ignores onboarding_state (re-running never clears the flag).
  forceOpen?: boolean;
  onClose?: () => void;
};

type StepIndex = 0 | 1 | 2;

const STEP_TITLES = ["Deployment", "Required setup", "Done"] as const;

// A short explainer shown above each step's reused settings cards.
function StepIntro({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export function SetupWizard({ forceOpen = false, onClose }: Props) {
  const utils = trpc.useUtils();
  const onboardingQuery = trpc.settings.getOnboardingState.useQuery(undefined, {
    enabled: !forceOpen,
  });
  const setupStatusQuery = trpc.settings.getSetupStatus.useQuery();

  const setDeployment = trpc.settings.setDeploymentConfig.useMutation();
  const setOrganisationsEnabled = trpc.organisation.setEnabled.useMutation();
  const setSetting = trpc.settings.set.useMutation();
  const createOrganisation = trpc.organisation.createForSelf.useMutation();
  const completeOnboarding = trpc.settings.completeOnboarding.useMutation();

  // One shared connectivity controller so every reused card's Test button
  // behaves exactly as it does on the admin Settings page.
  const connectivity = useConnectivity();

  const [step, setStep] = useState<StepIndex>(0);
  const [manuallyClosed, setManuallyClosed] = useState(false);
  const [mode, setMode] = useState<DeploymentMode | null>(null);
  const [singleOrganisationName, setSingleOrganisationName] = useState("");
  const [multiOrganisationName, setMultiOrganisationName] = useState("");
  const [organisationCreated, setOrganisationCreated] = useState(false);
  const [skipWarningOpen, setSkipWarningOpen] = useState(false);
  const [committing, setCommitting] = useState(false);

  const shouldOpen = forceOpen || (!onboardingQuery.data?.completed && !onboardingQuery.isLoading);
  const open = shouldOpen && !manuallyClosed;

  const storageReady = setupStatusQuery.data?.storage.configured ?? false;
  const aiReady = setupStatusQuery.data?.ai.configured ?? false;
  const requiredReady = storageReady && aiReady;

  const close = (): void => {
    setManuallyClosed(true);
    onClose?.();
  };

  const finish = async (): Promise<void> => {
    await completeOnboarding.mutateAsync();
    await utils.settings.getOnboardingState.invalidate();
    close();
  };

  // Step 1's Continue persists the deployment choice, so the admin never has to
  // press Save separately. Returns false when the choice is incomplete.
  const commitDeployment = async (): Promise<boolean> => {
    if (mode === null) return false;

    const multiOrganisation = mode === "multi";
    await setDeployment.mutateAsync({ multiOrganisation });
    await setOrganisationsEnabled.mutateAsync({ enabled: multiOrganisation });

    if (mode === "single") {
      const name = singleOrganisationName.trim();
      if (name.length > 0) {
        await setSetting.mutateAsync({ key: "organisation_name", value: name });
      }
    }

    if (mode === "multi" && !organisationCreated) {
      const name = multiOrganisationName.trim();
      if (name.length === 0) {
        toast.error("Enter the organisation you belong to");
        return false;
      }
      await createOrganisation.mutateAsync({ name });
      setOrganisationCreated(true);
    }

    await Promise.all([
      utils.settings.getDeploymentConfig.invalidate(),
      utils.organisation.isEnabled.invalidate(),
      utils.settings.getSetupStatus.invalidate(),
    ]);
    return true;
  };

  const advance = async (): Promise<void> => {
    if (step === 0) {
      setCommitting(true);
      try {
        if (!(await commitDeployment())) return;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save your choice");
        return;
      } finally {
        setCommitting(false);
      }
    }
    setStep((current) => (current + 1) as StepIndex);
  };

  const continueDisabled =
    committing || (step === 0 ? mode === null : step === 1 ? !requiredReady : false);

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
        {/* The wizard reuses settings cards that the page behind it also
            renders, so specs need a stable container to scope queries to. */}
        <DialogContent className="max-w-2xl" data-testid="setup-wizard">
          <DialogHeader>
            <DialogTitle data-testid="setup-wizard-title">
              Set up Wayfinder — Step {step + 1} of 3: {STEP_TITLES[step]}
            </DialogTitle>
          </DialogHeader>

          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
            {step === 0 && (
              <WizardDeploymentStep
                mode={mode}
                onModeChange={setMode}
                onSingleNameChange={setSingleOrganisationName}
                multiOrganisationName={multiOrganisationName}
                onMultiOrganisationNameChange={setMultiOrganisationName}
                organisationCreated={organisationCreated}
              />
            )}

            {step === 1 && (
              <div className="space-y-4">
                <StepIntro>
                  Wayfinder needs object storage and an AI provider before it can run anything. Save
                  both to continue, or skip and configure them later.
                </StepIntro>
                <div className="space-y-2">
                  <WizardRequirement
                    label="Object storage"
                    satisfied={storageReady}
                    testId="wizard-requirement-storage"
                  />
                  <StorageCard connectivity={connectivity} />
                </div>
                <div className="space-y-2">
                  <WizardRequirement
                    label="AI provider"
                    satisfied={aiReady}
                    testId="wizard-requirement-ai"
                  />
                  <AiProviderCard connectivity={connectivity} />
                </div>
                <AuthMethodsCard />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3" data-testid="wizard-complete">
                <p className="text-sm font-medium">Setup complete.</p>
                <StepIntro>
                  Wayfinder is ready to use. Advanced options — including Skills, MCP, n8n and email
                  integration — can be configured at any time from the Configuration pages.
                </StepIntro>
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
              {step === 1 && (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="wizard-skip"
                  onClick={() => setSkipWarningOpen(true)}
                >
                  Skip
                </Button>
              )}
              {step < 2 && (
                <Button
                  type="button"
                  data-testid="wizard-continue"
                  onClick={() => void advance()}
                  disabled={continueDisabled}
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

      <WizardSkipDialog
        open={skipWarningOpen}
        onOpenChange={setSkipWarningOpen}
        onConfirm={() => void finish()}
        confirming={completeOnboarding.isPending}
      />
    </>
  );
}
