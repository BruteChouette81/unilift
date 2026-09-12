/**
 * Server copy of the client's email canonicaliser.
 *
 * ## Why this file is a duplicate, and why that is not negotiable
 *
 * `utils/emailIdentity.ts` is TypeScript compiled by Metro for the app bundle.
 * This codebase is plain CommonJS deployed to Cloud Functions with no build
 * step, so it cannot import that module. The logic therefore exists twice.
 *
 * That is dangerous in exactly one way: if the two drift, the blocking function
 * canonicalises an address differently from the client, and the "one mailbox,
 * one account" guarantee quietly stops holding — a second account slips through
 * because the two sides disagreed about what the first one's canonical form
 * was. `functions/__tests__/email-identity.test.ts` runs both implementations
 * over one shared fixture list and fails if a single case differs. Change one
 * side, and that test tells you to change the other.
 *
 * Keep this a pure function with no `require`s: the test imports it directly.
 */

/** Domains that ignore dots in the local part. Gmail and its alias domain. */
const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** Alias domains folded onto the mailbox domain they actually serve. */
const DOMAIN_ALIASES = {
  "googlemail.com": "gmail.com",
};

/**
 * Domains known to implement `+` sub-addressing.
 *
 * Gated rather than universal: on a domain without sub-addressing,
 * `john+doe@ulaval.ca` is undeliverable, and stripping the tag would mint an
 * account under `john@ulaval.ca` — a real mailbox belonging to someone else.
 * See the long note in `utils/emailIdentity.ts` for the full reasoning.
 */
const PLUS_ADDRESSING_DOMAINS = new Set([
  // Google
  "gmail.com", "googlemail.com",
  // Microsoft consumer
  "outlook.com", "hotmail.com", "live.com", "msn.com", "passport.com",
  // Apple
  "icloud.com", "me.com", "mac.com",
  // Proton
  "protonmail.com", "protonmail.ch", "proton.me", "pm.me",
  // Others with documented support
  "fastmail.com", "fastmail.fm", "zoho.com", "tutanota.com", "hey.com",
]);

/**
 * Collapse an address to the one string that identifies its mailbox.
 *
 * Mirrors `normalizeEmail` in `utils/emailIdentity.ts` exactly. Anything not
 * parseable as an address comes back trimmed and lowercased rather than
 * throwing, so callers never special-case garbage.
 *
 * @param {string} raw
 * @return {string}
 */
function normalizeEmail(raw) {
  const lowered = String(raw ?? "").trim().toLowerCase();

  const at = lowered.lastIndexOf("@");
  if (at <= 0 || at === lowered.length - 1) return lowered;

  let local = lowered.slice(0, at);
  const rawDomain = lowered.slice(at + 1);
  const domain = DOMAIN_ALIASES[rawDomain] ?? rawDomain;

  if (PLUS_ADDRESSING_DOMAINS.has(rawDomain)) {
    const plus = local.indexOf("+");
    if (plus > 0) local = local.slice(0, plus);
  }

  if (DOT_INSENSITIVE_DOMAINS.has(rawDomain)) local = local.replace(/\./g, "");

  // A local part of "+tag" or "..." canonicalises to nothing — keep the
  // original rather than inventing the mailbox "@gmail.com".
  if (!local) return lowered;

  return `${local}@${domain}`;
}

/**
 * Firestore document ids cannot contain "/", cannot be "." or "..", and are
 * capped at 1500 bytes. An email can legally contain a slash in its local part,
 * so the canonical address is not safe to use as a key unhashed.
 *
 * Returns the address with "/" percent-encoded. Kept deliberately reversible —
 * being able to read an index key while debugging is worth more here than
 * hiding an address that the `users` collection already stores in the clear,
 * and a one-way hash would make the "which mailbox owns this?" question
 * unanswerable without a scan.
 *
 * @param {string} canonical output of normalizeEmail
 * @return {string}
 */
function emailIndexKey(canonical) {
  return canonical.replace(/\//g, "%2F").slice(0, 1000);
}

module.exports = { normalizeEmail, emailIndexKey, PLUS_ADDRESSING_DOMAINS };
