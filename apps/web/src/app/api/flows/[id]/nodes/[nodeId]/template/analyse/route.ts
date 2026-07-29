import { NextResponse, type NextRequest } from "next/server";
import { classifyTemplateSource } from "@rbrasier/domain";
import { rowsFromDocumentTags } from "@/lib/template-annotation";
import {
  authoriseTemplateNode,
  extractTemplate,
  generatorFor,
  readUploadedTemplate,
} from "@/lib/template-route-helpers";

// Step 0 of the guided annotation flow: parse the uploaded document, decide
// which branch it takes, and hand back the rows the review grid starts from.
//
// Nothing is persisted here. The browser holds the file and re-sends it on the
// next step, so a filled example — which may carry real supplier data or PII —
// never reaches our storage at all.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
): Promise<NextResponse> {
  const { id: flowId, nodeId } = await params;

  const access = await authoriseTemplateNode(req, flowId, nodeId);
  if (access.error) return access.error;

  const upload = await readUploadedTemplate(await req.formData());
  if (upload.error) return upload.error;

  const { buffer, format, safeFilename } = upload.data;

  const extraction = extractTemplate(format, buffer, false);
  if (extraction.error) {
    return NextResponse.json(extraction.error.body, { status: extraction.error.status });
  }

  const { tags, documentTemplateContent } = extraction.data;
  const classification = classifyTemplateSource(documentTemplateContent, tags.length);

  // A tagless .xlsx whose first row is a usable header already works today
  // (ADR-039 header mode). Annotating it would silently change its fill
  // semantics, so it is reported as configured and skips the guided flow.
  const headerModeReady =
    format === "xlsx" &&
    tags.length === 0 &&
    !generatorFor("xlsx").extractFields({ templateBytes: buffer }).error;

  return NextResponse.json({
    filename: safeFilename,
    format,
    classification: headerModeReady ? "header" : classification,
    documentText: documentTemplateContent,
    rows: classification === "annotated" ? rowsFromDocumentTags(documentTemplateContent) : [],
  });
}
