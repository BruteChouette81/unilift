/**
 * Master switch for the Hype map.
 *
 * While this is false the home screen renders no flame FAB, no event markers and
 * no first-run hype wizard — the map is a plain ride-hailing map. Everything
 * below, plus hooks/use-hype-events.ts, services/eventService.ts and
 * components/hype-event-card.tsx, is left intact and unreferenced so switching
 * back on is one constant rather than a rebuild.
 *
 * Unlike certification this needs no server work: the `events` collection and
 * its rules already exist. What it needs is real event data and a decision that
 * the feature is ready to be seen.
 */
export const HYPE_MAP_ENABLED = false;

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
