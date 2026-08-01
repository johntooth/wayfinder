import { NextResponse } from "next/server";
import { isPkiUsable } from "@rbrasier/domain";
import { getContainer } from "@/lib/container";

const SAFE_REDIRECT_RE = /^\/(?!\/)/;

function safeRedirectPath(raw: string | null): string {
  if (!raw || !SAFE_REDIRECT_RE.test(raw)) return "/";
  try {
    const url = new URL(raw, "http://localhost");
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}

// A misconfigured deployment is the server's fault, not the caller's, so it must
// not be reported as a 400 alongside a malformed certificate header.
function statusFor(code: string): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "INFRA_FAILURE") return 500;
  return 400;
}

function extractSourceIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const last = forwarded.split(",").at(-1)?.trim();
    if (last) return last;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

async function signInWithCertificate(request: Request): Promise<NextResponse> {
  const container = getContainer();

  // Not usable, not merely disabled: an enabled PKI whose PKI_TRUSTED_PROXY_IPS
  // went missing in a later deploy is just as unable to authenticate anyone, and
  // answering 403 here keeps it from reaching the adapter for a vaguer error
  // (ADR-042 §1). The adapter is always constructed now, so its presence says
  // nothing about whether certificate sign-in is on.
  const authConfig = await container.runtimeConfig.getAuthConfig();
  if (!isPkiUsable(authConfig, container.runtimeConfig.isPkiEnvConfigured())) {
    return NextResponse.json({ error: "Certificate sign-in is not enabled." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));
  const sourceIp = extractSourceIp(request);

  const result = await container.pkiCertAdapter.authenticate(request.headers, sourceIp);

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: statusFor(result.error.code) });
  }

  const response = NextResponse.redirect(new URL(redirectTo, request.url), 302);
  const secure = new URL(request.url).protocol === "https:";
  response.cookies.set("better-auth.session_token", result.data.token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  });

  return response;
}

// GET is the method that matters in production: when AUTH_METHOD names PKI,
// middleware.ts answers an unauthenticated page request with a redirect here,
// and the browser follows it with a plain navigation. The mTLS proxy attaches
// the x-ssl-client-* headers to that request exactly as it does to any other, so
// there is nothing for a POST to add.
//
// Minting a session from a GET is safe here precisely because the identity comes
// from headers only the trusted proxy can set — never from ambient credentials
// the browser would attach on its own. A cross-site request cannot forge them,
// and one arriving through the proxy carries its own sender's certificate.
export async function GET(request: Request): Promise<NextResponse> {
  return signInWithCertificate(request);
}

// Kept for callers that drive the exchange directly rather than being redirected
// into it — the mock proxy in mocks/pki/proxy.mjs among them.
export async function POST(request: Request): Promise<NextResponse> {
  return signInWithCertificate(request);
}
