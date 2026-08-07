// ─── Hype events (Firestore-backed) ──────────────────────────────────────────
// A live "Hype map" event read from the Firestore `events` collection. Admins
// add documents directly in the Firebase console. The `score` (1–10) drives the
// size of the flame marker on the map — 10 = biggest fire, 1 = smallest.
//
// Firestore `events/{id}` document shape:
//   name           string                 (required)
//   nameFr         string                 (optional — falls back to name)
//   venue          string                 (required)
//   location       geoPoint               (required — { latitude, longitude })
//   score          integer 1–10           (required — hype level / flame size)
//   description    string                 (optional)
//   descriptionFr  string                 (optional)
//   date           string                 (optional — display text, e.g. "Sat Apr 5")
//   time           string                 (optional — e.g. "11 PM")
//   tag            string                 (optional)
//   tagFr          string                 (optional)
//   ticketPriceCents integer              (optional — omit for free entry)
//   attendeeCount  integer                (optional — future "people going")
export type HypeEvent = {
  id: string;
  name: string;
  nameFr?: string;
  venue: string;
  lat: number;
  lng: number;
  /** Hype level 1–10 → flame marker size. */
  score: number;
  description?: string;
  descriptionFr?: string;
  date?: string;
  time?: string;
  tag?: string;
  tagFr?: string;
  ticketPriceCents?: number;
  /** Reserved for the upcoming "people going" feature. */
  attendeeCount?: number;
};

/** Clamp a raw hype score into the supported 1–10 range. */
export function clampHypeScore(score: number): number {
  if (!Number.isFinite(score)) return 1;
  return Math.max(1, Math.min(10, Math.round(score)));
}

/** Map a hype score (1–10) to a flame icon size in px (smallest → biggest). */
export function hypeScoreToIconSize(score: number): number {
  const MIN = 15;
  const MAX = 34;
  const s = clampHypeScore(score);
  return Math.round(MIN + ((s - 1) / 9) * (MAX - MIN));
}

export type EventTier = "standard" | "premium" | "featured";

export type PromotedEvent = {
  id: string;
  name: string;
  nameFr: string;
  venue: string;
  date: string;
  time: string;         // e.g. "10 PM", "11:30 PM"
  lat: number;
  lng: number;
  tag: string;
  tagFr: string;
  description: string;
  descriptionFr: string;
  ticketPrice?: number; // cents — undefined means free entry
  tier: EventTier;      // controls card size / visibility — higher tier = more exposure
};

export const PROMOTED_EVENTS: PromotedEvent[] = [
 
]; /** {
    id: "ev1",
    name: "Throwback Thursday",
    nameFr: "Jeudi Rétro",
    venue: "Shaker St-Foy",
    date: "Thu Apr 3",
    time: "10 PM",
    lat: 46.7869189,
    lng: -71.2822901,
    tag: "Bar Night",
    tagFr: "Soirée Bar",
    description: "2000s & 2010s hits all night. Free entry before 11PM.",
    descriptionFr: "Hits des années 2000-2010 toute la nuit. Entrée gratuite avant 23h.",
    ticketPrice: 1000,
    tier: "standard",
  },
  {
    id: "ev2",
    name: "Neon Rave",
    nameFr: "Néon Rave",
    venue: "Place Laurier",
    date: "Sat Apr 5",
    time: "11 PM",
    lat: 46.77146578,
    lng: -71.28316956,
    tag: "Party",
    tagFr: "Fête",
    description: "The biggest EDM night in Quebec City. Get your glow on and dance till sunrise.",
    descriptionFr: "La plus grande soirée EDM de Québec. Brillez sous les néons jusqu'à l'aube.",
    ticketPrice: 1500,
    tier: "featured",
  },
  {
    id: "ev3",
    name: "Campus Bar Crawl",
    nameFr: "Bar Crawl Campus",
    venue: "Vieux-Québec",
    date: "Fri Apr 4",
    time: "9 PM",
    lat: 46.8139,
    lng: -71.2082,
    tag: "Crawl",
    tagFr: "Bar Crawl",
    description: "Hit 5 bars with your crew. UniLift gets you there safely.",
    descriptionFr: "5 bars avec votre gang. UniLift vous y amène en sécurité.",
    ticketPrice: 500,
    tier: "premium",
  }, */
