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

/**
 * Max straight-line distance from the user for a place to be offered as a
 * suggestion (search box, home address, favourite places).
 *
 * Google Place Autocomplete's `location`/`radius` pair is only a *bias*, not a
 * restriction — without `strictbounds` it still happily returns Vancouver for a
 * user in Montréal. So the cap is applied here, on the client, after each
 * prediction's coordinates are resolved.
 *
 * NOT a server-side rule: it shapes what the app *offers*, and nothing more. A
 * ride is still priced and gated by the server (`legDistanceKm`, the fare clamp
 * and DROPOFF_CONFIRM_RADIUS_KM above), so raising or lowering this cannot
 * affect what anyone is charged.
 *
 * 400 km ≈ Montréal→Toronto, which is about the longest trip that is plausibly
 * a rideshare rather than a flight.
 */
export const MAX_SUGGESTION_DISTANCE_KM = 400;
