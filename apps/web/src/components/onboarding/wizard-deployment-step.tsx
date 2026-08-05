"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrganisationNameCard } from "@/components/settings/organisation-name-card";

export type DeploymentMode = "single" | "multi";

function ChoiceButton({
  id,
  title,
  explainer,
  selected,
  onSelect,
}: {
  id: string;
  title: string;
  explainer: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      data-testid={id}
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex-1 rounded-md border p-3 text-left transition-colors ${
        selected
          ? "border-[#1f6b4d] bg-[#f2f8f4]"
          : "border-border bg-background hover:border-[#c9c4bb]"
      }`}
    >
      <span className="block font-medium">{title}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{explainer}</span>
    </button>
  );
}

// Step 1 of the first-run wizard. The deployment shape is a fork, not a toggle:
// a single-organisation install only needs a name for AI grounding, while a
// multi-organisation one needs a real organisation row for the admin to belong
// to before anything else can resolve membership.
export function WizardDeploymentStep({
  mode,
  onModeChange,
  onSingleNameChange,
  multiOrganisationName,
  onMultiOrganisationNameChange,
  organisationCreated,
}: {
  mode: DeploymentMode | null;
  onModeChange: (mode: DeploymentMode) => void;
  onSingleNameChange: (value: string) => void;
  multiOrganisationName: string;
  onMultiOrganisationNameChange: (value: string) => void;
  organisationCreated: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Will this installation serve one organisation, or several?
      </p>

      <div className="flex gap-3">
        <ChoiceButton
          id="wizard-deployment-single"
          title="One organisation"
          explainer="Everyone using Wayfinder belongs to the same organisation."
          selected={mode === "single"}
          onSelect={() => onModeChange("single")}
        />
        <ChoiceButton
          id="wizard-deployment-multi"
          title="Multiple organisations"
          explainer="Several organisations share this installation, each with their own members."
          selected={mode === "multi"}
          onSelect={() => onModeChange("multi")}
        />
      </div>

      {mode === "single" && <OrganisationNameCard onValueChange={onSingleNameChange} />}

      {mode === "multi" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your organisation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="wizard-multi-org-name">Organisation you belong to</Label>
              <p className="text-xs text-muted-foreground">
                Creates the first organisation and adds you to it. You can add the rest from
                Configuration → Organisations.
              </p>
              <Input
                id="wizard-multi-org-name"
                value={multiOrganisationName}
                onChange={(event) => onMultiOrganisationNameChange(event.target.value)}
                placeholder="e.g. Acme Corporation"
                disabled={organisationCreated}
                suppressHydrationWarning
              />
            </div>
            {organisationCreated && (
              <p data-testid="wizard-org-created" className="text-xs text-[#1f6b4d]">
                Organisation created.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
