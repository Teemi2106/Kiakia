import "server-only";
import { z } from "zod";

/**
 * Shared plumbing for the admin read layer: pagination, user-typed search
 * terms, and tolerant filter parsing. Filters arrive from URL search params,
 * so every loader treats an unparseable value as "no filter" rather than
 * letting it reach PostgREST (a malformed uuid there is a 400, and an
 * unescaped search term inside an `.or()` string is a filter injection).
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageParams {
  /** 1-based. */
  readonly page?: number;
  readonly pageSize?: number;
}

export interface Page<T> {
  readonly rows: readonly T[];
  /** Total rows matching the filters, across all pages. */
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** Set by loaders that fetch one extra row; when present it beats `total` for "is there a next page". */
  readonly hasNext?: boolean;
  /** True when `total` is a planner estimate (large tables), so it should be shown as "about N". */
  readonly approximateTotal?: boolean;
}

/** Above this an "estimated" count is the planner's guess rather than an exact count. */
export const ESTIMATE_THRESHOLD = 1000;

export function pageWindow(params: PageParams): { page: number; pageSize: number; from: number; to: number } {
  const page = Number.isInteger(params.page) && params.page! >= 1 ? params.page! : 1;
  const requested = params.pageSize;
  const pageSize =
    Number.isInteger(requested) && requested! >= 1 ? Math.min(requested!, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

/**
 * Reduces free text to characters that are inert inside a PostgREST `.or()`
 * filter and an `ilike` pattern (no commas, parentheses, quotes, `%`, `_` or
 * `*`). Returns null when nothing searchable is left.
 */
export function searchTerm(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[^\p{L}\p{N} +@.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  return cleaned || null;
}

/** The `.or()` expression matching `term` case-insensitively on any of `columns`. */
export function orIlike(columns: readonly string[], term: string): string {
  return columns.map((column) => `${column}.ilike.%${term}%`).join(",");
}

export const optionalUuid = z.string().uuid().optional().catch(undefined);
export const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

export function emptyPage<T>(params: PageParams): Page<T> {
  const { page, pageSize } = pageWindow(params);
  return { rows: [], total: 0, page, pageSize };
}

/** Collapses a `.in()` id list: distinct, non-null. */
export function distinctIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}
