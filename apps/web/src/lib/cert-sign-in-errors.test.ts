import { describe, expect, it } from "vitest";
import { certSignInErrorMessage } from "./cert-sign-in-errors";

describe("certSignInErrorMessage", () => {
  it("explains that the link cannot work without a certificate proxy in front", () => {
    const message = certSignInErrorMessage("no_certificate");

    expect(message).toContain("proxy");
    // The operator's first instinct is that the IP list is wrong; the message
    // has to correct that.
    expect(message).toContain("directly");
  });

  it("names the certificate, not the deployment, when one was rejected", () => {
    expect(certSignInErrorMessage("rejected")).toMatch(/certificate/i);
  });

  it("points a misconfiguration at an administrator", () => {
    expect(certSignInErrorMessage("misconfigured")).toMatch(/administrator/i);
  });

  // A hand-edited URL should render the plain login form, not a broken banner.
  it("ignores an unknown code", () => {
    expect(certSignInErrorMessage("something-else")).toBeNull();
  });

  it("ignores an absent code", () => {
    expect(certSignInErrorMessage(null)).toBeNull();
  });

  // The codes exist so no server-side string is reflected into the page.
  it("never echoes the value it was given", () => {
    expect(certSignInErrorMessage("<script>alert(1)</script>")).toBeNull();
  });
});
