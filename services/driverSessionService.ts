import {
  apiFetch,
  apiBaseUrl,
  firestoreBaseUrl,
  firestoreCollectionUrl,
  firestoreDocumentUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import type { DriverSession, LocationPoint } from "@/types/models";
import { getMultiWaypointRoute } from "@/services/routeService";
import { rideLog } from "@/utils/ride-logger";
import { getAuth } from "firebase/auth";

const COLLECTION = "driverSessions";
const USERS_BASE_URL = firestoreCollectionUrl("users");

// Throttle session-origin writes to at most once every 15 seconds.
let lastSessionLocationWriteAt = 0;
const SESSION_LOCATION_THROTTLE_MS = 15000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const readString = (v: unknown, f = ""): string => (typeof v === "string" ? v : f);
const readNumber = (v: unknown, f = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
};
const readGeo = (v: unknown): LocationPoint | null => {
  if (!isRecord(v)) return null;
  const latitude = readNumber(v.latitude, NaN);
  const longitude = readNumber(v.longitude, NaN);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
};

async function authHeaders(json = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const user = getAuth().currentUser;
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function throwFetchError(res: Response, msg: string): Promise<never> {
  const details = await res.text().catch(() => "");
  throw new Error(`${msg} (status ${res.status})${details ? `: ${details.slice(0, 200)}` : ""}`);
}

export function parseDriverSession(doc: unknown): DriverSession | null {
  if (!isRecord(doc) || !isRecord(doc.fields)) return null;
  const f = doc.fields;
  const driverId = readString(isRecord(f.driverId) ? f.driverId.stringValue : "");
  const origin = readGeo(isRecord(f.origin) ? f.origin.geoPointValue : null);
  const destinationCoords = readGeo(isRecord(f.destinationCoords) ? f.destinationCoords.geoPointValue : null);
  if (!driverId || !origin) return null;
  return {
    driverId,
    driverName: readString(isRecord(f.driverName) ? f.driverName.stringValue : "") || undefined,
    driverAvatar: readString(isRecord(f.driverAvatar) ? f.driverAvatar.stringValue : "") || undefined,
    origin,
    destination: readString(isRecord(f.destination) ? f.destination.stringValue : ""),
    destinationCoords: destinationCoords ?? { latitude: 0, longitude: 0 },
    baseRouteKm: isRecord(f.baseRouteKm)
      ? (Number(f.baseRouteKm.doubleValue) || Number(f.baseRouteKm.integerValue) || undefined)
      : undefined,
    routePolyline: readString(isRecord(f.routePolyline) ? f.routePolyline.stringValue : "") || undefined,
    maxDetourKm: readNumber(isRecord(f.maxDetourKm) ? f.maxDetourKm.integerValue : 10, 10),
    destinationRadiusKm: isRecord(f.destinationRadiusKm)
      ? readNumber(f.destinationRadiusKm.integerValue, 10)
      : undefined,
    seatsAvailable: readNumber(isRecord(f.seatsAvailable) ? f.seatsAvailable.integerValue : 1, 1),
    status: (readString(isRecord(f.status) ? f.status.stringValue : "offline", "offline") as DriverSession["status"]),
    updatedAt: readString(isRecord(f.updatedAt) ? f.updatedAt.timestampValue : "", "") || undefined,
  };
}

/** Driver goes online: writes the full driverSessions/{uid} doc with their
 *  route (for the detour filter) and dispatches nothing — passengers' requests
 *  drive the matching. Origin is the live GPS captured at this moment. */
export async function goOnline(params: {
  origin: LocationPoint;
  destination: string;
  destinationCoords: { lat: number; lng: number };
  seats: number;
  maxDetourKm: number;
  destinationRadiusKm: number;
}): Promise<DriverSession> {
  const user = getAuth().currentUser;
  if (!user) throw new Error("Not authenticated");

  // Embed driver name/avatar (mirrors createRide).
  let driverName = user.displayName || user.email?.split("@")[0] || "";
  let driverAvatar = "";
  try {
    const token = await user.getIdToken();
    const res = await fetch(withFirebaseApiKey(`${USERS_BASE_URL}/${user.uid}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const pf = (await res.json()).fields ?? {};
      driverName =
        (isRecord(pf.name) ? String(pf.name.stringValue ?? "") : "") ||
        (isRecord(pf.email) ? String(pf.email.stringValue ?? "").split("@")[0] : "") ||
        driverName;
      driverAvatar = isRecord(pf.avatar) ? String(pf.avatar.stringValue ?? "") : "";
    }
  } catch { /* fall back to auth display name */ }

  // Direct route (origin → destination) for baseRouteKm + polyline used by the
  // detour filter — same approach as createRide.
  let baseRouteKm: number | undefined;
  let routePolyline: string | undefined;
  try {
    const route = await getMultiWaypointRoute([
      { latitude: params.origin.latitude, longitude: params.origin.longitude },
      { latitude: params.destinationCoords.lat, longitude: params.destinationCoords.lng },
    ]);
    baseRouteKm = route?.total.distanceKm;
    routePolyline = route?.overviewPolyline;
  } catch { /* non-fatal — session still usable with straight-line fallback */ }

  const doc = {
    fields: {
      driverId: { stringValue: user.uid },
      driverName: { stringValue: driverName },
      driverAvatar: { stringValue: driverAvatar },
      origin: { geoPointValue: { latitude: params.origin.latitude, longitude: params.origin.longitude } },
      destination: { stringValue: params.destination },
      destinationCoords: { geoPointValue: { latitude: params.destinationCoords.lat, longitude: params.destinationCoords.lng } },
      maxDetourKm: { integerValue: String(params.maxDetourKm) },
      destinationRadiusKm: { integerValue: String(params.destinationRadiusKm) },
      seatsAvailable: { integerValue: String(params.seats) },
      status: { stringValue: "online" },
      updatedAt: { timestampValue: new Date().toISOString() },
      ...(baseRouteKm !== undefined && Number.isFinite(baseRouteKm)
        ? { baseRouteKm: { doubleValue: baseRouteKm } } : {}),
      ...(routePolyline ? { routePolyline: { stringValue: routePolyline } } : {}),
    },
  };

  const res = await fetch(withFirebaseApiKey(firestoreDocumentUrl(COLLECTION, user.uid)), {
    method: "PATCH",
    headers: await authHeaders(true),
    body: JSON.stringify(doc),
  });
  if (!res.ok) await throwFetchError(res, "Failed to go online");
  const parsed = parseDriverSession(await res.json());
  if (!parsed) throw new Error("Failed to parse driver session");
  return parsed;
}

/** Driver goes offline. */
export async function goOffline(): Promise<void> {
  const user = getAuth().currentUser;
  if (!user) return;
  const url = withFirebaseApiKey(
    `${firestoreDocumentUrl(COLLECTION, user.uid)}?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt`,
  );
  const res = await fetch(url, {
    method: "PATCH",
    headers: await authHeaders(true),
    body: JSON.stringify({
      fields: { status: { stringValue: "offline" }, updatedAt: { timestampValue: new Date().toISOString() } },
    }),
  });
  if (!res.ok) await throwFetchError(res, "Failed to go offline");
}

/** Refresh the driver's live origin while online (called periodically). */
export async function updateDriverSessionLocation(loc: LocationPoint): Promise<void> {
  const now = Date.now();
  if (now - lastSessionLocationWriteAt < SESSION_LOCATION_THROTTLE_MS) return;
  lastSessionLocationWriteAt = now;
  const user = getAuth().currentUser;
  if (!user) return;
  const url = withFirebaseApiKey(
    `${firestoreDocumentUrl(COLLECTION, user.uid)}?updateMask.fieldPaths=origin&updateMask.fieldPaths=updatedAt`,
  );
  const res = await fetch(url, {
    method: "PATCH",
    headers: await authHeaders(true),
    body: JSON.stringify({
      fields: {
        origin: { geoPointValue: { latitude: loc.latitude, longitude: loc.longitude } },
        updatedAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });
  if (!res.ok) console.warn("Failed to refresh driver session location");
}

/** Fetch the current user's driver session (null if none / offline). */
export async function fetchMyDriverSession(): Promise<DriverSession | null> {
  const user = getAuth().currentUser;
  if (!user) return null;
  const res = await fetch(withFirebaseApiKey(firestoreDocumentUrl(COLLECTION, user.uid)), {
    headers: await authHeaders(),
  });
  if (!res.ok) return null;
  return parseDriverSession(await res.json());
}

/** Count drivers a passenger could currently reach for a trip (live "drivers
 *  available" stat) — no notifications are sent. Mirrors dispatch matching. */
export async function fetchAvailableDriverCount(params: {
  origin?: LocationPoint | null;
  destination: { lat: number; lng: number };
  seats?: number;
}): Promise<number> {
  const user = getAuth().currentUser;
  if (!user) return 0;
  try {
    const token = await user.getIdToken();
    const res = await apiFetch(`${apiBaseUrl}/drivers/available`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        destLat: params.destination.lat,
        destLng: params.destination.lng,
        ...(params.origin ? { originLat: params.origin.latitude, originLng: params.origin.longitude } : {}),
        ...(params.seats ? { seats: params.seats } : {}),
      }),
    });
    if (!res.ok) return 0;
    const data = await res.json().catch(() => ({}));
    return Number(data?.count) || 0;
  } catch {
    return 0;
  }
}

/** Ask the backend to dispatch a passenger request to eligible online drivers. */
export async function dispatchRideRequest(requestId: string): Promise<{ notified: number }> {
  const user = getAuth().currentUser;
  if (!user) throw new Error("Not authenticated");
  const token = await user.getIdToken();
  const res = await apiFetch(`${apiBaseUrl}/requests/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ requestId }),
  });
  if (!res.ok) await throwFetchError(res, "Failed to dispatch request");
  const data = await res.json().catch(() => ({}));
  const notified = Number(data?.notified) || 0;
  rideLog.info("dispatch", `dispatched request ${requestId}`, { notified });
  return { notified };
}

/** Count drivers currently online (status == "online") via Firestore aggregation. */
export async function countOnlineDrivers(): Promise<number> {
  const url = withFirebaseApiKey(`${firestoreBaseUrl}:runAggregationQuery`);
  const res = await fetch(url, {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: {
          from: [{ collectionId: COLLECTION }],
          where: {
            fieldFilter: {
              field: { fieldPath: "status" },
              op: "EQUAL",
              value: { stringValue: "online" },
            },
          },
        },
        aggregations: [{ count: {}, alias: "count" }],
      },
    }),
  });
  if (!res.ok) return 0;
  const data: unknown = await res.json().catch(() => null);
  const countVal = (data as any)?.[0]?.result?.aggregateFields?.count?.integerValue;
  return Number(countVal) || 0;
}

