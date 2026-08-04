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
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

export interface NominationDialogProps {
  mode: "create_or_join" | "join_existing";
  joinable: Array<{ id: string; name: string }>;
  onDone: () => void;
  // The first-login gate frames this as picking an organisation; user settings
  // frames the same dialog as changing one.
  title?: string;
  description?: string;
  dismissLabel?: string;
  // Pre-selects the user's current organisation when they are changing it.
  currentOrganisationId?: string | null;
}

// Shared by the first-login gate (ADR-038 §4) and the Organisation card in user
// settings — both write through `submitNomination`, which resolves the choice
// against the configured mode and allowlist server-side.
export function NominationDialog({
  mode,
  joinable,
  onDone,
  title = "Choose your organisation",
  description = "Pick the organisation you belong to. Flows shared with it will appear in your list.",
  dismissLabel = "Not now",
  currentOrganisationId = null,
}: NominationDialogProps) {
  const utils = trpc.useUtils();
  const canCreate = mode === "create_or_join";
  const [choice, setChoice] = useState<"join" | "create">(joinable.length > 0 ? "join" : "create");
  const [joinId, setJoinId] = useState(currentOrganisationId ?? joinable[0]?.id ?? "");
  const [createName, setCreateName] = useState("");

  const submit = trpc.organisation.submitNomination.useMutation({
    onSuccess: async () => {
      toast.success("Organisation set");
      await Promise.all([
        utils.organisation.signInState.invalidate(),
        utils.organisation.mine.invalidate(),
        utils.organisation.nominationOptions.invalidate(),
      ]);
      onDone();
    },
    onError: (error) => toast.error(error.message ?? "Could not set your organisation"),
  });

  const effectiveChoice = canCreate ? choice : "join";
  const handleSubmit = () => {
    if (effectiveChoice === "create") {
      if (!createName.trim()) return;
      submit.mutate({ createName: createName.trim() });
      return;
    }
    if (!joinId) return;
    submit.mutate({ joinOrganisationId: joinId });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">{description}</p>

          {canCreate && joinable.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="sr-only">Create or join</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="nomination-choice"
                  checked={choice === "join"}
                  onChange={() => setChoice("join")}
                />
                Join an existing organisation
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="nomination-choice"
                  checked={choice === "create"}
                  onChange={() => setChoice("create")}
                />
                Create a new organisation
              </label>
            </fieldset>
          )}

          {effectiveChoice === "join" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="nomination-join" className="text-sm font-medium">
                Organisation
              </label>
              {joinable.length === 0 ? (
                <p className="text-sm text-muted-foreground">No organisations to join yet.</p>
              ) : (
                <select
                  id="nomination-join"
                  className="rounded-md border border-[#d6d2ca] bg-white px-2 py-1 text-sm"
                  value={joinId}
                  onChange={(event) => setJoinId(event.target.value)}
                >
                  {joinable.map((organisation) => (
                    <option key={organisation.id} value={organisation.id}>
                      {organisation.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {effectiveChoice === "create" && canCreate && (
            <div className="flex flex-col gap-1">
              <label htmlFor="nomination-create" className="text-sm font-medium">
                New organisation name
              </label>
              <Input
                id="nomination-create"
                placeholder="e.g. Procurement"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={submit.isPending}>
            {dismissLabel}
          </Button>
          <Button onClick={handleSubmit} disabled={submit.isPending}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
