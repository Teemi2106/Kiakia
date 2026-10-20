import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertLocalStack, cycleEnv, cycleUsers } from "./cycle-env";

/**
 * supabase-js helpers for the full-cycle spec. Everything here talks to the
 * throwaway local stack (assertLocalStack() runs before any client is built).
 *
 * Two kinds of client:
 *  - serviceClient(): the service-role key. Used ONLY for bootstrap (creating
 *    the superadmin) and for reading back ground truth (ledger, payments,
 *    notifications) to assert on. It is never used to drive the flow itself.
 *  - signIn(): a real password sign-in, so every action under test runs
 *    through the same RLS / SECURITY DEFINER checks the production apps hit.
 *    The rider app is a separate repo; signing in here and calling its RPCs
 *    with supabase-js is exactly what it does.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, "public", any>;

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export function serviceClient(): Db {
  assertLocalStack();
  return createClient(cycleEnv.supabaseUrl, cycleEnv.serviceKey, noPersist);
}

export function anonClient(): Db {
  assertLocalStack();
  return createClient(cycleEnv.supabaseUrl, cycleEnv.anonKey, noPersist);
}

export interface Signed {
  readonly db: Db;
  readonly userId: string;
}

export async function signIn(email: string, password: string = cycleUsers.password): Promise<Signed> {
  const db = anonClient();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return { db, userId: data.user.id };
}

/**
 * Unwraps a supabase-js result, turning an error into a thrown, descriptive one.
 * Returns `any` on purpose: the client is untyped (no generated schema here) and
 * the specs assert on the shapes they care about.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ok(result: { data: unknown; error: { message: string } | null }, what: string): any {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

// ---------------------------------------------------------------- bootstrap

/**
 * Creates the superadmin the admin UI steps log in as. There is no signup path
 * for a platform role by design (roles are granted by a superadmin or by SQL),
 * so the very first one has to be bootstrapped with the service role - the
 * local-stack equivalent of the manual SQL a real launch uses.
 */
export async function bootstrapSuperadmin(): Promise<string> {
  const svc = serviceClient();
  const { email, fullName, phone } = cycleUsers.admin;
  const created = await svc.auth.admin.createUser({
    email,
    password: cycleUsers.password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
  });
  if (created.error || !created.data.user) throw new Error(`createUser(admin): ${created.error?.message}`);
  const userId = created.data.user.id;
  ok(await svc.from("user_roles").insert({ user_id: userId, role: "superadmin" }), "grant superadmin");
  return userId;
}

