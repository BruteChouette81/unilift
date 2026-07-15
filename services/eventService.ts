import { apiFetch, apiBaseUrl, firestoreBaseUrl, firestoreCollectionUrl, withFirebaseApiKey } from "@/constants/runtime-config";
import { clampHypeScore, type HypeEvent } from "@/constants/events";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

// ─── Hype-event cache ────────────────────────────────────────────────────────
// The Hype map used to render nothing until the network round-trip finished, so
// flames appeared seconds after the toggle. Events change rarely, so the last
// known set is persisted and painted immediately while a fresh fetch revalidates
// in the background. Two layers:
//   • memory — survives tab switches, readable synchronously (zero-frame paint)
//   • disk   — survives app restarts, one async hop on cold start
// Bump the key's version suffix if the HypeEvent shape ever changes.
const EVENTS_CACHE_KEY = "unilift:hypeEvents:v1";

let memoryCache: HypeEvent[] | null = null;

/** Last known events, readable synchronously. `null` = nothing cached yet this
 *  process. Use as a `useState` initializer so cached flames paint on frame 1. */
export function getCachedHypeEventsSync(): HypeEvent[] | null {
  return memoryCache;
}

/** Last known events — memory first, then disk. `[]` when nothing is cached. */
export async function loadCachedHypeEvents(): Promise<HypeEvent[]> {
  if (memoryCache !== null) return memoryCache;
  try {
    const raw = await AsyncStorage.getItem(EVENTS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Re-validate coordinates on read: a corrupt entry reaching a native Marker
    // is a hard crash, not a caught exception.
    const events = parsed.filter(
      (e): e is HypeEvent =>
        isRecord(e) &&
        typeof e.id === "string" &&
        typeof e.name === "string" &&
        Number.isFinite(e.lat) &&
        Number.isFinite(e.lng),
    );
    memoryCache = events;
    return events;
  } catch {
    return [];
  }
}

async function saveCachedHypeEvents(events: HypeEvent[]): Promise<void> {
  memoryCache = events;
  try {
    await AsyncStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify(events));
  } catch {
    // cache write failing is non-fatal — the in-memory layer still serves this session
  }
}

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

/** Fetch the top 50 Hype-map events from Firestore, ordered by score, and
 *  refresh the cache on success.
 *
 *  Returns `null` on failure — distinct from `[]`, which means the collection
 *  really is empty. Callers must not overwrite cached events with a `null`, or
 *  an offline refresh would wipe the flames off the map. */
export async function fetchHypeEvents(): Promise<HypeEvent[] | null> {
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
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ document?: unknown }>;
    const events = data
      .filter((entry) => entry.document != null)
      .map((entry) => parseEvent(entry.document))
      .filter((e): e is HypeEvent => e !== null);
    await saveCachedHypeEvents(events);
    return events;
  } catch {
    return null;
  }
}
