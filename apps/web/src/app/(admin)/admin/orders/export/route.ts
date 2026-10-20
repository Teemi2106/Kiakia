import { handleOrdersExport } from "@/lib/admin/exports";

// A 92-day export streams many pages; raise the platform's default execution limit (seconds).
export const maxDuration = 300;

// POST only: no GET export, so a link or <img> on another site cannot trigger an audited export.
export async function POST(request: Request): Promise<Response> {
  return handleOrdersExport(request);
}
