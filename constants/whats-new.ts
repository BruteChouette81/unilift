/**
 * The release-notes takeover: which release it describes, and how it is keyed.
 *
 * ## Why this is a hand-maintained constant and not `expoConfig.version`
 *
 * `app.config.js` sets `runtimeVersion: { policy: "appVersion" }`, so a JS-only
 * `eas update` never changes `Constants.expoConfig.version` — it only reaches
 * builds already on that version. Keying the takeover off the native version
 * would therefore make release notes shippable *only* through the App Store,
 * which is the opposite of what they are for. Bumping this string is enough to
 * show the sequence again, over the air.
 *
 * Bump it whenever the slide content changes. Every user then sees the new
 * sequence exactly once, because the seen-flag is version-scoped:
 * `unilift:wizard:whats-new-<WHATS_NEW_VERSION>-<uid>` (see
 * `hooks/use-first-run.ts`).
 */
export const WHATS_NEW_VERSION = "1.4";

/** `useFirstRun` key prefix for the current release, before the account scope. */
export const WHATS_NEW_KEY = `whats-new-${WHATS_NEW_VERSION}`;

/**
 * The seen-flag is scoped per *account*, not per device.
 *
 * A device-wide flag would silently skip the takeover for anyone who creates an
 * account on a phone that already dismissed it — a second roommate signing up,
 * a demo phone, or the same person making a new account. Keying on the Firebase
 * uid guarantees the requirement: every new account sees the sequence once.
 *
 * Passing the uid also makes the key *reactive*: right after signup the uid
 * changes, `useFirstRun` re-reads under the new key, finds nothing, and shows —
 * no remount of the root layout needed.
 */
export function whatsNewKeyFor(uid: string | null | undefined): string {
  return `${WHATS_NEW_KEY}-${uid ?? "anon"}`;
}

/** Slide identifiers, in order. The route-progress indicator
 *  (`components/route-progress.tsx`) draws one node per entry, so this array is
 *  the single source of truth for the sequence length. */
export const WHATS_NEW_SLIDES = [
  "intro",
  "rides",
  "matching",
  "certification",
  "fee",
] as const;

export type WhatsNewSlide = (typeof WHATS_NEW_SLIDES)[number];
