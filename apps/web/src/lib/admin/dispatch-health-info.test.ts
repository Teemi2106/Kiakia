import { afterEach, describe, expect, it, vi } from "vitest";
import { formatAgo, nextStepFor, readDispatchHealth } from "./dispatch-health-info";

afterEach(() => vi.useRealTimers());

describe("formatAgo", () => {
  it("speaks in minutes and hours", () => {
    expect(formatAgo(10)).toBe("just now");
    expect(formatAgo(60)).toBe("1 minute ago");
    expect(formatAgo(240)).toBe("4 minutes ago");
    expect(formatAgo(3900)).toBe("1 hour 5 minutes ago");
    expect(formatAgo(7200)).toBe("2 hours ago");
  });
});

describe("nextStepFor", () => {
  it("suggests a step for the known problems", () => {
    expect(nextStepFor("The dispatch timer is not running")).toBe("Ask your developer to check the scheduler (pg_cron).");
    expect(nextStepFor("Rider push notifications are not configured")).toContain("not set up yet");
    expect(nextStepFor("Something else")).toBeNull();
  });
});

describe("readDispatchHealth", () => {
  it("is unknown for anything unreadable", () => {
    for (const raw of [null, undefined, "x", 3, [], {}, { healthy: "yes" }]) expect(readDispatchHealth(raw)).toEqual({ state: "unknown" });
  });

  it("reads a healthy answer and says when it last ran", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T12:04:00Z"));
    expect(readDispatchHealth({ healthy: true, problems: [], tick_last_run_at: "2026-10-26T12:00:00Z" })).toMatchObject({
      state: "healthy",
      lastRanSecondsAgo: 240,
      lastRanText: "It last ran 4 minutes ago.",
      problems: [],
    });
  });

  it("lists problems with a next step each", () => {
    const health = readDispatchHealth({
      healthy: false,
      tick_last_run_at: null,
      problems: ["The dispatch timer is not running.", "Rider push notifications are not configured.", 7],
    });
    expect(health).toMatchObject({ state: "unhealthy", lastRanText: "It has not run yet." });
    if (health.state !== "unknown") {
      expect(health.problems.map((problem) => problem.nextStep)).toEqual([
        "Ask your developer to check the scheduler (pg_cron).",
        "Rider push and text alerts are not set up yet. Ask your developer to finish setting them up.",
      ]);
    }
  });

  it("never shows an empty red banner", () => {
    const health = readDispatchHealth({ healthy: false, problems: [], tick_job_present: false });
    expect(health.state === "unhealthy" && health.problems).toHaveLength(1);
  });
});
