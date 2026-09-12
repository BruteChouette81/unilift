// ─────────────────────────────────────────────────────────────────────────────
// Certification registry — the single source of truth for the identity
// certification layer (see docs / plan). Reused by signup, the profile screen,
// the certification management screen, and every ride card that shows a
// driver's / passenger's badges.
//
// Certifications are STACKABLE (a user can hold several) and stored on the
// `users/{uid}` document as `certifications: string[]`. An empty/absent array
// means the user is uncertified. The field is written ONLY by the apiSandbox
// Cloud Function — clients never write it (Firestore dev rules block it), which
// is what makes this a real verification layer.
// ─────────────────────────────────────────────────────────────────────────────


/**
 * Master switch for the whole certification / identity-verification layer.
 *
 * Hidden in production because the `/cert/*` endpoints live ONLY in the SANDBOX
 * Cloud Functions codebase (`functions-sandbox/index.js` has nine of them;
 * `functions/index.js` has none). A production build talks to the LIVE function,
 * so every verification action would 404 — the feature is unreachable there, not
 * merely unfinished.
 *
 * While this is false the app hides every certification surface behind a Coming
 * Soon screen: the cert screen body, all badge render sites, the profile entry
 * point, the profile-completion task, and the signup verification step.
 *
 * Certification gates no capability anywhere (verified across both servers and
 * all client code), so flipping this changes what users *see*, never what they
 * can *do*.
 *
 * To re-enable, in this order:
 *   1. Port the `/cert/*` routes and the Stripe Identity webhook from
 *      functions-sandbox/index.js to functions/index.js — they are sandbox-only,
 *      so on a production build the flag alone would leave every button 404ing.
 *   2. Set STRIPE_IDENTITY_WEBHOOK_SECRET in functions/.env and register the
 *      live-mode webhook.
 *   3. Change this to `true`.
 *
 * This used to be `= isDev`, which conflated two unrelated questions: "is this a
 * dev build?" and "is this feature finished?". That meant certification could
 * never be demoed on a production build, and would switch itself on for everyone
 * the day someone pointed a dev build at live data.
 */
export const CERTIFICATION_ENABLED = false;

export type CertTier = "adult" | "student";

/** Rank order, weakest → strongest. Used for stable badge ordering and to pick a
 *  single "highest" tier in compact / single-color contexts. */
export const CERT_ORDER: CertTier[] = ["adult", "student"];

type CertMeta = {
  /** Badge / accent color for this tier. */
  color: string;
  /** Ionicons glyph name. */
  icon: string;
  /** i18n key for the human-readable label. */
  labelKey: string;
};

export const CERT_META: Record<CertTier, CertMeta> = {
  adult: { color: "#ef4444", icon: "shield-checkmark", labelKey: "cert.tier.adult" },
  student: { color: "#22c55e", icon: "school", labelKey: "cert.tier.student" },
};

/** Visual for the "no certification" state. */
export const UNCERTIFIED: CertMeta = {
  color: "#6b7280",
  icon: "help-circle",
  labelKey: "cert.tier.uncertified",
};

const VALID = new Set<string>(CERT_ORDER);

/** Filter an arbitrary array down to valid tiers, ordered by CERT_ORDER. */
export function earnedTiers(certifications?: string[] | null): CertTier[] {
  if (!Array.isArray(certifications)) return [];
  const owned = new Set(certifications.filter((c): c is CertTier => VALID.has(c)));
  return CERT_ORDER.filter((tier) => owned.has(tier));
}

/** The strongest tier a user holds, or null if uncertified. */
export function highestTier(certifications?: string[] | null): CertTier | null {
  const tiers = earnedTiers(certifications);
  return tiers.length ? tiers[tiers.length - 1] : null;
}

// School email domains accepted for student verification. Mirrors the SCHOOLS
// list in constants/schools.ts and is validated again server-side. Keep the two
// in sync when adding a partner school.
export const SCHOOL_EMAIL_DOMAINS: string[] = [
  "ulaval.ca", // Université Laval
  "cegep-ste-foy.qc.ca", // Cégep de Sainte-Foy
  "cegepgarneau.ca", // Cégep Garneau
  "clc.qc.ca", // Champlain St-Lawrence
  "cegeplevis.ca", // Cégep de Lévis
  "uqar.ca", // UQAR
];

/** Extract the lowercased domain of an email, or "" if malformed. */
function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

/** Is this email address from an accepted school domain? */
export function isSchoolEmail(email: string): boolean {
  return SCHOOL_EMAIL_DOMAINS.includes(emailDomain(email));
}
