/**
 * Account-creation limits.
 *
 * `MAX_ACCOUNTS_PER_DEVICE` is mirrored into both Cloud Functions codebases and
 * pinned by `scripts/check-server-drift.sh`, because a value that drifts between
 * the client and the servers means one of them is enforcing a different cap than
 * the UI promises. The **server** number is the one that decides; this copy
 * exists so the app can explain the limit before someone hits it.
 */

/**
 * How many accounts one device may create.
 *
 * Counted per install identity (see `services/deviceIdentity.ts`), which
 * survives deleting and reinstalling the app. Deleting an account releases a
 * slot — a deliberate product decision, and the reason the device document also
 * carries a never-decremented `everCreated` tally: create-delete-repeat is a
 * bypass, and `everCreated` is how you would notice it being used.
 */
export const MAX_ACCOUNTS_PER_DEVICE = 5;
