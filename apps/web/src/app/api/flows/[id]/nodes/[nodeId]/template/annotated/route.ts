import { NextResponse, type NextRequest } from "next/server";
import { buildAnnotationEdits, type AnnotationRow } from "@/lib/template-annotation";
import {
  authoriseTemplateNode,
  generatorFor,
  readUploadedTemplate,
  TEMPLATE_MIME,
  type TemplateFormat,
} from "@/lib/template-route-helpers";

const parseAnnotationRows = (raw: FormDataEntryValue | null): AnnotationRow[] => {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AnnotationRow[]) : [];
  } catch {
    return [];
  }
};

// Returns the reviewed document with the current annotations written in, without
// persisting it — the author downloads it to add more fields in Word, then
// re-uploads. A file in the request is annotated directly (fresh upload); with
// no file the stored template is annotated with the current edits (re-entry).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
): Promise<NextResponse> {
  const { id: flowId, nodeId } = await params;

  const access = await authoriseTemplateNode(req, flowId, nodeId);
  if (access.error) return access.error;
  const { container, node } = access.data;

  const formData = await req.formData();
  const edits = buildAnnotationEdits(parseAnnotationRows(formData.get("annotations")));

  let buffer: Buffer;
  let filename: string;
  let format: TemplateFormat;

  const hasFile = formData.get("file") instanceof File;
  if (hasFile) {
    const upload = await readUploadedTemplate(formData);
    if (upload.error) return upload.error;
    buffer = upload.data.buffer;
    filename = upload.data.safeFilename;
    format = upload.data.format;
  } else {
    const storagePath = node.config.documentTemplatePath as string | null;
    const storedName = node.config.documentTemplateFilename as string | null;
    if (!storagePath || !storedName) {
      return NextResponse.json({ error: "This step has no template to download" }, { status: 404 });
    }
    const stored = await container.objectStorage.get(storagePath);
    if (stored.error) {
      return NextResponse.json({ error: "Failed to read the stored template" }, { status: 500 });
    }
    buffer = stored.data;
    filename = storedName;
    format = storedName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "docx";
  }

  const annotated = generatorFor(format).annotate({ templateBytes: buffer, edits });
  if (annotated.error) {
    return NextResponse.json({ error: annotated.error.message }, { status: 422 });
  }

  return new NextResponse(new Uint8Array(annotated.data.bytes), {
    status: 200,
    headers: {
      "Content-Type": TEMPLATE_MIME[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
