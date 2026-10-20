import { describe, expect, it, vi } from "vitest";
import { bufferResponse, installActionResponseBuffer, isServerActionRequest } from "./buffer-action-responses";

/** A Response whose body arrives in separate network-sized chunks, the way a streamed RSC payload does. */
function streamed(parts: string[], init: ResponseInit = { status: 200, headers: { "content-type": "text/x-component" } }) {
  const encoder = new TextEncoder();
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled < parts.length) controller.enqueue(encoder.encode(parts[pulled++]));
      else controller.close();
    },
  });
  return new Response(stream, init);
}

describe("isServerActionRequest", () => {
  it("recognises the action id header in every shape fetch accepts", () => {
    expect(isServerActionRequest({ headers: { "Next-Action": "abc" } })).toBe(true);
    expect(isServerActionRequest({ headers: { "next-action": "abc" } })).toBe(true);
    expect(isServerActionRequest({ headers: new Headers({ "next-action": "abc" }) })).toBe(true);
    expect(isServerActionRequest({ headers: [["Next-Action", "abc"]] })).toBe(true);
  });

  it("ignores navigations, prefetches and other requests", () => {
    expect(isServerActionRequest(undefined)).toBe(false);
    expect(isServerActionRequest({})).toBe(false);
    expect(isServerActionRequest({ headers: { RSC: "1", "Next-Router-Prefetch": "1" } })).toBe(false);
    expect(isServerActionRequest({ headers: new Headers({ accept: "application/json" }) })).toBe(false);
  });
});

describe("bufferResponse", () => {
  it("returns a response whose whole body is already available, with status, headers, url and redirected kept", async () => {
    const response = streamed(["0:{}\n", "7:layout\n", "8:page\n"], {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/x-component", "x-action-revalidated": "[[],0,0]" },
    });
    Object.defineProperty(response, "url", { value: "http://localhost/admin/riders/1" });

    const buffered = await bufferResponse(response);

    expect(buffered).not.toBe(response);
    expect(buffered.status).toBe(200);
    expect(buffered.statusText).toBe("OK");
    expect(buffered.headers.get("x-action-revalidated")).toBe("[[],0,0]");
    expect(buffered.url).toBe("http://localhost/admin/riders/1");
    expect(buffered.redirected).toBe(false);

    // One read returns everything: there is no later row left to land mid-render.
    const reader = buffered.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("0:{}\n7:layout\n8:page\n");
    expect((await reader.read()).done).toBe(true);
  });

  it("leaves body-less responses alone", async () => {
    const empty = new Response(null, { status: 204 });
    expect(await bufferResponse(empty)).toBe(empty);
  });
});

describe("installActionResponseBuffer", () => {
  function host(parts: string[]) {
    const original = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => streamed(parts));
    return { fake: { fetch: original as unknown as typeof fetch }, original };
  }

  it("buffers Server Action responses only", async () => {
    const { fake, original } = host(["a", "b", "c"]);
    installActionResponseBuffer(fake);

    const action = await fake.fetch("/admin", { method: "POST", headers: { "Next-Action": "id" } });
    const reader = action.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("abc");

    const navigation = await fake.fetch("/admin", { headers: { RSC: "1" } });
    const navReader = navigation.body!.getReader();
    // Untouched: still arrives chunk by chunk.
    expect(new TextDecoder().decode((await navReader.read()).value)).toBe("a");
    expect(original).toHaveBeenCalledTimes(2);
  });

  it("installs only once however many times it is imported", () => {
    const { fake } = host(["x"]);
    installActionResponseBuffer(fake);
    const wrapped = fake.fetch;
    installActionResponseBuffer(fake);
    expect(fake.fetch).toBe(wrapped);
  });
});
