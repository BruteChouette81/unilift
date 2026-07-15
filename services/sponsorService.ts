import { firestoreBaseUrl, firestoreCollectionUrl, withFirebaseApiKey } from "@/constants/runtime-config";
import { normalizeTier, TIER_RANK, type Sponsor, type SponsorOffer } from "@/constants/sponsors";
import { getAuth } from "firebase/auth";

const BASE_URL = firestoreCollectionUrl("sponsors");

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const readString = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

const readNumber = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const user = getAuth().currentUser;
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  return headers;
}

/** Unwrap the Firestore REST arrayValue → SponsorOffer[]. Each offer is a
 *  mapValue with string fields { title, description?, discount? }. */
function parseOffers(v: unknown): SponsorOffer[] {
  if (!isRecord(v) || !isRecord(v.arrayValue)) return [];
  const values = (v.arrayValue as { values?: unknown }).values;
  if (!Array.isArray(values)) return [];
  const offers: SponsorOffer[] = [];
  for (const entry of values) {
    if (!isRecord(entry) || !isRecord(entry.mapValue)) continue;
    const f = (entry.mapValue as { fields?: unknown }).fields;
    if (!isRecord(f)) continue;
    const title = readString(isRecord(f.title) ? f.title.stringValue : "");
    if (!title) continue;
    offers.push({
      title,
      description: readString(isRecord(f.description) ? f.description.stringValue : "") || undefined,
      discount: readString(isRecord(f.discount) ? f.discount.stringValue : "") || undefined,
    });
  }
  return offers;
}

function parseSponsor(doc: unknown): Sponsor | null {
  if (!isRecord(doc) || !isRecord(doc.fields)) return null;
  const f = doc.fields;
  const id = readString(doc.name, "").split("/").pop() || "";

  const name = readString(isRecord(f.name) ? f.name.stringValue : "");
  const category = readString(isRecord(f.category) ? f.category.stringValue : "");

  const geo = isRecord(f.location) ? f.location.geoPointValue : null;
  const lat = isRecord(geo) ? readNumber(geo.latitude, NaN) : NaN;
  const lng = isRecord(geo) ? readNumber(geo.longitude, NaN) : NaN;

  if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // active defaults to true; only an explicit `false` hides the sponsor.
  const active = isRecord(f.active) ? f.active.booleanValue !== false : true;
  if (!active) return null;

  return {
    id,
    name,
    category,
    lat,
    lng,
    tier: normalizeTier(isRecord(f.tier) ? f.tier.stringValue : undefined),
    logoUrl: readString(isRecord(f.logoUrl) ? f.logoUrl.stringValue : "") || undefined,
    brandColor: readString(isRecord(f.brandColor) ? f.brandColor.stringValue : "") || undefined,
    address: readString(isRecord(f.address) ? f.address.stringValue : "") || undefined,
    tagline: readString(isRecord(f.tagline) ? f.tagline.stringValue : "") || undefined,
    offers: parseOffers(f.offers),
    active: true,
  };
}

/** Fetch up to 50 sponsors from Firestore, sorted by tier (gold first).
 *  Returns [] on any failure so the map still renders. */
export async function fetchSponsors(): Promise<Sponsor[]> {
  try {
    const res = await fetch(withFirebaseApiKey(`${firestoreBaseUrl}:runQuery`), {
      method: "POST",
      headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "sponsors" }],
          limit: 50,
        },
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ document?: unknown }>;
    return data
      .filter((entry) => entry.document != null)
      .map((entry) => parseSponsor(entry.document))
      .filter((s): s is Sponsor => s !== null)
      .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
  } catch {
    return [];
  }
}

/** Fetch a single sponsor by id. */
export async function fetchSponsorById(sponsorId: string): Promise<Sponsor | null> {
  try {
    const res = await fetch(withFirebaseApiKey(`${BASE_URL}/${sponsorId}`), { headers: await authHeaders() });
    if (!res.ok) return null;
    return parseSponsor(await res.json());
  } catch {
    return null;
  }
}
