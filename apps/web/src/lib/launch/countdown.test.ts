import { describe, expect, it } from "vitest";
import { countdownUntil } from "./countdown";

describe("countdownUntil", () => {
  it("splits the remaining duration into days, hours, minutes and seconds", () => {
    expect(countdownUntil(200_000_000, 0)).toEqual({ days: 2, hours: 7, minutes: 33, seconds: 20 });
  });

  it("returns null at or after the target", () => {
    expect(countdownUntil(1_000, 1_000)).toBeNull();
    expect(countdownUntil(1_000, 1_001)).toBeNull();
  });

  it("rounds a partial second up so the timer does not expire early", () => {
    expect(countdownUntil(1_999, 1_000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 1 });
  });
});
