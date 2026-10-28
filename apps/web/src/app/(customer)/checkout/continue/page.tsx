// app/(customer)/checkout/continue/page.tsx
import type { Metadata } from "next";
import { ContinueToCheckout } from "./ContinueToCheckout";

export const metadata: Metadata = { title: "Getting your order ready" };

/**
 * Where a signed-out visitor lands after signing in from the cart. The cart
 * they built before signing in is moved into their account by the client store
 * (a browser-side step), and checkout reads the cart on the server, so going
 * straight to /checkout would render an empty cart. This page waits for that
 * move and then continues to /checkout.
 */
export default function CheckoutContinuePage() {
  return <ContinueToCheckout />;
}
