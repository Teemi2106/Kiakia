import { describe, expect, it } from "vitest";
import { formatLagosDateTime, formatLagosTime, minutesUntil } from "./time";

describe("formatLagosTime", () => {
  it("shows Lagos time (UTC+1) as 24-hour HH:MM", () => {
    expect(formatLagosTime("2026-10-25T15:38:00Z")).toBe("16:38");
    expect(formatLagosTime("2026-10-25T23:05:00Z")).toBe("00:05");
  });
  it("returns null for a missing or invalid value", () => {
    expect(formatLagosTime(null)).toBeNull();
    expect(formatLagosTime(undefined)).toBeNull();
    expect(formatLagosTime("")).toBeNull();
    expect(formatLagosTime("not a date")).toBeNull();
  });
});

describe("formatLagosDateTime", () => {
  it("adds the Lagos day, and rolls the day over at Lagos midnight", () => {
    expect(formatLagosDateTime("2026-10-21T15:38:00Z")).toBe("21 Oct, 16:38");
    expect(formatLagosDateTime("2026-10-21T23:30:00Z")).toBe("22 Oct, 00:30");
  });
  it("returns null for a missing or invalid value", () => {
    expect(formatLagosDateTime(null)).toBeNull();
    expect(formatLagosDateTime("nope")).toBeNull();
  });
});

describe("minutesUntil", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  it("rounds up to whole minutes", () => {
    expect(minutesUntil("2026-10-25T12:07:01Z", now)).toBe(8);
    expect(minutesUntil("2026-10-25T12:07:00Z", now)).toBe(7);
  });
  it("is never negative", () => {
    expect(minutesUntil("2026-10-25T11:00:00Z", now)).toBe(0);
  });
  it("is null when there is no usable time", () => {
    expect(minutesUntil(null, now)).toBeNull();
    expect(minutesUntil("garbage", now)).toBeNull();
  });
});
