import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the session-cookie handoff in proxy.ts.
 *
 * The bug these pin down: when Supabase rotates the session (any request
 * where `setAll` fires), the browser was sent the NEW cookies while the
 * Server Components render was forwarded the OLD ones. The render then
 * authenticated with an already-rotated refresh token, failed, and
 * redirected to /login — where the (auth) layout saw the browser's valid
 * new cookies and redirected straight back to /home. That is an unbreakable
 * /home <-> /login loop, and it is what "the page just keeps loading" was.
 *
 * `NextResponse.next({ request: { headers } })` encodes the headers the
 * renderer will see into `x-middleware-override-headers` plus one
 * `x-middleware-request-<name>` per header, so those are what the forwarded
 * cookie state is asserted against here.
 */

let capturedSetAll: ((c: { name: string; value: string; options: object }[]) => void) | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: { name: string; value: string; options: object }[]) => void } },
  ) => {
    capturedSetAll = opts.cookies.setAll;
    return {
      auth: {
        getUser: async () => {
          // What a real token rotation does: hand back new cookies, then
          // report the (still valid) user.
          opts.cookies.setAll([
            { name: "sb-test-auth-token", value: "NEW_VALUE", options: { path: "/" } },
          ]);
          return { data: { user: { id: "user-1" } }, error: null };
        },
      },
    };
  },
}));

function forwardedRequestCookie(response: Response): string | null {
  return response.headers.get("x-middleware-request-cookie");
}

describe("proxy session cookie handoff", () => {
  beforeEach(() => {
    capturedSetAll = null;
    vi.resetModules();
  });

  it("forwards the rotated cookie to the render, not the stale one", async () => {
    const { proxy } = await import("./proxy");

    const request = new NextRequest("https://kiakia.test/home", {
      headers: { cookie: "sb-test-auth-token=OLD_VALUE" },
    });

    const response = await proxy(request);

    expect(capturedSetAll).not.toBeNull();

    // The browser is told about the rotation...
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("NEW_VALUE");

    // ...and so is the renderer. Before the fix this still said OLD_VALUE,
    // so the render authenticated with a refresh token Supabase had just
    // invalidated.
    expect(forwardedRequestCookie(response)).toContain("NEW_VALUE");
    expect(forwardedRequestCookie(response)).not.toContain("OLD_VALUE");
  });

  it("still forwards the nonce header the CSP is built around", async () => {
    const { proxy } = await import("./proxy");

    const request = new NextRequest("https://kiakia.test/home", {
      headers: { cookie: "sb-test-auth-token=OLD_VALUE" },
    });

    const response = await proxy(request);

    const nonce = response.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toBeTruthy();
    // The same nonce must appear in the CSP, or nothing it guards can run.
    expect(response.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
  });

  it("leaves an unauthenticated request to a public route alone", async () => {
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      }),
    }));
    const { proxy } = await import("./proxy");

    const response = await proxy(new NextRequest("https://kiakia.test/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
