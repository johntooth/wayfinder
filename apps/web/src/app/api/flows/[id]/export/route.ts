import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/lib/container";
import { getSessionTokenFromRequest } from "@/lib/session-token";
import { statusForDomainError } from "@/lib/http-errors";

// Downloads a flow as a portable archive. A binary body, so it is a route
// handler rather than a tRPC procedure (PRD §7). Authorisation is the
// use-case's — owner or admin — and it is enforced there rather than here so
// the rule has one home.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: flowId } = await params;
  const container = getContainer();

  const token = getSessionTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await container.resolveSession(token);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await container.useCases.exportFlow.execute({
    flowId,
    requestedByUserId: session.userId,
    isAdmin: session.isAdmin,
  });

  if (result.error) {
    return NextResponse.json(
      { error: result.error.message },
      { status: statusForDomainError(result.error) },
    );
  }

  return new NextResponse(new Uint8Array(result.data.archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${result.data.filename}"`,
      "Content-Length": String(result.data.archive.length),
      // An archive carries prompt IP and whole context documents; nothing about
      // it should sit in a shared cache.
      "Cache-Control": "no-store",
    },
  });
}
