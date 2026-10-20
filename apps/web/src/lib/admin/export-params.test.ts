import { describe, expect, it } from "vitest";
import { exportFilename, ledgerExportSchema, ordersExportSchema, rangeBounds } from "./export-params";

const VENDOR = "33333333-3333-4333-8333-333333333333";

describe("date range", () => {
  it("accepts a one-day and a 92-day inclusive range", () => {
    expect(ledgerExportSchema.safeParse({ from: "2026-01-01", to: "2026-01-01" }).success).toBe(true);
    expect(ledgerExportSchema.safeParse({ from: "2026-01-01", to: "2026-04-02" }).success).toBe(true); // 92 days
  });

  it.each([
    [{ from: "2026-01-01", to: "2026-04-03" }, "limited"], // 93 days
    [{ from: "2026-01-31", to: "2026-01-01" }, "before"],
    [{ from: "2026-02-30", to: "2026-03-01" }, "real dates"],
    [{ from: "01/01/2026", to: "2026-01-02" }, "real dates"],
    [{ to: "2026-01-02" }, "from is required"],
    [{ from: "2026-01-02" }, "to is required"],
  ])("rejects %j", (input, message) => {
    const result = ledgerExportSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(message);
  });
});

describe("orders filters", () => {
  const range = { from: "2026-01-01", to: "2026-01-31" };

  it("treats blank status/vendor as absent and accepts valid ones", () => {
    expect(ordersExportSchema.parse({ ...range, status: "", vendorId: " " })).toEqual(range);
    expect(ordersExportSchema.parse({ ...range, status: "delivered", vendorId: VENDOR })).toEqual({ ...range, status: "delivered", vendorId: VENDOR });
  });

  it("rejects an unknown status or malformed vendor id instead of exporting unfiltered", () => {
    expect(ordersExportSchema.safeParse({ ...range, status: "bogus" }).success).toBe(false);
    expect(ordersExportSchema.safeParse({ ...range, vendorId: "nope" }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("bounds are inclusive of the last day in UTC", () => {
    expect(rangeBounds({ from: "2026-01-01", to: "2026-01-31" })).toEqual({
      fromIso: "2026-01-01T00:00:00.000Z",
      toExclusiveIso: "2026-02-01T00:00:00.000Z",
    });
  });

  it("builds a safe filename", () => {
    expect(exportFilename("orders", { from: "2026-01-01", to: "2026-01-31" })).toBe("kiakia-orders-2026-01-01_2026-01-31.csv");
  });
});
