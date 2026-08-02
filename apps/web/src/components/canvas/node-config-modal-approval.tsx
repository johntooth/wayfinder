"use client";

import type { PriorStepField } from "@rbrasier/domain";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  approvalSubjectChoice,
  approvalSubjectFromChoice,
  CUSTOM_SUBJECT_CHOICE,
  editableReturnSteps,
  noEditablePredecessorWarning,
  signatureSlotConflict,
  signatureSlotControl,
  signatureSlotsFor,
  type PriorStep,
} from "./approval-node-config";
import type { ApproverSourceMode, NodeConfigValues } from "./node-config-modal";

const SELECT_CLASS =
  "flex h-10 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#1f8a4c] focus:bg-white focus:outline-none";

const HINT_CLASS = "text-[12px] text-[#6d6a65]";
const WARNING_CLASS = "text-[12px] text-[#a8601a]";

export interface NodeConfigModalApprovalProps {
  values: NodeConfigValues;
  set: <K extends keyof NodeConfigValues>(key: K, value: NodeConfigValues[K]) => void;
  // Steps earlier in the flow, for the subject and return-target dropdowns.
  priorSteps?: PriorStep[];
  // The raw template fields of those steps — the only place signature slots are
  // visible, since `nodeFieldSet` filters them out everywhere else.
  priorStepFields?: PriorStepField[];
  // Signature slots already claimed by other approval steps on the same step's
  // template, so two nodes cannot target one slot.
  takenSignatureFieldKeys?: string[];
}

export function NodeConfigModalApproval({
  values,
  set,
  priorSteps = [],
  priorStepFields = [],
  takenSignatureFieldKeys = [],
}: NodeConfigModalApprovalProps) {
  const slots = signatureSlotsFor(priorStepFields, values.approvalSubjectNodeId);
  const slotControl = signatureSlotControl(slots);
  const slotConflict = signatureSlotConflict(values.signatureFieldKey, takenSignatureFieldKeys, slots);
  const returnSteps = editableReturnSteps(priorSteps);
  const returnWarning = noEditablePredecessorWarning(
    priorSteps,
    values.changesRequestedTargetNodeId,
  );

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="approver-source">Who approves?</Label>
        <select
          id="approver-source"
          className={SELECT_CLASS}
          value={values.approverSource}
          onChange={(e) => set("approverSource", e.target.value as ApproverSourceMode)}
        >
          <option value="first_level_supervisor">First-level supervisor</option>
          <option value="second_level_supervisor">Second-level supervisor</option>
          <option value="dynamic">Dynamic — resolved from policy/context</option>
        </select>
        <p className={HINT_CLASS}>
          The operator always confirms the suggested approver, and can choose someone else.
        </p>
      </div>

      {values.approverSource === "dynamic" && (
        <div className="space-y-1">
          <Label htmlFor="approver-role-hint">Role hint (optional)</Label>
          <Input
            id="approver-role-hint"
            value={values.roleHint}
            onChange={(e) => set("roleHint", e.target.value)}
            placeholder="e.g. SES Band 1 delegate"
          />
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="approval-subject">What is being approved?</Label>
        <select
          id="approval-subject"
          className={SELECT_CLASS}
          value={approvalSubjectChoice({
            kind: values.approvalSubjectKind,
            nodeId: values.approvalSubjectNodeId,
          })}
          onChange={(e) => {
            const subject = approvalSubjectFromChoice(e.target.value);
            set("approvalSubjectKind", subject.kind);
            set("approvalSubjectNodeId", subject.nodeId);
            // The slot list belongs to the subject step, so changing the
            // subject invalidates any slot already picked.
            set("signatureFieldKey", "");
          }}
        >
          <option value="">The last completed step (default)</option>
          {priorSteps.map((step) => (
            <option key={step.nodeId} value={step.nodeId}>
              {step.stepLabel}
            </option>
          ))}
          <option value={CUSTOM_SUBJECT_CHOICE}>Something I&apos;ll describe…</option>
        </select>
        {values.approvalSubjectKind === "step" && (
          <p className={HINT_CLASS}>
            The approver sees that step&apos;s document or captured values, and the record says
            exactly what was approved.
          </p>
        )}
      </div>

      {values.approvalSubjectKind === "custom" && (
        <div className="space-y-1">
          <Label htmlFor="approval-subject-instruction">Describe the subject</Label>
          <Textarea
            id="approval-subject-instruction"
            rows={2}
            value={values.approvalSubjectInstruction}
            onChange={(e) => set("approvalSubjectInstruction", e.target.value)}
            placeholder="e.g. the delegation of purchasing authority being sought"
          />
          <p className={HINT_CLASS}>
            Interpreted once, from what the session has gathered, and locked into the record when
            the approver decides.
          </p>
        </div>
      )}

      {slotControl.mode === "choose" && (
        <div className="space-y-1">
          <Label htmlFor="approval-signature-slot">Which signature does this step sign?</Label>
          <select
            id="approval-signature-slot"
            className={SELECT_CLASS}
            value={values.signatureFieldKey}
            onChange={(e) => set("signatureFieldKey", e.target.value)}
          >
            <option value="">Choose a signature…</option>
            {slotControl.slots.map((slot) => (
              <option key={slot.key} value={slot.key}>
                {slot.label}
              </option>
            ))}
          </select>
          {slotConflict ? (
            <p className={WARNING_CLASS}>{slotConflict}</p>
          ) : (
            <p className={HINT_CLASS}>
              That step&apos;s template has more than one signature, so this step needs to say which
              one it fills.
            </p>
          )}
        </div>
      )}

      {slotControl.mode === "auto" && (
        <p className={HINT_CLASS}>
          On approval, the decision is written into that step&apos;s signature and the document is
          saved as a new version. The earlier version is kept.
        </p>
      )}

      <div className="space-y-1">
        <Label htmlFor="approval-changes-target">On changes requested, return to:</Label>
        <select
          id="approval-changes-target"
          className={SELECT_CLASS}
          value={values.changesRequestedTargetNodeId}
          onChange={(e) => set("changesRequestedTargetNodeId", e.target.value)}
        >
          <option value="">The nearest earlier step that can be edited (default)</option>
          {returnSteps.map((step) => (
            <option key={step.nodeId} value={step.nodeId}>
              {step.stepLabel}
            </option>
          ))}
        </select>
        {returnWarning ? (
          <p className={WARNING_CLASS}>{returnWarning}</p>
        ) : (
          <p className={HINT_CLASS}>
            Rejecting and closing the request is the only thing that ends a session.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="approval-instructions">Instructions (optional)</Label>
        <Textarea
          id="approval-instructions"
          rows={3}
          value={values.approvalInstructions}
          onChange={(e) => set("approvalInstructions", e.target.value)}
          placeholder="Shown to the operator and the approver…"
        />
      </div>
    </>
  );
}
