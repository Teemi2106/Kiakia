import { describe, expect, it } from "vitest";
import { uuidv7 } from "./uuid";

describe("uuidv7", () => {
  it("is a valid version-7 UUID", () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("sorts by creation time, which is how customer_bootstrap() orders cart lines", () => {
    const ids = [1_700_000_000_000, 1_700_000_000_001, 1_700_000_065_536, 1_800_000_000_000].map((t) => uuidv7(t));
    expect([...ids].sort()).toEqual(ids);
  });
});
