import { describe, expect, it } from "vitest";
import { orIlike, pageWindow, searchTerm } from "./query";

describe("searchTerm", () => {
  it("strips every character that could alter a PostgREST filter or ilike pattern", () => {
    expect(searchTerm("a,b)(c%_*\"'\\")).toBe("abc");
    expect(searchTerm("x),id.eq.1")).toBe("xid.eq.1");
  });

  it("keeps names, phone numbers and emails searchable", () => {
    expect(searchTerm("  Ada   Obi ")).toBe("Ada Obi");
    expect(searchTerm("+234 801-234")).toBe("+234 801-234");
  });

  it("returns null when nothing searchable remains", () => {
    expect(searchTerm("%%,,")).toBeNull();
    expect(searchTerm(undefined)).toBeNull();
  });

  it("builds an or() expression that cannot gain extra conditions", () => {
    const expression = orIlike(["full_name", "phone"], searchTerm("a,phone.eq.1")!);
    expect(expression.split(",")).toHaveLength(2);
  });
});

describe("pageWindow", () => {
  it("defaults and clamps", () => {
    expect(pageWindow({})).toEqual({ page: 1, pageSize: 25, from: 0, to: 24 });
    expect(pageWindow({ page: 3, pageSize: 10 })).toMatchObject({ from: 20, to: 29 });
    expect(pageWindow({ page: 0, pageSize: 10_000 })).toMatchObject({ page: 1, pageSize: 100 });
    expect(pageWindow({ page: Number.NaN })).toMatchObject({ page: 1 });
  });
});
