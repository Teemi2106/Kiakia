import { describe, expect, it, vi } from "vitest";
import { ok, queryBuilder } from "@/test/supabase-mock";
import { loadProfiles, loadVendorNames, type AdminClient } from "./lookups";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

/** An admin client whose every from() query echoes back one row per requested id. */
function echoClient(toRow: (id: string) => Record<string, unknown>) {
  const inCalls: string[][] = [];
  const from = vi.fn(() => {
    const builder = queryBuilder(ok([] as unknown[]));
    builder.in = vi.fn((_column: string, chunk: string[]) => {
      inCalls.push(chunk);
      return queryBuilder(ok(chunk.map(toRow)));
    });
    return builder;
  });
  return { client: { from } as unknown as AdminClient, inCalls, from };
}

describe("loadVendorNames", () => {
  it("splits more than 100 distinct ids into chunks of at most 100 and merges the results", async () => {
    const { client, inCalls } = echoClient((id) => ({ id, name: `Vendor ${id}` }));

    const names = await loadVendorNames(client, [...ids(250), ...ids(10), null, undefined]);

    expect(inCalls.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(names.size).toBe(250);
    expect(names.get("id-0")).toBe("Vendor id-0");
    expect(names.get("id-249")).toBe("Vendor id-249");
  });

  it("issues a single query for 100 ids and none for no ids", async () => {
    const { client, from } = echoClient((id) => ({ id, name: id }));

    await loadVendorNames(client, ids(100));
    expect(from).toHaveBeenCalledTimes(1);

    await loadVendorNames(client, [null]);
    expect(from).toHaveBeenCalledTimes(1);
  });
});

describe("loadProfiles", () => {
  it("chunks and merges profile lookups too", async () => {
    const { client, inCalls } = echoClient((id) => ({ id, full_name: id, phone: null, status: "active" }));

    const profiles = await loadProfiles(client, ids(101));

    expect(inCalls.map((chunk) => chunk.length)).toEqual([100, 1]);
    expect(profiles.size).toBe(101);
    expect(profiles.get("id-100")).toEqual({ id: "id-100", fullName: "id-100", phone: null, status: "active" });
  });
});
