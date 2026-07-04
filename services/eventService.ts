import { apiFetch, apiBaseUrl, firestoreBaseUrl, firestoreCollectionUrl, withFirebaseApiKey } from "@/constants/runtime-config";
import { clampHypeScore, type HypeEvent } from "@/constants/events";
import { getAuth } from "firebase/auth";

const BASE_URL = firestoreCollectionUrl("events");

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

function parseEvent(doc: unknown): HypeEvent | null {
  if (!isRecord(doc) || !isRecord(doc.fields)) return null;
  const f = doc.fields;
  const id = readString(doc.name, "").split("/").pop() || "";

  const name = readString(isRecord(f.name) ? f.name.stringValue : "");
  const venue = readString(isRecord(f.venue) ? f.venue.stringValue : "");

  const geo = isRecord(f.location) ? f.location.geoPointValue : null;
  const lat = isRecord(geo) ? readNumber(geo.latitude, NaN) : NaN;
  const lng = isRecord(geo) ? readNumber(geo.longitude, NaN) : NaN;

  if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const scoreRaw = isRecord(f.score)
    ? Number(f.score.integerValue ?? f.score.doubleValue ?? 1)
    : 1;
  const ticket = isRecord(f.ticketPriceCents)
    ? Number(f.ticketPriceCents.integerValue ?? f.ticketPriceCents.doubleValue)
    : NaN;
  const attendees = isRecord(f.attendeeCount)
    ? Number(f.attendeeCount.integerValue ?? f.attendeeCount.doubleValue)
    : NaN;

  return {
    id,
    name,
    nameFr: readString(isRecord(f.nameFr) ? f.nameFr.stringValue : "") || undefined,
    venue,
    lat,
    lng,
    score: clampHypeScore(scoreRaw),
    description: readString(isRecord(f.description) ? f.description.stringValue : "") || undefined,
    descriptionFr: readString(isRecord(f.descriptionFr) ? f.descriptionFr.stringValue : "") || undefined,
    date: readString(isRecord(f.date) ? f.date.stringValue : "") || undefined,
    time: readString(isRecord(f.time) ? f.time.stringValue : "") || undefined,
    tag: readString(isRecord(f.tag) ? f.tag.stringValue : "") || undefined,
    tagFr: readString(isRecord(f.tagFr) ? f.tagFr.stringValue : "") || undefined,
    ticketPriceCents: Number.isFinite(ticket) ? ticket : undefined,
    attendeeCount: Number.isFinite(attendees) ? attendees : undefined,
  };
}

/** Toggle the current user's interest in an event. Returns the new interest
 *  state and the event's updated attendee count (server is the source of
 *  truth — race-safe). */
export async function toggleEventInterest(
  eventId: string,
): Promise<{ interested: boolean; attendeeCount: number }> {
  const user = getAuth().currentUser;
  if (!user) throw new Error("Not authenticated");
  const token = await user.getIdToken();
  const res = await apiFetch(`${apiBaseUrl}/events/interest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ eventId }),
  });
  if (!res.ok) throw new Error(`Failed to toggle interest (status ${res.status})`);
  const data = await res.json().catch(() => ({}));
  return { interested: !!data.interested, attendeeCount: Number(data.attendeeCount) || 0 };
}

/** Fetch a single event by id (used to live-poll its attendee counter). */
export async function fetchEventById(eventId: string): Promise<HypeEvent | null> {
  try {
    const res = await fetch(withFirebaseApiKey(`${BASE_URL}/${eventId}`), { headers: await authHeaders() });
    if (!res.ok) return null;
    return parseEvent(await res.json());
  } catch {
    return null;
  }
}

/** Fetch the top 50 Hype-map events from Firestore, ordered by score.
 *  Returns [] on any failure so the map still renders. */
export async function fetchHypeEvents(): Promise<HypeEvent[]> {
  try {
    const res = await fetch(withFirebaseApiKey(`${firestoreBaseUrl}:runQuery`), {
      method: "POST",
      headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "events" }],
          orderBy: [{ field: { fieldPath: "score" }, direction: "DESCENDING" }],
          limit: 50,
        },
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ document?: unknown }>;
    return data
      .filter((entry) => entry.document != null)
      .map((entry) => parseEvent(entry.document))
      .filter((e): e is HypeEvent => e !== null);
  } catch {
    return [];
  }
}
