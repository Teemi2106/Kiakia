import { describe, expect, it } from "vitest";
import { findContainingServiceArea, isPointInPolygon } from "./service-area";

// A synthetic 1x1 square, not real Jabi-Utako coordinates — the real
// corridor polygon lives only in supabase/seed.sql once surveyed per §15's
// validation gate. This proves the containment algorithm, not the launch
// geography.
const square = [
  { lng: 0, lat: 0 },
  { lng: 1, lat: 0 },
  { lng: 1, lat: 1 },
  { lng: 0, lat: 1 },
];

describe("isPointInPolygon", () => {
  it("returns true for a point inside the polygon", () => {
    expect(isPointInPolygon({ lng: 0.5, lat: 0.5 }, square)).toBe(true);
  });

  it("returns false for a point outside the polygon", () => {
    expect(isPointInPolygon({ lng: 2, lat: 2 }, square)).toBe(false);
  });

  it("returns false for a degenerate ring", () => {
    expect(isPointInPolygon({ lng: 0, lat: 0 }, [{ lng: 0, lat: 0 }])).toBe(false);
  });
});

describe("findContainingServiceArea", () => {
  const areas = [
    { id: "1", name: "Jabi-Utako", polygon: square, isActive: true },
    {
      id: "2",
      name: "Inactive area covering everything",
      polygon: [
        { lng: -10, lat: -10 },
        { lng: 10, lat: -10 },
        { lng: 10, lat: 10 },
        { lng: -10, lat: 10 },
      ],
      isActive: false,
    },
  ];

  it("finds the active area containing the point", () => {
    expect(findContainingServiceArea({ lng: 0.5, lat: 0.5 }, areas)?.id).toBe("1");
  });

  it("skips inactive areas even if they geometrically contain the point", () => {
    expect(findContainingServiceArea({ lng: 5, lat: 5 }, areas)).toBeNull();
  });

  it("returns null when no active area contains the point", () => {
    expect(findContainingServiceArea({ lng: 50, lat: 50 }, areas)).toBeNull();
  });
});
