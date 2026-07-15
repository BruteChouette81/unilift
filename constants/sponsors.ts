// ─── Sponsors (Firestore-backed) ─────────────────────────────────────────────
// A paying partner business shown on the home map with its brand logo. Admins
// add documents directly in the Firebase console (or via the seed script). The
// `tier` (gold/silver/bronze) drives the marker size, glow-ring colour, z-order
// and a "Featured" badge — higher tier = more map visibility.
//
// Firestore `sponsors/{id}` document shape:
//   name          string    (required)
//   category      string    (required — "fast-food" | "cafe" | "bar" | "store" | ...)
//   location      geoPoint  (required — { latitude, longitude })
//   tier          string    (required — "gold" | "silver" | "bronze")
//   logoUrl       string    (optional — remote brand logo; omit → category Ionicon)
//   brandColor    string    (optional — hex for ring/accents, e.g. "#FFC72C")
//   address       string    (optional — display line in the modal)
//   tagline       string    (optional — short eyebrow, e.g. "Open till 3 AM")
//   offers        array     (optional — each { title, description?, discount? })
//   active        boolean   (optional — default true; false hides from the map)
import type { Ionicons } from "@expo/vector-icons";

export type SponsorTier = "gold" | "silver" | "bronze";

export type SponsorOffer = {
  title: string;
  description?: string;
  /** Short highlight shown as a chip, e.g. "20% off". */
  discount?: string;
};

export type Sponsor = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  tier: SponsorTier;
  logoUrl?: string;
  brandColor?: string;
  address?: string;
  tagline?: string;
  offers: SponsorOffer[];
  active?: boolean;
};

/** Relative rank per tier — controls sort order and marker z-index (higher = on top). */
export const TIER_RANK: Record<SponsorTier, number> = {
  gold: 3,
  silver: 2,
  bronze: 1,
};

const VALID_TIERS: SponsorTier[] = ["gold", "silver", "bronze"];

/** Coerce an arbitrary string into a valid tier (defaults to bronze). */
export function normalizeTier(value: unknown): SponsorTier {
  return VALID_TIERS.includes(value as SponsorTier) ? (value as SponsorTier) : "bronze";
}

/** Marker size in px by tier. Gold (56) is bigger than the max event flame (52)
 *  so sponsors visually dominate the map. */
export function sponsorMarkerSize(tier: SponsorTier): number {
  switch (tier) {
    case "gold":
      return 56;
    case "silver":
      return 46;
    default:
      return 38;
  }
}

/** Glow-ring colour by tier. */
export function tierRingColor(tier: SponsorTier): string {
  switch (tier) {
    case "gold":
      return "#fbbf24";
    case "silver":
      return "#cbd5e1";
    default:
      return "#c2865a";
  }
}

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/** Fallback glyph shown when a sponsor has no logoUrl (or it fails to load). */
export function categoryIcon(category: string): IoniconName {
  switch (category) {
    case "fast-food":
      return "fast-food";
    case "cafe":
      return "cafe";
    case "bar":
      return "beer";
    case "store":
      return "storefront";
    default:
      return "pricetag";
  }
}
