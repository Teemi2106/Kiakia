"use server";

import { getActiveRole } from "@/lib/auth/active-role";
import { requireActiveAccount, verifySession } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { initializeTransaction } from "@/lib/monnify";
import { serverEnv } from "@/lib/env.server";
import { redirect } from "next/navigation";

export interface WalletTopUpState {
  readonly error?: string;
}

const MIN_TOP_UP_NAIRA = 100;
const MAX_TOP_UP_NAIRA = 500_000;

export async function startWalletTopUpAction(
  _previousState: WalletTopUpState,
  formData: FormData,
): Promise<WalletTopUpState> {
  const session = await verifySession();
  await requireActiveAccount();

  if ((await getActiveRole()) === "vendor") {
    redirect("/dashboard");
  }

  const rawAmount = String(formData.get("amountNaira") ?? "").trim();
  if (!/^\d+$/.test(rawAmount)) {
    return { error: "Enter a whole naira amount." };
  }

  const amountNaira = Number(rawAmount);
  if (!Number.isSafeInteger(amountNaira) || amountNaira < MIN_TOP_UP_NAIRA || amountNaira > MAX_TOP_UP_NAIRA) {
    return { error: `Add between ₦${MIN_TOP_UP_NAIRA.toLocaleString("en-NG")} and ₦${MAX_TOP_UP_NAIRA.toLocaleString("en-NG")} per top-up.` };
  }

  if (!session.email) {
    return { error: "Add a confirmed email address to your account before funding your wallet." };
  }

  const admin = createAdminClient();
  const [{ data: profile }, { data: topup, error: insertError }] = await Promise.all([
    admin.from("profiles").select("full_name").eq("id", session.userId).maybeSingle(),
    admin
      .from("wallet_topups")
      .insert({
        reference: `KKW-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`,
        customer_id: session.userId,
        amount_kobo: amountNaira * 100,
      })
      .select("id, reference")
      .single(),
  ]);

  if (insertError || !topup) {
    console.error("wallet top-up create failed", insertError);
    return { error: "We couldn't start this wallet top-up. Please try again." };
  }

  let checkoutUrl: string;
  let transactionReference: string;
  try {
    const transaction = await initializeTransaction({
      amountKobo: amountNaira * 100,
      paymentReference: topup.reference,
      paymentDescription: `KiaKia wallet top-up ${topup.reference}`,
      customerName: profile?.full_name ?? "KiaKia Customer",
      customerEmail: session.email,
      redirectUrl: `${serverEnv.MONNIFY_REDIRECT_BASE_URL ?? serverEnv.NEXT_PUBLIC_SITE_URL}/profile/wallet?topup=${encodeURIComponent(topup.reference)}`,
    });
    checkoutUrl = transaction.checkoutUrl;
    transactionReference = transaction.transactionReference;
  } catch (error) {
    console.error("Monnify wallet top-up initialization failed", error);
    await admin.from("wallet_topups").update({ status: "failed" }).eq("id", topup.id).eq("status", "pending");
    return { error: "We couldn't connect to the payment provider. Your wallet has not been charged; please try again." };
  }

  const { error: updateError } = await admin
    .from("wallet_topups")
    .update({ provider_ref: transactionReference })
    .eq("id", topup.id)
    .eq("status", "pending");

  if (updateError) {
    console.error("wallet top-up reference save failed", updateError);
    return { error: "We couldn't prepare the payment safely. Your wallet has not been charged; please start a new top-up." };
  }

  redirect(checkoutUrl);
}
