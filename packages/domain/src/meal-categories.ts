/**
 * Fixed preset categories vendors group their menu items under —
 * `menu_categories.category_key` (0047_preset_meal_categories.sql) is
 * constrained to exactly these keys via a CHECK constraint, so this list is
 * the single source of truth for both the key set and its display label.
 * Vendors used to free-type a category name (one vendor's "Swallow" is
 * another's "Local Foods"); picking from this fixed list instead keeps the
 * label consistent across every vendor's menu.
 */

export interface MealCategoryPreset {
  readonly key: string;
  readonly label: string;
}

export const MEAL_CATEGORIES: readonly MealCategoryPreset[] = [
  { key: "swallow", label: "Swallow" },
  { key: "soups", label: "Soups" },
  { key: "rice_dishes", label: "Rice Dishes" },
  { key: "beans_dishes", label: "Beans Dishes" },
  { key: "pasta_noodles", label: "Pasta & Noodles" },
  { key: "swallow_soup_combos", label: "Swallow & Soup Combos" },
  { key: "proteins_meat", label: "Proteins & Meat" },
  { key: "snacks_small_chops", label: "Snacks & Small Chops" },
  { key: "breakfast", label: "Breakfast" },
  { key: "grills_bbq", label: "Grills & BBQ" },
  { key: "fast_food", label: "Fast Food" },
  { key: "sides", label: "Sides" },
  { key: "drinks", label: "Drinks" },
  { key: "local_specials", label: "Local & Traditional Specials" },
];

const MEAL_CATEGORY_BY_KEY = new Map(MEAL_CATEGORIES.map((c) => [c.key, c]));

export function isMealCategoryKey(key: string): boolean {
  return MEAL_CATEGORY_BY_KEY.has(key);
}

/** Falls back to the raw key on an unrecognized value — should never happen
 * given the DB's CHECK constraint, but keeps this a plain string rather
 * than forcing every call site to handle null for a case the schema already
 * rules out. */
export function mealCategoryLabel(key: string): string {
  return MEAL_CATEGORY_BY_KEY.get(key)?.label ?? key;
}
