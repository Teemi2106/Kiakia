"use client";

import { installActionResponseBuffer } from "@/lib/client/buffer-action-responses";

// Installed at module evaluation, i.e. when the root layout's client chunk loads
// at hydration, long before anyone can submit a form. Renders nothing.
if (typeof window !== "undefined") installActionResponseBuffer();

export function ActionResponseBuffer() {
  return null;
}
