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

export interface VendorSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly category: string;
  readonly description: string | null;
  readonly bannerUrl: string | null;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly avgPrepMins: number;
  readonly isAcceptingOrders: boolean;
  readonly minOrderKobo: number;
}