/** Driver claims a passenger request (first-wins, atomic on the server).
 *  Returns the created rideId + the params needed to open riderScreen.
 *
 *  When the driver has a live driverSession (Flow B), the server uses that
 *  session's origin/destination/seats and the extra params are ignored. When
 *  the driver is accepting from a Ride Mode push without an active session
 *  (Flow A), the caller must pass the driver's live `origin` plus the matched
 *  window's `destination`/`destinationCoords`; the server falls back to those. */
export async function acceptRideRequest(
  requestId: string,
  fallback?: {
    origin?: { lat: number; lng: number };
    destination?: string;
    destinationCoords?: { lat: number; lng: number };
    seats?: number;
  },
): Promise<{
  rideId: string;
  originLat: number;
  originLng: number;
  destination: string;
  destinationLat: number;
  destinationLng: number;
  maxSeat: number;
}> {
  const user = getAuth().currentUser;
  if (!user) throw new Error("Not authenticated");
  const token = await user.getIdToken();
  const res = await apiFetch(`${apiBaseUrl}/requests/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      requestId,
      ...(fallback?.origin ? { originLat: fallback.origin.lat, originLng: fallback.origin.lng } : {}),
      ...(fallback?.destination ? { destination: fallback.destination } : {}),
      ...(fallback?.destinationCoords
        ? { destinationLat: fallback.destinationCoords.lat, destinationLng: fallback.destinationCoords.lng }
        : {}),
      ...(fallback?.seats ? { seats: fallback.seats } : {}),
    }),
  });
  if (res.status === 409) {
    rideLog.warn("dispatch", `accept ${requestId} rejected: ALREADY_TAKEN`);
    throw Object.assign(new Error("ALREADY_TAKEN"), { code: "ALREADY_TAKEN" });
  }
  if (!res.ok) await throwFetchError(res, "Failed to accept request");
  const accepted = await res.json();
  rideLog.transition("ride", "open", "planned", { requestId, rideId: accepted?.rideId });
  return accepted;
}
