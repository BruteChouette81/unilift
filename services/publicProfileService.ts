// The ONLY cross-user readable view of a person: `users/{uid}/public/profile`.
//
// `users/{uid}` itself is owner-only (firestore.rules). It holds email, birth
// date, home address, push token, Stripe ids and money counters, and it used to
// be readable — and listable — by any signed-in account. Everything another user
// legitimately sees on a ride card or a profile modal is projected into this
// public document by the mirrorPublicProfile Cloud Function trigger.
//
// The document is server-written and `write: false` for clients, which is also
// what makes reputation unforgeable: rating, xp and ridesCompleted no longer sit
// on a document the user owns.
import { firestoreBaseUrl, withFirebaseApiKey } from "@/constants/runtime-config";
import { getAuth } from "firebase/auth";

export type PublicProfile = {
  uid: string;
  name: string;
  avatar: string | null;
  /** Mean rating as a float, 0 when nobody has rated yet. Round for display. */
  rating: number;
  ratingCount: number;
  xp: number;
  ridesCompleted: number;
  certifications: string[];
  school?: string;
  age?: number;
  instagramHandle?: string;
};

const EMPTY_FIELDS: Record<string, unknown> = {};

/** Decode a Firestore REST document into a PublicProfile. */
export function extractPublicProfile(
  uid: string,
  doc: { fields?: Record<string, unknown> } | null,
): PublicProfile {
  const fields = doc?.fields ?? EMPTY_FIELDS;
  const str = (key: string): string => {
    const v = fields[key] as Record<string, unknown> | undefined;
    return typeof v?.stringValue === "string" ? v.stringValue : "";
  };
  const num = (key: string): number => {
    const v = fields[key] as Record<string, unknown> | undefined;
    return Number(v?.doubleValue ?? v?.integerValue ?? 0);
  };
  const strArr = (key: string): string[] => {
    const v = fields[key] as Record<string, unknown> | undefined;
    const values = (v?.arrayValue as Record<string, unknown> | undefined)?.values;
    if (!Array.isArray(values)) return [];
    return values
      .map((e) => (e as Record<string, unknown>)?.stringValue)
      .filter((s): s is string => typeof s === "string");
  };
  const age = num("age");
  return {
    uid,
    name: str("name") || "UniLift user",
    avatar: str("avatar") || null,
    rating: num("rating"),
    ratingCount: num("ratingCount"),
    xp: num("xp"),
    ridesCompleted: num("ridesCompleted"),
    certifications: strArr("certifications"),
    school: str("school") || undefined,
    age: age > 0 ? age : undefined,
    instagramHandle: str("instagramHandle") || undefined,
  };
}

/** Fetch someone's public profile. Returns null when the document does not exist
 *  yet — the mirror trigger creates it on the user's next profile write, and the
 *  backfill script seeds it for accounts that predate the split. */
export async function fetchPublicProfile(uid: string): Promise<PublicProfile | null> {
  if (!uid) return null;
  try {
    const token = await getAuth().currentUser?.getIdToken();
    const url = withFirebaseApiKey(`${firestoreBaseUrl}/users/${uid}/public/profile`);
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    return extractPublicProfile(uid, await res.json());
  } catch {
    return null;
  }
}

/** Several profiles at once, for a passenger list. Failures resolve to null
 *  rather than rejecting the batch — one missing profile must not blank a list. */
export async function fetchPublicProfiles(
  uids: string[],
): Promise<Record<string, PublicProfile>> {
  const unique = Array.from(new Set(uids.filter(Boolean)));
  const out: Record<string, PublicProfile> = {};
  await Promise.all(
    unique.map(async (uid) => {
      const p = await fetchPublicProfile(uid);
      if (p) out[uid] = p;
    }),
  );
  return out;
}
