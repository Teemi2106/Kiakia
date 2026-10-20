import { handleLedgerExport } from "@/lib/admin/exports";

// A 92-day export streams many pages; raise the platform's default execution limit (seconds).
export const maxDuration = 300;

// POST only, finance role required (enforced in handleLedgerExport and again in SQL).
export async function POST(request: Request): Promise<Response> {
  return handleLedgerExport(request);
}
