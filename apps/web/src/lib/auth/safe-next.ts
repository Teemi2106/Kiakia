/**
 * The post-login `next` target, accepted only when it is a same-origin path.
 * It arrives from a query string / hidden form field, so anything that could
 * leave the site (protocol-relative or backslash tricks, absolute URLs) or
 * loop back into the auth pages is dropped and the caller falls back to its
 * default.
 */
const SAME_ORIGIN_PATH = /^\/(?![/\\])[^\s\\]*$/;
const AUTH_PAGE = /^\/(login|register|vendor\/login|vendor\/register)(\/|\?|$)/;

export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!SAME_ORIGIN_PATH.test(raw)) return null;
  if (AUTH_PAGE.test(raw)) return null;
  return raw;
}
