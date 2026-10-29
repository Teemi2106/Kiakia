/**
 * The 36 states plus the Federal Capital Territory — the only values
 * `addresses.state` / `vendors.state` should hold. The customer home page
 * filters vendors with a case-insensitive match on this column
 * (lib/recommendations/get-home-recommendations.ts), so a free-typed
 * "Abuja" on a vendor and "FCT" on a customer's address would never match.
 * Every state input picks from this list instead.
 *
 * The FCT is stored as "FCT" — the value the customer address forms already
 * defaulted to — and shown as "FCT (Abuja)".
 */
export const NIGERIAN_STATES = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "FCT",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
] as const;

export type NigerianState = (typeof NIGERIAN_STATES)[number];

/** Alternate spellings people (and geocoders) use, keyed by their normalized form. */
const STATE_ALIASES: Readonly<Record<string, NigerianState>> = {
  abuja: "FCT",
  "federal capital territory": "FCT",
  "abuja fct": "FCT",
  "fct abuja": "FCT",
  "abuja federal capital territory": "FCT",
  nassarawa: "Nasarawa",
  "akwaibom": "Akwa Ibom",
  "cross-river": "Cross River",
};

function normalizeKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bstate\b/g, "")
    .replace(/[().,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CANONICAL_BY_KEY: ReadonlyMap<string, NigerianState> = new Map(
  NIGERIAN_STATES.map((name) => [normalizeKey(name), name]),
);

/**
 * Maps free text ("Lagos State", "abuja", "Federal Capital Territory") to the
 * canonical state, or null when it isn't a Nigerian state. Used on server
 * actions as the trust boundary and on reverse-geocoder output.
 */
export function normalizeNigerianState(raw: string | null | undefined): NigerianState | null {
  if (!raw) return null;
  const key = normalizeKey(raw);
  return CANONICAL_BY_KEY.get(key) ?? STATE_ALIASES[key] ?? null;
}

export function stateLabel(state: string): string {
  return state === "FCT" ? "FCT (Abuja)" : state;
}
