/**
 * All money in KiaKia is a whole number of kobo (1/100 naira). See
 * kiakia-system-architecture.md §9 ("All money is BIGINT kobo") and §5.5 of
 * the shareholder doc. Never introduce a float or a decimal-naira value —
 * rounding error in a ledger is a silent, compounding bug that surfaces as
 * an unexplainable balance discrepancy months later.
 *
 * `Kobo` is a branded integer so a raw `number` (e.g. a naira value typed
 * by mistake) cannot be passed where a kobo amount is expected without an
 * explicit `toKobo()`/`koboOf()` call.
 */

declare const KoboBrand: unique symbol;
export type Kobo = number & { readonly [KoboBrand]: true };

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

/** Asserts `value` is a non-negative safe integer and brands it as Kobo. */
export function koboOf(value: number): Kobo {
  if (!Number.isInteger(value)) {
    throw new InvalidMoneyError(`Kobo amount must be an integer, got ${value}`);
  }
  if (value < 0) {
    throw new InvalidMoneyError(`Kobo amount must not be negative, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new InvalidMoneyError(`Kobo amount exceeds safe integer range: ${value}`);
  }
  return value as Kobo;
}

export const ZERO_KOBO = koboOf(0);

/** Converts a naira amount (e.g. from a form input) to kobo. */
export function nairaToKobo(naira: number): Kobo {
  if (!Number.isFinite(naira)) {
    throw new InvalidMoneyError(`Naira amount must be finite, got ${naira}`);
  }
  return koboOf(Math.round(naira * 100));
}

/** Converts kobo to a naira number for display/math outside money contexts. */
export function koboToNaira(kobo: Kobo): number {
  return kobo / 100;
}

export function addKobo(...amounts: readonly Kobo[]): Kobo {
  return koboOf(amounts.reduce<number>((sum, amount) => sum + amount, 0));
}

/**
 * Subtracts `subtrahend` from `minuend`. Throws rather than returning a
 * negative Kobo — callers that expect a possibly-negative delta (e.g. a
 * ledger adjustment) should work in signed integers explicitly, not Kobo.
 */
export function subtractKobo(minuend: Kobo, subtrahend: Kobo): Kobo {
  return koboOf(minuend - subtrahend);
}

/**
 * Applies a basis-points rate (1 bps = 0.01%) to a Kobo amount, rounding
 * half-up to the nearest kobo. Used for commission (`vendors.commission_bps`)
 * and similar percentage-of-amount computations.
 */
export function applyBps(amount: Kobo, bps: number): Kobo {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new InvalidMoneyError(`bps must be an integer in [0, 10000], got ${bps}`);
  }
  return koboOf(Math.round((amount * bps) / 10_000));
}

const NAIRA_FORMATTER = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  currencyDisplay: "narrowSymbol",
});

/** Formats a Kobo amount as a Naira display string, e.g. koboOf(1250000) -> "₦12,500.00". */
export function formatNaira(kobo: Kobo): string {
  return NAIRA_FORMATTER.format(koboToNaira(kobo));
}
