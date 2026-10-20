/**
 * Buffers every Server Action response in full before Next's router sees it.
 *
 * Why this exists (React 19.2 dropped-ping bug; see e2e/cycle/admin-forms.spec.ts):
 * an action that revalidates answers with a freshly rendered RSC payload, and
 * that payload *streams*: the first row (the action's return value and the tree
 * shape) arrives while the layout and page rows, which wait on their own
 * database reads, are still on the wire. The router commits its new state on
 * the first row, so React starts rendering a tree whose lazy rows are still
 * pending. Each time it throws one it attaches a ping listener, and Flight's
 * `then()` runs that listener *synchronously* when the row has landed in the
 * meantime. React's `pingSuspendedRoot` drops a ping that arrives mid-render
 * while the root's exit status is RootSuspendedWithDelay (it neither restarts
 * the render nor records the lane as pinged, and `markRootSuspended` later
 * clears it). The thenable is already resolved, so nothing ever pings again:
 * the transition never commits, `useActionState` stays pending, the page never
 * re-renders, and the action's form stays disabled and aria-busy until a reload.
 * It only bites when a row lands inside the unlucky render, so it is
 * intermittent in the field and near-deterministic on a fast local network.
 *
 * Handing the router a body that is already complete means every row is
 * resolved before the first render, so nothing throws pending and there is no
 * ping to lose. Server Actions are request/response, not progressive: the
 * client already waits for the whole payload before the page can update, so
 * this costs nothing but the first-row head start.
 *
 * Only Server Action POSTs are touched. Navigations keep streaming (that is
 * what makes loading.tsx and Suspense useful) and every other request passes
 * through untouched.
 */

const ACTION_HEADER = "next-action";
const INSTALLED = Symbol.for("kiakia.actionResponseBuffer");
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** True for the fetch the router makes to run a Server Action (it carries the action id header). */
export function isServerActionRequest(init?: RequestInit | null): boolean {
  const headers = init?.headers;
  if (!headers) return false;
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.has(ACTION_HEADER);
  if (Array.isArray(headers)) return headers.some(([name]) => name.toLowerCase() === ACTION_HEADER);
  return Object.keys(headers).some((name) => name.toLowerCase() === ACTION_HEADER);
}

/** Reads the whole body and returns an equivalent Response that already has all of it. */
export async function bufferResponse(response: Response): Promise<Response> {
  if (!response.body || NULL_BODY_STATUSES.has(response.status)) return response;

  const body = await response.arrayBuffer();
  const buffered = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  // The Response constructor drops these two, and Next reads both when an
  // action redirects.
  Object.defineProperty(buffered, "url", { value: response.url });
  Object.defineProperty(buffered, "redirected", { value: response.redirected });
  return buffered;
}

type FetchHost = { fetch: typeof fetch };

/** Wraps `host.fetch` once (idempotent across hot reloads and repeated imports). */
export function installActionResponseBuffer(host: FetchHost = globalThis as unknown as FetchHost): void {
  const marked = host as unknown as Record<symbol, unknown>;
  if (marked[INSTALLED]) return;
  marked[INSTALLED] = true;

  const original = host.fetch.bind(host);
  host.fetch = async (input, init) => {
    const response = await original(input, init);
    return isServerActionRequest(init) ? bufferResponse(response) : response;
  };
}
