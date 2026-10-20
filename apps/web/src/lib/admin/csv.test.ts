import { describe, expect, it } from "vitest";
import { createCsvStream, encodeCsvCell, encodeCsvRow, encodeCsvText } from "./csv";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value, { stream: true });
  }
}

describe("encodeCsvText", () => {
  it("leaves plain text alone", () => {
    expect(encodeCsvText("Mama Put")).toBe("Mama Put");
  });

  it.each([
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["two\nlines", '"two\nlines"'],
    ["cr\rhere", '"cr\rhere"'],
  ])("quotes %j per RFC 4180", (input, expected) => {
    expect(encodeCsvText(input)).toBe(expected);
  });

  it.each(["=SUM(A1)", "+1", "-2+3", "@cmd", "\tx", "\rx"])("neutralises formula trigger %j", (input) => {
    const out = encodeCsvText(input);
    expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("neutralises and quotes when both apply", () => {
    expect(encodeCsvText('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it("does not touch a trigger character that is not first", () => {
    expect(encodeCsvText("a=b")).toBe("a=b");
  });
});

describe("encodeCsvCell / encodeCsvRow", () => {
  it("writes integers bare (negatives are not treated as formulas), null and undefined as empty", () => {
    expect(encodeCsvCell(-500)).toBe("-500");
    expect(encodeCsvCell(0)).toBe("0");
    expect(encodeCsvCell(null)).toBe("");
    expect(encodeCsvCell(undefined)).toBe("");
  });

  it("refuses floats and NaN", () => {
    expect(() => encodeCsvCell(1.5)).toThrow();
    expect(() => encodeCsvCell(Number.NaN)).toThrow();
  });

  it("joins cells with commas and ends with CRLF", () => {
    expect(encodeCsvRow(["a", 1, null, "b,c"])).toBe('a,1,,"b,c"\r\n');
  });
});

describe("createCsvStream", () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }));
  const source = (maxRows?: number, calls: { after: number | null; limit: number }[] = []) => ({
    header: ["id"],
    chunkSize: 3,
    maxRows,
    fetchPage: (after: number | null, limit: number) => {
      calls.push({ after, limit });
      return Promise.resolve(items.filter((item) => after === null || item.id > after).slice(0, limit));
    },
    cursorOf: (item: { id: number }) => item.id,
    toRows: (chunk: readonly { id: number }[]) => Promise.resolve(chunk.map((item) => [item.id])),
  });

  it("writes the header then every row, paging by keyset cursor", async () => {
    const calls: { after: number | null; limit: number }[] = [];
    const csv = await readAll(createCsvStream(source(undefined, calls)));
    expect(csv).toBe("id\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n7\r\n");
    expect(calls).toEqual([
      { after: null, limit: 3 },
      { after: 3, limit: 3 },
      { after: 6, limit: 3 },
    ]);
  });

  it("stops at the row cap and appends a truncation marker only when more rows exist", async () => {
    const csv = await readAll(createCsvStream(source(5)));
    expect(csv.startsWith("id\r\n1\r\n2\r\n3\r\n4\r\n5\r\n")).toBe(true);
    expect(csv).not.toContain("6\r\n");
    expect(csv).toMatch(/# TRUNCATED: row limit of 5 reached[^\r\n]*\r\n$/);
  });

  it("adds no marker when the cap equals the row count", async () => {
    const csv = await readAll(createCsvStream(source(7)));
    expect(csv).toBe("id\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n7\r\n");
  });

  it("emits only the header for an empty range", async () => {
    const csv = await readAll(createCsvStream({ ...source(), fetchPage: () => Promise.resolve([]) }));
    expect(csv).toBe("id\r\n");
  });

  it("errors the stream when a page fails, instead of ending as if complete", async () => {
    const stream = createCsvStream({ ...source(), fetchPage: () => Promise.reject(new Error("db down")) });
    await expect(readAll(stream)).rejects.toThrow("db down");
  });
});
