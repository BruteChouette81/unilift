/**
 * Ride geometry tunables.
 *
 * MIRRORED SERVER-SIDE: `DROPOFF_CONFIRM_RADIUS_KM` also lives in
 * `functions/index.js` and `functions-sandbox/index.js`. Change all three
 * together (same convention as `constants/pricing.ts` ↔ `DEFAULT_PRICING`).
 *
 * The server is the only authority on whether a dropoff is in range — this
 * constant exists so the app can *say* "3 km" in an alert without hardcoding
 * the number in two translation files.
 */

/**
 * Max distance between the driver's position at dropoff and the passenger's
 * destination for the leg to be billable. A passenger dropped further than this
 * is still resolved (rated, removed from the ride) but is never charged, and the
 * driver earns nothing for that leg.
 */
export const DROPOFF_CONFIRM_RADIUS_KM = 3;