/** Fails fast, with a pointer to the cause, if the stack was not seeded (supabase/seed.sql). */
export async function assertStackSeeded(): Promise<void> {
  const svc = serviceClient();
  const areas = ok(await svc.from("service_areas").select("id").eq("is_active", true), "service_areas");
  if (areas.length === 0) throw new Error("No active service area - was supabase/seed.sql applied to the e2e stack?");
  const accounts = ok(await svc.from("accounts").select("kind").eq("owner_type", "platform"), "platform accounts");
  const kinds = new Set(accounts.map((a: { kind: string }) => a.kind));
  for (const kind of ["escrow", "gateway", "revenue"]) {
    if (!kinds.has(kind)) throw new Error(`Platform "${kind}" ledger account is not seeded (migrations incomplete?)`);
  }
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * What the (separate-repo) rider app does at onboarding: sign up, register_rider,
 * upload the three KYC documents into the private rider-kyc bucket under the
 * rider's own folder, and submit each with submit_rider_document.
 */
export async function registerRiderLikeTheApp(user: { email: string; fullName: string; phone: string }): Promise<Signed> {
  const db = anonClient();
  const signUp = await db.auth.signUp({
    email: user.email,
    password: cycleUsers.password,
    options: { data: { full_name: user.fullName, phone: user.phone } },
  });
  if (signUp.error || !signUp.data.user || !signUp.data.session) {
    throw new Error(`rider signUp failed (is email confirmation off on the local stack?): ${signUp.error?.message}`);
  }
  const userId = signUp.data.user.id;

  ok(await db.rpc("register_rider", { p_vehicle_type: "motorcycle", p_plate_number: `E2E-${cycleUsers.runId.slice(-4).toUpperCase()}` }), "register_rider");

  for (const docType of ["government_id", "drivers_license", "vehicle_photo"] as const) {
    const path = `${userId}/${docType}.png`;
    const upload = await db.storage.from("rider-kyc").upload(path, TINY_PNG, { contentType: "image/png", upsert: true });
    if (upload.error) throw new Error(`upload ${docType}: ${upload.error.message}`);
    ok(await db.rpc("submit_rider_document", { p_doc_type: docType, p_storage_path: path }), `submit_rider_document(${docType})`);
  }
  return { db, userId };
}

// ------------------------------------------------------------------- ledger

export interface LedgerRow {
  readonly transaction_id: string;
  readonly direction: "debit" | "credit";
  readonly amount_kobo: number;
  readonly entry_type: string;
  readonly accounts: { owner_type: string; owner_id: string | null; kind: string };
}

export async function ledgerFor(orderId: string): Promise<LedgerRow[]> {
  const svc = serviceClient();
  return ok(
    await svc.from("ledger_entries").select("transaction_id, direction, amount_kobo, entry_type, accounts(owner_type, owner_id, kind)").eq("order_id", orderId),
    "ledger_entries",
  ) as unknown as LedgerRow[];
}

/** Credit-minus-debit for one account across one order's entries of the given types. */
export function netFor(
  rows: readonly LedgerRow[],
  match: { ownerType: string; kind: string; ownerId?: string | null },
  entryTypes?: readonly string[],
): number {
  return rows
    .filter(
      (r) =>
        r.accounts.owner_type === match.ownerType &&
        r.accounts.kind === match.kind &&
        (match.ownerId === undefined || r.accounts.owner_id === match.ownerId) &&
        (!entryTypes || entryTypes.includes(r.entry_type)),
    )
    .reduce((sum, r) => sum + (r.direction === "credit" ? r.amount_kobo : -r.amount_kobo), 0);
}

/** Every transaction's debits must equal its credits; returns the offending transaction ids. */
export function unbalancedTransactions(rows: readonly LedgerRow[]): string[] {
  const net = new Map<string, number>();
  for (const r of rows) net.set(r.transaction_id, (net.get(r.transaction_id) ?? 0) + (r.direction === "credit" ? r.amount_kobo : -r.amount_kobo));
  return [...net.entries()].filter(([, v]) => v !== 0).map(([id]) => id);
}

export async function accountBalanceKobo(ownerType: "vendor" | "rider", ownerId: string): Promise<number> {
  const svc = serviceClient();
  const acct = ok(await svc.from("accounts").select("id").eq("owner_type", ownerType).eq("owner_id", ownerId).eq("kind", "available").maybeSingle(), "account");
  if (!acct) return 0;
  const entries = ok(await svc.from("ledger_entries").select("direction, amount_kobo").eq("account_id", acct.id), "entries") as Array<{ direction: string; amount_kobo: number }>;
  return entries.reduce((s, e) => s + (e.direction === "credit" ? e.amount_kobo : -e.amount_kobo), 0);
}

export async function orderByCode(code: string) {
  const svc = serviceClient();
  return ok(await svc.from("orders").select("*").eq("code", code).single(), `order ${code}`);
}

export async function latestOrderForCustomer(customerId: string) {
  const svc = serviceClient();
  const rows = ok(await svc.from("orders").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(1), "orders");
  return rows[0] ?? null;
}

// ------------------------------------------------------ extra orders (API)

/**
 * Builds a draft order the way the checkout does, but over the API as the
 * customer: open cart -> cart line -> place_order(). Used for the side orders
 * of the failure-path steps (wrong amount, refunds) where the UI is already
 * proven by the main order. Everything is priced by place_order() server-side;
 * the cart line's own prices are display snapshots, as in the app.
 */
export async function createDraftOrderViaApi(
  customer: Signed,
  opts: { vendorId: string; menuItemId: string; qty?: number; at: { latitude: number; longitude: number } },
): Promise<{ id: string; code: string; total_kobo: number; subtotal_kobo: number }> {
  const svc = serviceClient();
  const item = ok(await svc.from("menu_items").select("id, name, price_kobo").eq("id", opts.menuItemId).single(), "menu item");
  const qty = opts.qty ?? 1;
  // One open cart per customer: abandon whatever is open (same as the store does on a vendor switch).
  ok(await customer.db.from("carts").update({ status: "abandoned" }).eq("customer_id", customer.userId).eq("status", "open"), "abandon carts");
  const cart = ok(
    await customer.db.from("carts").insert({ customer_id: customer.userId, vendor_id: opts.vendorId, status: "open" }).select("id").single(),
    "cart",
  );
  ok(
    await customer.db.from("cart_items").insert({
      cart_id: cart.id,
      menu_item_id: item.id,
      name_snapshot: item.name,
      unit_price_kobo: item.price_kobo,
      qty,
      options_snapshot: [],
      line_total_kobo: item.price_kobo * qty,
    }),
    "cart line",
  );
  const order = ok(
    await customer.db.rpc("place_order", {
      p_cart_id: cart.id,
      p_delivery_address: { line1: "2 Side Order Street", landmark: null, city: "Abuja", state: "FCT" },
      p_delivery_location: `POINT(${opts.at.longitude} ${opts.at.latitude})`,
      p_delivery_note: null,
    }),
    "place_order",
  ) as { id: string; code: string; total_kobo: number; subtotal_kobo: number };
  return order;
}

/**
 * Mimics initializePaymentForOrder() for a side order: tells the mock Monnify
 * about the transaction and writes the 'pending' payments row the real
 * checkout writes with the admin client. Returns the Monnify reference.
 */
export async function initPendingPayment(
  order: { id: string; code: string; total_kobo: number },
  setMock: (input: { paymentReference: string; paymentStatus?: "PENDING" }) => Promise<{ transactionReference: string }>,
): Promise<string> {
  const { transactionReference } = await setMock({ paymentReference: order.code, paymentStatus: "PENDING" });
  ok(
    await serviceClient().from("payments").insert({
      order_id: order.id,
      provider: "monnify",
      provider_ref: transactionReference,
      amount_kobo: order.total_kobo,
      status: "pending",
      idempotency_key: order.code,
    }),
    "payments row",
  );
  return transactionReference;
}
