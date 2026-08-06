import { vi } from "vitest";

/**
 * Next.js's real `redirect`/`notFound` work by throwing a special digest-
 * tagged error that the framework's rendering layer catches — calling them
 * outside a request context (i.e. under Vitest) throws an unrelated
 * "invariant" error instead. Stand-ins here throw a recognizable,
 * assertable error so action tests can do
 * `await expect(fn()).rejects.toThrow("NEXT_REDIRECT:/login")`.
 */
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
