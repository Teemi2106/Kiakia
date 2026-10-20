/**
 * CSV encoding for the admin exports. Pure: no I/O, no framework imports.
 *
 * Two jobs beyond RFC 4180 quoting. Cells are untrusted text (vendor names,
 * order codes, references typed by users or partners), and a spreadsheet will
 * evaluate a cell that starts with = + - @ (or a tab / CR that some programs
 * strip before looking at the first character) as a formula, so text cells
 * that start with one of those get a leading apostrophe. Numbers are integers
 * (kobo, counts) and are written bare so a spreadsheet sums them; they never
 * go through the text path, so a negative amount is not mangled.
 */

export type CsvCell = string | number | null | undefined;

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const NEEDS_QUOTING = /[",\r\n]/;

/** Neutralises formula injection, then applies RFC 4180 quoting to one text cell. */
export function encodeCsvText(value: string): string {
  const safe = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  return NEEDS_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function encodeCsvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") {
    // Money and counts are integers; refuse to write a float or NaN into a reconciliation file.
    if (!Number.isSafeInteger(cell)) throw new Error(`CSV numeric cells must be safe integers, got ${cell}`);
    return String(cell);
  }
  return encodeCsvText(cell);
}

/** One CRLF-terminated record. */
export function encodeCsvRow(cells: readonly CsvCell[]): string {
  return `${cells.map(encodeCsvCell).join(",")}\r\n`;
}

export const EXPORT_CHUNK_SIZE = 1000;
export const EXPORT_MAX_ROWS = 100_000;

export interface CsvStreamSource<Item, Cursor> {
  readonly header: readonly string[];
  /** Keyset page: up to `limit` items strictly after `after` (null = from the start), in cursor order. */
  readonly fetchPage: (after: Cursor | null, limit: number) => Promise<readonly Item[]>;
  readonly cursorOf: (item: Item) => Cursor;
  /** Turns one chunk into rows; the place to batch-resolve names for the whole chunk. */
  readonly toRows: (items: readonly Item[]) => Promise<readonly (readonly CsvCell[])[]>;
  readonly chunkSize?: number;
  readonly maxRows?: number;
}

/**
 * Streams a CSV one keyset chunk at a time, so memory is bounded by the chunk
 * size whatever the range holds. At `maxRows` it probes for one more row; if one
 * exists the file ends with a single-column "# TRUNCATED" line (headers cannot
 * be changed once the body has started). A failure mid-stream errors the stream,
 * so the client sees a broken download rather than a file that looks complete.
 */
export function createCsvStream<Item, Cursor>(source: CsvStreamSource<Item, Cursor>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunkSize = source.chunkSize ?? EXPORT_CHUNK_SIZE;
  const maxRows = source.maxRows ?? EXPORT_MAX_ROWS;
  let cursor: Cursor | null = null;
  let emitted = 0;
  let started = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(encoder.encode(encodeCsvRow(source.header)));
          return;
        }
        // One past the cap on the last chunk, purely to learn whether anything was cut off.
        const want = Math.min(chunkSize, maxRows - emitted + 1);
        const items = await source.fetchPage(cursor, want);
        const room = maxRows - emitted;
        const kept = items.length > room ? items.slice(0, room) : items;

        if (kept.length > 0) {
          const rows = await source.toRows(kept);
          controller.enqueue(encoder.encode(rows.map(encodeCsvRow).join("")));
          emitted += kept.length;
          cursor = source.cursorOf(kept[kept.length - 1] as Item);
        }

        if (items.length > room) {
          controller.enqueue(encoder.encode(encodeCsvText(`# TRUNCATED: row limit of ${maxRows} reached; narrow the date range`) + "\r\n"));
          controller.close();
        } else if (items.length < want) {
          controller.close();
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
