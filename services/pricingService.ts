import { firestoreDocumentUrl, withFirebaseApiKey } from "@/constants/runtime-config";
import { DEFAULT_RIDE_PRICING, isValidPricingValue, type RidePricing } from "@/constants/pricing";
import { getAuth } from "firebase/auth";
import { isRecord } from "@/services/firestore-rest";

/** Read a Firestore REST numeric field ({ integerValue } | { doubleValue }). */
const readNumberField = (v: unknown): number => {
  if (!isRecord(v)) return NaN;
  return Number(v.integerValue ?? v.doubleValue);
};

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const user = getAuth().currentUser;
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  return headers;
}

/** Fetch the live ride pricing from `config/pricing`. Returns the four rate
 *  fields merged over the hardcoded defaults, so a missing doc / field / any
 *  failure falls back gracefully. Used at startup to hydrate RIDE_PRICING. */
export async function fetchRidePricing(): Promise<RidePricing> {
  const pricing: RidePricing = { ...DEFAULT_RIDE_PRICING };
  try {
    const res = await fetch(
      withFirebaseApiKey(firestoreDocumentUrl("config", "pricing")),
      { headers: await authHeaders() },
    );
    if (!res.ok) return pricing;
    const doc = await res.json();
    const fields = isRecord(doc) && isRecord(doc.fields) ? doc.fields : {};
    for (const key of Object.keys(DEFAULT_RIDE_PRICING) as (keyof RidePricing)[]) {
      const n = readNumberField(fields[key]);
      // isValidPricingValue, not `n > 0`: the fee fields (stripePercentBps,
      // stripeFixedCents, payoutReserveBps) may legitimately be 0, and a bare
      // `> 0` guard would silently discard a deliberate 0 and fall back to the
      // default — i.e. the config field would stop working exactly when someone
      // tried to switch it off.
      if (isValidPricingValue(key, n)) pricing[key] = n;
    }
  } catch {
    // fall through to defaults
  }
  return pricing;
}
