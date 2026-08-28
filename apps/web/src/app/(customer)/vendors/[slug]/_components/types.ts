// app/(customer)/vendors/[slug]/_components/types.ts
export interface MenuOption {
  readonly id: string;
  readonly name: string;
  readonly priceDeltaKobo: number;
  readonly isAvailable: boolean;
}

export interface MenuOptionGroup {
  readonly id: string;
  readonly name: string;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly isRequired: boolean;
  readonly options: readonly MenuOption[];
}

export interface MenuItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly priceKobo: number;
  readonly isAvailable: boolean;
  readonly optionGroups: readonly MenuOptionGroup[];
}

export interface MenuCategory {
  readonly id: string;
  readonly name: string;
  readonly items: readonly MenuItem[];
}

/** Mirrors (vendor)/dashboard/settings' DayHours shape — day is 0 (Sunday)
 * .. 6 (Saturday), matching JS Date#getDay(). */
export interface VendorDayHours {
  readonly day: number;
  readonly isOpen: boolean;
  readonly opensAt: string; // "HH:MM"
  readonly closesAt: string;
}

export interface VendorSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly category: string;
  readonly description: string | null;
  readonly bannerUrl: string | null;
  readonly logoUrl: string | null;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly avgPrepMins: number;
  readonly isAcceptingOrders: boolean;
  readonly minOrderKobo: number;
  readonly deliveryRadiusM: number;
  /** null when the vendor hasn't ever saved hours (opening_hours defaults to
   * an empty jsonb object, not a 7-entry array) — render an honest "hours not
   * set" state rather than fabricating a closing time. */
  readonly operatingHours: readonly VendorDayHours[] | null;
}
