import { NextResponse, type NextRequest } from "next/server";
import type { SuggestionMode } from "@rbrasier/application";
import { rowsFromSuggestions } from "@/lib/template-annotation";
import {
  authoriseTemplateNode,
  extractTemplate,
  readUploadedTemplate,
} from "@/lib/template-route-helpers";

const MODES: SuggestionMode[] = ["empty", "filled", "augment"];

const isMode = (value: unknown): value is SuggestionMode =>
  typeof value === "string" && MODES.includes(value as SuggestionMode);

// The AI pass. Returns proposed rows for the review grid; an empty list is a
// valid answer and drives the modal's "found nothing" fallback rather than
// presenting an empty grid.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
): Promise<NextResponse> {
  const { id: flowId, nodeId } = await params;

  const access = await authoriseTemplateNode(req, flowId, nodeId);
  if (access.error) return access.error;

  const formData = await req.formData();
  const upload = await readUploadedTemplate(formData);
  if (upload.error) return upload.error;

  const mode = formData.get("mode");
  if (!isMode(mode)) {
    return NextResponse.json({ error: "Unknown suggestion mode" }, { status: 400 });
  }

  const existingLabelsRaw = formData.get("existingLabels");
  const existingLabels =
    typeof existingLabelsRaw === "string" && existingLabelsRaw.trim()
      ? (JSON.parse(existingLabelsRaw) as unknown)
      : [];

  const extraction = extractTemplate(upload.data.format, upload.data.buffer, false);
  if (extraction.error) {
    return NextResponse.json(extraction.error.body, { status: extraction.error.status });
  }

  const result = await access.data.container.useCases.suggestTemplateFields.execute({
    documentText: extraction.data.documentTemplateContent,
    mode,
    existingLabels: Array.isArray(existingLabels) ? existingLabels.filter((label): label is string => typeof label === "string") : [],
  });

  if (result.error) {
    return NextResponse.json({ error: "Failed to analyse the document" }, { status: 500 });
  }

  return NextResponse.json({ rows: rowsFromSuggestions(result.data.suggestions) });
}
