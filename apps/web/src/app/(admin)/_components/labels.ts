import { humanize } from "./format";

/** Plain-language names for the roles an account can hold. */
const ROLE_LABELS: Record<string, string> = {
  customer: "Customer",
  rider: "Rider",
  vendor_owner: "Vendor owner",
  vendor_manager: "Vendor manager",
  vendor_staff: "Vendor staff",
  admin: "Admin",
  superadmin: "Superadmin",
  finance: "Finance admin",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? humanize(role);
}

/** What each audit-log action means, as a short past-tense phrase. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "vendor.approve": "Approved a vendor",
  "vendor.reject": "Suspended or rejected a vendor",
  "vendor.set_commission": "Changed a vendor's commission",
  "rider.approve": "Approved a rider",
  "rider.reject": "Rejected a rider",
  "rider_document.approve": "Approved a rider's document",
  "rider_document.reject": "Rejected a rider's document",
  "user.suspend": "Suspended an account",
  "user.reinstate": "Reinstated an account",
  "user.grant_role": "Gave an account a role",
  "user.revoke_role": "Removed a role from an account",
  "payout.record": "Marked a payout as paid",
  "order.refund_escrow": "Refunded an order",
  "order.request_gateway_refund": "Retried a card refund",
  "order.reset_delivery_code_attempts": "Reset delivery code attempts",
  "order.reassign_rider": "Changed the rider on an order",
  "service_area.update": "Changed delivery fees for an area",
  "platform_fee.set": "Changed a platform fee",
  "export.orders": "Downloaded the orders list",
  "export.ledger": "Downloaded the money records",
};

export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABELS);

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? humanize(action);
}

const AUDIT_TARGET_LABELS: Record<string, string> = {
  user: "Account",
  vendor: "Vendor",
  rider: "Rider",
  rider_document: "Rider document",
  order: "Order",
  service_area: "Delivery area",
  export: "Download",
  platform_setting: "Platform fee",
};

export function auditTargetLabel(type: string): string {
  return AUDIT_TARGET_LABELS[type] ?? humanize(type);
}

/** Short names for the payment problems recorded when a payment is captured. */
export const ANOMALY_LABELS = {
  amount_mismatch: "Wrong amount paid",
  underpaid_capture: "Paid too little",
  duplicate_capture: "Paid twice",
} as const;

const ACCOUNT_LABELS: Record<string, string> = {
  "platform:escrow": "Money held until delivery",
  "platform:gateway": "Payment gateway (Monnify)",
  "platform:revenue": "KiaKia earnings",
  "vendor:available": "Vendor's balance",
  "rider:available": "Rider's balance",
  "vendor:pending_payout": "Vendor's pending balance",
  "rider:pending_payout": "Rider's pending balance",
  "customer:wallet": "Customer's wallet",
};

/** "platform:escrow" -> "Money held until delivery". */
export function accountLabel(account: string): string {
  return ACCOUNT_LABELS[account] ?? humanize(account.replace(":", " "));
}

/** What the money did in a ledger entry, for the order's money records. */
const TRANSACTION_KIND_LABELS: Record<string, string> = {
  payment_capture: "Customer payment received",
  escrow_release: "Order paid out after delivery",
  refund: "Refund",
  payout: "Payout to vendor or rider",
  adjustment: "Adjustment",
};

export function transactionKindLabel(kind: string): string {
  return TRANSACTION_KIND_LABELS[kind] ?? humanize(kind);
}
