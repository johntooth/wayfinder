import { NextResponse, type NextRequest } from "next/server";
import { rowsFromDocumentTags } from "@/lib/template-annotation";
import {
  authoriseTemplateNode,
  extractTemplate,
  generatorFor,
  readUploadedTemplate,
} from "@/lib/template-route-helpers";

// Step 0 of the guided flow: read the uploaded document and hand back the
// placeholders the author wrote into it. A document either carries {{ tags }} or
// it does not — nothing about its content is inferred, and nothing is ever
// written into it that the author did not type themselves.
//
// Nothing is persisted here. The browser holds the file and re-sends it on save,
// so a document the author abandons never reaches our storage at all.
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
    classification: headerModeReady ? "header" : tags.length > 0 ? "annotated" : "empty",
    documentText: documentTemplateContent,
    rows: rowsFromDocumentTags(documentTemplateContent),
  });
}
