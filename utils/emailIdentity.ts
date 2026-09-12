/**
 * Email identity canonicalisation — the "one account per mailbox" rule.
 *
 * Firebase Auth already rejects a second account on the *exact* same address
 * (`auth/email-already-in-use`), but it compares strings, not mailboxes. These
 * all reach the same real inbox and yet each buys a fresh UniLift account:
 *
 *   john.doe@gmail.com   john.doe+uni@gmail.com   j.o.h.ndoe@gmail.com
 *
 * So we collapse an address to its canonical form *before* handing it to
 * Firebase. Every alias of one mailbox maps to one string, which means
 * Firebase's own uniqueness check becomes a real one-account-per-mailbox check
 * — no extra index collection, no server round-trip, nothing to keep in sync.
 *
 * Rules applied:
 *   - trim + lowercase (Firebase is already case-insensitive; we match it).
 *   - drop the `+tag` sub-address, but ONLY on domains known to implement
 *     sub-addressing. See the warning below — this used to be universal.
 *   - drop dots in the local part for Gmail only, where they are ignored.
 *     Everywhere else a dot is a significant character.
 *   - fold googlemail.com onto gmail.com (same mailbox, alias domain).
 *
 * Because every alias of a mailbox delivers to that mailbox, the canonical
 * address is always deliverable — password resets and verification mails still
 * land where the user expects.
 *
 * ## Why `+tag` stripping is provider-gated, and was not
 *
 * It used to be applied to every domain, on the reasoning that Gmail, Google
 * Workspace and Microsoft 365 cover essentially every school we onboard, and
 * that gating would leave `@ulaval.ca` free to mint `+1`, `+2`, `+3`.
 *
 * That trade runs the wrong way, because canonicalisation decides the address
 * the account is actually *created under*. On a domain with no sub-addressing,
 * `john+doe@ulaval.ca` is not an alias of anything — it is undeliverable.
 * Stripping the tag turned that undeliverable string into `john@ulaval.ca`, a
 * real mailbox belonging to somebody else, and minted an account under it: the
 * signer-up proved control of nothing, every mail UniLift sends about that
 * account lands in the real John's inbox, and on a school domain it squats an
 * address that Student certification treats as proof of enrolment.
 *
 * Gating restores the alias hole for unlisted domains — `john+1@ulaval.ca` and
 * `john+2@ulaval.ca` are now two accounts. That is the lesser problem: those
 * addresses are undeliverable there, so neither account can receive a password
 * reset, and email verification (open item 1.8 in docs/security-audit.md)
 * closes the hole properly. An address nobody can receive mail at is worth much
 * less than one belonging to a real person.
 *
 * Google Workspace and Microsoft 365 custom domains do honour `+`, and cannot
 * be detected from the address alone. They fall through to the safe side.
 */

/** Domains that ignore dots in the local part. Gmail and its alias domain. */
const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Domains known to implement `+` sub-addressing, where `user+tag@d` and
 * `user@d` are the same mailbox.
 *
 * Add only providers you have confirmed. A domain listed here wrongly lets one
 * person hold an account under an address they do not control.
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

/** Alias domains folded onto the mailbox domain they actually serve. */
const DOMAIN_ALIASES: Record<string, string> = {
  "googlemail.com": "gmail.com",
};

// Deliberately permissive: this is a typo guard for the signup form, not an
// RFC 5322 parser. Firebase does the authoritative validation server-side.
const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** True when `raw` looks like an email address a user could have meant. */
export function isValidEmailFormat(raw: string): boolean {
  return EMAIL_FORMAT_REGEX.test(raw.trim());
}

/**
 * Collapse an address to the one string that identifies its mailbox.
 * Anything that isn't parseable as an address is returned trimmed+lowercased
 * so callers never have to special-case garbage input — Firebase will reject
 * it with `auth/invalid-email` anyway.
 */
export function normalizeEmail(raw: string): string {
  const lowered = raw.trim().toLowerCase();

  const at = lowered.lastIndexOf("@");
  if (at <= 0 || at === lowered.length - 1) return lowered;

  let local = lowered.slice(0, at);
  const rawDomain = lowered.slice(at + 1);
  const domain = DOMAIN_ALIASES[rawDomain] ?? rawDomain;

  // Gated on `rawDomain`, like the dot rule below: the alias table maps
  // googlemail.com onto gmail.com, and both are listed, so either key works —
  // but checking the address as typed is what keeps the two rules consistent.
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
 * The addresses to try, in order, when signing an *existing* user in.
 *
 * Accounts created before canonicalisation shipped are stored under whatever
 * the user typed, so the typed form has to be tried first or those users get
 * locked out. Accounts created after it are stored canonically, which the
 * second entry covers when the user types an alias. Deduped, so the common
 * case is a single attempt.
 */
export function emailSignInCandidates(raw: string): string[] {
  const typed = raw.trim().toLowerCase();
  const canonical = normalizeEmail(raw);
  return canonical === typed ? [typed] : [typed, canonical];
}
