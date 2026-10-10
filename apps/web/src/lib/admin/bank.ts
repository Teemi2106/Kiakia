export interface BankDetails {
  readonly bankName: string;
  readonly accountName: string;
  /** Last four digits behind a mask, e.g. "******7890". Always safe to render. */
  readonly maskedNumber: string;
  /** Only present when the loader was asked to reveal it, which requires canManageFinance(). */
  readonly fullNumber?: string;
}

/** Last four characters behind a mask, e.g. "******7890". */
export function maskAccountNumber(accountNumber: string): string {
  return `${"*".repeat(Math.max(accountNumber.length - 4, 0))}${accountNumber.slice(-4)}`;
}

/**
 * Masks the account number before it leaves the read layer. The full number is
 * included only when `revealFull` is true; callers pass the result of
 * canManageFinance() and only from detail views, never from list views.
 */
export function toBankDetails(
  bank: { bankName: string | null; accountName: string | null; accountNumber: string | null },
  revealFull: boolean,
): BankDetails | null {
  if (!bank.bankName || !bank.accountName || !bank.accountNumber) return null;
  return {
    bankName: bank.bankName,
    accountName: bank.accountName,
    maskedNumber: maskAccountNumber(bank.accountNumber),
    ...(revealFull ? { fullNumber: bank.accountNumber } : {}),
  };
}
