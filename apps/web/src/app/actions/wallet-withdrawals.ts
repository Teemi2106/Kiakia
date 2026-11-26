"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveRole } from "@/lib/auth/active-role";
import { requireActiveAccount, verifySession } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export interface WalletWithdrawalState {
  readonly error?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function requestWalletWithdrawalAction(
  _previousState: WalletWithdrawalState,
  formData: FormData,
): Promise<WalletWithdrawalState> {
  const session = await verifySession();
  await requireActiveAccount();
  if ((await getActiveRole()) === "vendor") redirect("/dashboard");

  const rawAmount = String(formData.get("amountNaira") ?? "").trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(rawAmount)) {
    return { error: "Enter an amount in naira, with up to two decimal places." };
  }
  const [whole, fraction = ""] = rawAmount.split(".");
  const amountKobo = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    return { error: "Enter an amount greater than zero." };
  }

  const requestKey = String(formData.get("requestKey") ?? "");
  if (!UUID_PATTERN.test(requestKey)) {
    return { error: "Refresh the wallet page and try again." };
  }

  const bankName = String(formData.get("bankName") ?? "").trim();
  const accountName = String(formData.get("accountName") ?? "").trim();
  const accountNumber = String(formData.get("accountNumber") ?? "").trim();
  if (!bankName || !accountName || !/^\d{10}$/.test(accountNumber)) {
    return { error: "Enter a bank name, account holder name, and 10-digit account number." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_customer_wallet_withdrawal", {
    p_amount_kobo: amountKobo,
    p_bank_name: bankName,
    p_account_name: accountName,
    p_account_number: accountNumber,
    p_idempotency_key: requestKey,
  });

  if (error) {
    if (error.message.includes("higher than the available")) {
      return { error: "That is more than your available wallet balance. Refresh and enter a smaller amount." };
    }
    if (error.code === "check_violation") {
      return { error: "Check the amount and bank details, then try again." };
    }
    return { error: "We couldn't submit the withdrawal request. Please try again." };
  }

  revalidatePath("/profile/wallet");
  revalidatePath("/profile");
  redirect("/profile/wallet?withdrawal=requested");
}

export async function cancelWalletWithdrawalAction(
  _previousState: WalletWithdrawalState,
  formData: FormData,
): Promise<WalletWithdrawalState> {
  await verifySession();
  await requireActiveAccount();
  if ((await getActiveRole()) === "vendor") redirect("/dashboard");

  const requestId = String(formData.get("requestId") ?? "");
  if (!UUID_PATTERN.test(requestId)) {
    return { error: "Refresh the wallet page and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_my_wallet_withdrawal", { p_request_id: requestId });
  if (error) {
    return { error: "This request can no longer be cancelled. Refresh to see its latest status." };
  }

  revalidatePath("/profile/wallet");
  redirect("/profile/wallet?withdrawal=cancelled");
}
