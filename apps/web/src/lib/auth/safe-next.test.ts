import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("accepts same-origin paths, with query strings", () => {
    expect(safeNextPath("/checkout/continue")).toBe("/checkout/continue");
    expect(safeNextPath("/vendors/mama-put?x=1")).toBe("/vendors/mama-put?x=1");
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "checkout",
    "",
    "/a b",
    "/login",
    "/login?next=/home",
    "/register",
    "/vendor/login",
  ])("rejects %j", (value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(["/home"])).toBeNull();
  });
});
