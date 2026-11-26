import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export interface CustomerWalletWithdrawalRow {
  readonly id: string;
  readonly customer_id: string;
  readonly customer_name: string | null;
  readonly amount_kobo: number;
  readonly bank_name: string;
  readonly account_name: string;
  readonly account_number: string;
  readonly masked_account_number: string;
  readonly status: string;
  readonly review_reason: string | null;
  readonly external_reference: string | null;
  readonly created_at: string;
  readonly reviewed_at: string | null;
  readonly total_count: number;
}

export async function listCustomerWalletWithdrawals({
  actorId,
  page,
  pageSize,
}: {
  actorId: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: readonly CustomerWalletWithdrawalRow[]; total: number }> {
  const { data, error } = await createAdminClient().rpc("admin_list_customer_wallet_withdrawals", {
    p_actor_id: actorId,
    p_status: "open",
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });

  if (error) {
    console.error("customer wallet withdrawal list failed", error);
    throw new Error("Could not load customer withdrawal requests.");
  }

  const rows = data ?? [];
  return { rows, total: rows[0]?.total_count ?? 0 };
}
