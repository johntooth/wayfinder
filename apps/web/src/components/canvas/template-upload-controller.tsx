"use client";

import { useState, type ChangeEvent, type RefObject } from "react";
import { rowsFromDocumentTags } from "@/lib/template-annotation";
import { TemplateAnnotationModal } from "./template-annotation-modal";

export interface TemplateUploadResult {
  path: string;
  filename: string;
  documentTemplateContent: string | null;
  documentTemplateFormat?: "docx" | "xlsx";
  spreadsheetTemplateMode?: "tags" | "header" | null;
}

// The node-config fields a saved template writes back.
export const templateValuesFrom = (result: TemplateUploadResult) => ({
  documentTemplatePath: result.path,
  documentTemplateFilename: result.filename,
  documentTemplateContent: result.documentTemplateContent ?? null,
  documentTemplateFormat: (result.documentTemplateFormat ?? "docx") as "docx" | "xlsx",
  spreadsheetTemplateMode: result.spreadsheetTemplateMode ?? null,
});

export interface TemplateUploadController {
  pendingFile: File | null;
  editingFields: boolean;
  isOpen: boolean;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  editFields: () => void;
  reset: () => void;
  complete: (result: TemplateUploadResult) => void;
}

// Owns the handoff from the node-config file picker to the guided annotation
// modal. Picking a file no longer uploads it: detection, the AI pass and field
// review all happen in the modal, and only the annotated result is persisted.
export function useTemplateUpload(
  fileInputRef: RefObject<HTMLInputElement | null>,
  onApply: (result: TemplateUploadResult) => void,
): TemplateUploadController {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [editingFields, setEditingFields] = useState(false);

  const reset = () => {
    setPendingFile(null);
    setEditingFields(false);
  };

  return {
    pendingFile,
    editingFields,
    isOpen: pendingFile !== null || editingFields,
    handleFileChange: (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setPendingFile(file);
      setEditingFields(false);
      // Cleared so re-picking the same file still fires a change event.
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    editFields: () => setEditingFields(true),
    reset,
    complete: (result) => {
      onApply(result);
      reset();
    },
  };
}

export function TemplateAnnotationHost({
  controller,
  flowId,
  nodeId,
  documentTemplateContent,
}: {
  controller: TemplateUploadController;
  flowId: string;
  nodeId: string | null;
  documentTemplateContent: string | null | undefined;
}) {
  if (!nodeId || !controller.isOpen) return null;

  return (
    <TemplateAnnotationModal
      file={controller.pendingFile}
      flowId={flowId}
      nodeId={nodeId}
      // Re-entry reads the field set back out of the stored template's text, so
      // editing fields never requires another trip through the file picker.
      existingRows={
        controller.editingFields ? rowsFromDocumentTags(documentTemplateContent ?? "") : null
      }
      onCancel={controller.reset}
      onSaved={controller.complete}
    />
  );
}
