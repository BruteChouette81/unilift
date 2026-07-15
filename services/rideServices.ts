import {
  CANCELLATION_FEES,
  isWithinGraceWindow,
} from "@/constants/cancellation";
import {
  apiFetch,
  apiBaseUrl,
  firestoreBaseUrl,
  firestoreCollectionUrl,
  runtimeConfig,
  withFirebaseApiKey
} from "@/constants/runtime-config";
import { haversineKm } from "@/hooks/use-ride-recommendations";
import type { JoinRequest, LocationPoint, Ride } from "@/types/models";
import { rideLog } from "@/utils/ride-logger";
import { getAuth } from "firebase/auth";

export function createRideError(code: string, message: string): Error {
  const err = new Error(message);
  (err as Error & { code: string }).code = code;
  return err;
}

/** Authenticated POST to a ride-lifecycle Cloud Function endpoint. These
 *  endpoints are server-authoritative: the client no longer PATCHes ride docs
 *  directly (blocked by the tightened Firestore rules) — it calls these. */
async function apiPostRide<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const user = getAuth().currentUser;
  if (!user) throw createRideError("NOT_AUTHENTICATED", "Not authenticated");
  const token = await user.getIdToken();
  rideLog.info("driver", `POST ${path}`, body);
  const res = await apiFetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    rideLog.error("driver", `POST ${path} failed (${res.status})`, text);
    throw createRideError(String(res.status), text || `Request failed (${res.status})`);
  }
  const json = (await res.json().catch(() => ({}))) as T;
  rideLog.info("driver", `POST ${path} ok`, json);
  return json;
}

async function assertCurrentUserHasPaymentMethod(): Promise<void> {
  const user = getAuth().currentUser;
  if (!user) throw createRideError("NOT_AUTHENTICATED", "Not authenticated");
  const token = await user.getIdToken();
  let res: Response;
  try {
    res = await apiFetch(`${apiBaseUrl}/wallet/setup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
  } catch {
    throw createRideError("WALLET_UNAVAILABLE", "Wallet service unavailable");
  }
  if (!res.ok) throw createRideError("WALLET_UNAVAILABLE", "Wallet service unavailable");
  const data = await res.json().catch(() => null);
  if (!data?.paymentMethod?.id) {
    throw createRideError("NO_PAYMENT_METHOD", "NO_PAYMENT_METHOD");
  }
}

const BASE_URL = firestoreCollectionUrl("rides");
const USERS_BASE_URL = firestoreCollectionUrl("users");
const RIDES_CACHE_TTL_MS = 30000;
let ridesInFlight: Promise<Ride[]> | null = null;
let cachedRides: Ride[] = [];
let ridesFetchedAt = 0;

// Throttle driver location writes to at most once every 5 seconds — the GPS
// watcher fires more frequently but Firestore charges per write.
let lastDriverLocationWriteAt = 0;
const DRIVER_LOCATION_THROTTLE_MS = 5000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const readNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readGeoPoint = (value: unknown): LocationPoint | null => {
  if (!isRecord(value)) return null;
  const latitude = readNumber(value.latitude, NaN);
  const longitude = readNumber(value.longitude, NaN);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
};

const parseRideFromFirestoreDocument = (doc: unknown): Ride | null => {
  if (!isRecord(doc) || !isRecord(doc.fields)) return null;

  const fields = doc.fields;
  const name = readString(doc.name, "");
  const id = name.split("/").pop() || "";
  const destination = readString(isRecord(fields.destination) ? fields.destination.stringValue : "");
  const driverId = readString(isRecord(fields.driverId) ? fields.driverId.stringValue : "");
  const seatsAvailable = readNumber(
    isRecord(fields.seatsAvailable) ? fields.seatsAvailable.integerValue : 0,
    0,
  );
  const localisation = readGeoPoint(
    isRecord(fields.localisation) ? fields.localisation.geoPointValue : null,
  );

  if (!id || !destination || !driverId || !localisation) {
    return null;
  }

  const destinationCoords =
    readGeoPoint(
      isRecord(fields.destinationCoords) ? fields.destinationCoords.geoPointValue : null,
    ) ?? { latitude: 0, longitude: 0 };

  const passengerValues =
    isRecord(fields.passengers) &&
    isRecord(fields.passengers.arrayValue) &&
    Array.isArray(fields.passengers.arrayValue.values)
      ? fields.passengers.arrayValue.values
      : [];

  // Parse boardedPassengers
  const boardedValues =
    isRecord(fields.boardedPassengers) &&
    isRecord(fields.boardedPassengers.arrayValue) &&
    Array.isArray(fields.boardedPassengers.arrayValue.values)
      ? fields.boardedPassengers.arrayValue.values
      : [];

  // Parse joinRequests map
  const joinRequests: Record<string, JoinRequest> = {};
  if (isRecord(fields.joinRequests) && isRecord(fields.joinRequests.mapValue) && isRecord(fields.joinRequests.mapValue.fields)) {
    const jrFields = fields.joinRequests.mapValue.fields as Record<string, unknown>;
    for (const [pid, val] of Object.entries(jrFields)) {
      if (isRecord(val) && isRecord(val.mapValue) && isRecord(val.mapValue.fields)) {
        const f = val.mapValue.fields as Record<string, unknown>;
        const loc = readGeoPoint(isRecord(f.location) ? f.location.geoPointValue : null);
        const dropoff = readGeoPoint(isRecord(f.dropoff) ? f.dropoff.geoPointValue : null);
        const dropoffLabel = readString(isRecord(f.dropoffLabel) ? f.dropoffLabel.stringValue : "", "");
        joinRequests[pid] = {
          passengerId: pid,
          location: loc ?? { latitude: 0, longitude: 0 },
          status: readString(isRecord(f.status) ? f.status.stringValue : "pending", "pending") as JoinRequest["status"],
          requestedAt: readString(isRecord(f.requestedAt) ? f.requestedAt.stringValue : "", ""),
          ...(dropoff ? { dropoff } : {}),
          ...(dropoffLabel ? { dropoffLabel } : {}),
        };
      }
    }
  }

  // Parse driverLocation
  const driverLocation = readGeoPoint(
    isRecord(fields.driverLocation) ? fields.driverLocation.geoPointValue : null,
  );

  // Parse passengerPickups map
  const passengerPickups: Record<string, { latitude: number; longitude: number }> = {};
  if (isRecord(fields.passengerPickups) && isRecord(fields.passengerPickups.mapValue) && isRecord(fields.passengerPickups.mapValue.fields)) {
    const ppFields = fields.passengerPickups.mapValue.fields as Record<string, unknown>;
    for (const [uid, val] of Object.entries(ppFields)) {
      if (isRecord(val)) {
        const loc = readGeoPoint(val.geoPointValue);
        if (loc) passengerPickups[uid] = loc;
      }
    }
  }

  // Parse passengerDropoffs map
  const passengerDropoffs: Record<string, { latitude: number; longitude: number }> = {};
  if (isRecord(fields.passengerDropoffs) && isRecord(fields.passengerDropoffs.mapValue) && isRecord(fields.passengerDropoffs.mapValue.fields)) {
    const pdFields = fields.passengerDropoffs.mapValue.fields as Record<string, unknown>;
    for (const [uid, val] of Object.entries(pdFields)) {
      if (isRecord(val)) {
        const loc = readGeoPoint(val.geoPointValue);
        if (loc) passengerDropoffs[uid] = loc;
      }
    }
  }

  const departureAt = readString(
    isRecord(fields.departureAt) ? fields.departureAt.timestampValue : "",
    "",
  );

  // Parse pendingRatings
  const pendingRatingsValues =
    isRecord(fields.pendingRatings) &&
    isRecord(fields.pendingRatings.arrayValue) &&
    Array.isArray(fields.pendingRatings.arrayValue.values)
      ? fields.pendingRatings.arrayValue.values
      : [];

  // Parse ratingsSubmitted
  const ratingsSubmittedValues =
    isRecord(fields.ratingsSubmitted) &&
    isRecord(fields.ratingsSubmitted.arrayValue) &&
    Array.isArray(fields.ratingsSubmitted.arrayValue.values)
      ? fields.ratingsSubmitted.arrayValue.values
      : [];

  // Parse droppedPassengers
  const droppedPassengersValues =
    isRecord(fields.droppedPassengers) &&
    isRecord(fields.droppedPassengers.arrayValue) &&
    Array.isArray(fields.droppedPassengers.arrayValue.values)
      ? fields.droppedPassengers.arrayValue.values
      : [];

  // Parse confirmedDropoffPassengers
  const confirmedDropoffValues =
    isRecord(fields.confirmedDropoffPassengers) &&
    isRecord(fields.confirmedDropoffPassengers.arrayValue) &&
    Array.isArray(fields.confirmedDropoffPassengers.arrayValue.values)
      ? fields.confirmedDropoffPassengers.arrayValue.values
      : [];

  // Parse pendingConfirmation (passengers who haven't yet swiped to confirm)
  const pendingConfirmationValues =
    isRecord(fields.pendingConfirmation) &&
    isRecord(fields.pendingConfirmation.arrayValue) &&
    Array.isArray(fields.pendingConfirmation.arrayValue.values)
      ? fields.pendingConfirmation.arrayValue.values
      : [];

  const driverName = readString(
    isRecord(fields.driverName) ? fields.driverName.stringValue : "",
  );
  const driverAvatar = readString(
    isRecord(fields.driverAvatar) ? fields.driverAvatar.stringValue : "",
  );

  return {
    id,
    destination,
    destinationCoords,
    date: readString(isRecord(fields.date) ? fields.date.timestampValue : "", ""),
    seatsAvailable,
    time: readString(doc.createdTime, ""),
    driverId,
    driverName: driverName || undefined,
    driverAvatar: driverAvatar || undefined,
    passengers: passengerValues
      .map((v) => (isRecord(v) ? readString(v.stringValue, "") : ""))
      .filter(Boolean),
    localisation,
    started: isRecord(fields.started) ? Boolean(fields.started.booleanValue) : false,
    startedAt: readString(isRecord(fields.startedAt) ? fields.startedAt.timestampValue : "", "") || undefined,
    status: readString(isRecord(fields.status) ? fields.status.stringValue : "planned", "planned"),
    boardedPassengers: boardedValues
      .map((v: unknown) => (isRecord(v) ? readString(v.stringValue, "") : ""))
      .filter(Boolean),
    joinRequests: Object.keys(joinRequests).length > 0 ? joinRequests : undefined,
    driverLocation: driverLocation ?? undefined,
    passengerPickups: Object.keys(passengerPickups).length > 0 ? passengerPickups : undefined,
    passengerDropoffs: Object.keys(passengerDropoffs).length > 0 ? passengerDropoffs : undefined,
    departureAt: departureAt || undefined,
    maxPickupRadiusKm: isRecord(fields.maxPickupRadiusKm)
      ? readNumber(fields.maxPickupRadiusKm.integerValue, 0) || undefined
      : undefined,
    baseRouteKm: isRecord(fields.baseRouteKm)
      ? (Number(fields.baseRouteKm.doubleValue) ||
         Number(fields.baseRouteKm.integerValue) ||
         undefined)
      : undefined,
    maxDetourKm: isRecord(fields.maxDetourKm)
      ? (Number(fields.maxDetourKm.integerValue) ||
         Number(fields.maxDetourKm.doubleValue) ||
         undefined)
      : undefined,
    routePolyline: isRecord(fields.routePolyline)
      ? readString(fields.routePolyline.stringValue, "") || undefined
      : undefined,
    pendingRatings: pendingRatingsValues
      .map((v: unknown) => (isRecord(v) ? readString(v.stringValue, "") : ""))
      .filter(Boolean),
    ratingsSubmitted: ratingsSubmittedValues
      .map((v: unknown) => (isRecord(v) ? readString(v.stringValue, "") : ""))
      .filter(Boolean),
    droppedPassengers: droppedPassengersValues
      .map((v: unknown) => (isRecord(v) ? readString(v.stringValue, "") : ""))
      .filter(Boolean),
    confirmedDropoffPassengers: confirmedDropoffValues
      .map((v: unknown) => (isRecord(v) ? readString(v.stringValue, "") : ""))
      .filter(Boolean),
    pendingConfirmation: pendingConfirmationValues
      .map((v: unknown) => (isRecord(v) ? readString(v.stringValue, "") : ""))
      .filter(Boolean),
    confirmDeadlineAt:
      readString(isRecord(fields.confirmDeadlineAt) ? fields.confirmDeadlineAt.timestampValue : "", "") || undefined,
    requestId:
      readString(isRecord(fields.requestId) ? fields.requestId.stringValue : "", "") || undefined,
  };
};

async function getAuthHeaders(includeJson = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const user = getAuth().currentUser;

  if (user) {
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }

  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

async function throwFetchError(res: Response, message: string): Promise<never> {
  const details = await res.text().catch(() => "");
  const trimmedDetails = details ? `: ${details.slice(0, 300)}` : "";
  throw new Error(`${message} (status ${res.status})${trimmedDetails}`);
}

/** Create a new ride */
export async function createRide(rideData: {
  destination: string;
  date: string;
  seatsAvailable: number;
  geopoint: { latitude: number; longitude: number };
  destinationCoords: { lat: number | undefined; lng: number | undefined };
  started: boolean;
  maxPickupRadiusKm?: number;
  departureAt?: string;
  routePolyline?: string;
  maxDetourKm?: number;
  baseRouteKm?: number;
}) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");
  await assertCurrentUserHasPaymentMethod();

  // Fetch the driver's profile to embed name/avatar in the ride document
  let driverName = user.displayName || user.email?.split("@")[0] || "";
  let driverAvatar = "";
  try {
    const token = await user.getIdToken();
    const profileRes = await fetch(
      withFirebaseApiKey(`${USERS_BASE_URL}/${user.uid}`),
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      const pf = profileData.fields ?? {};
      driverName =
        (isRecord(pf.name) ? String(pf.name.stringValue ?? "") : "") ||
        (isRecord(pf.email) ? String(pf.email.stringValue ?? "").split("@")[0] : "") ||
        driverName;
      driverAvatar = isRecord(pf.avatar) ? String(pf.avatar.stringValue ?? "") : "";
    }
  } catch {
    // Continue with fallback name from auth user
  }

  const doc = {
    fields: {
      driverId: { stringValue: user.uid },
      driverName: { stringValue: driverName },
      driverAvatar: { stringValue: driverAvatar },
      localisation: {geoPointValue: {"latitude": rideData.geopoint.latitude, "longitude": rideData.geopoint.longitude}},

      destination: { stringValue: rideData.destination },
      destinationCoords: {geoPointValue: {"latitude": rideData.destinationCoords.lat, "longitude": rideData.destinationCoords.lng}},
      started: {booleanValue: rideData.started},
      status: {stringValue: "planned"},


      seatsAvailable: { integerValue: rideData.seatsAvailable },
      date: { timestampValue: rideData.date },

      passengers: { arrayValue: { values: [] } },
      joinRequests: { mapValue: { fields: {} } },
      ...(rideData.maxPickupRadiusKm !== undefined
        ? { maxPickupRadiusKm: { integerValue: rideData.maxPickupRadiusKm } }
        : {}),
      ...(rideData.departureAt
        ? { departureAt: { timestampValue: rideData.departureAt } }
        : {}),
      ...(rideData.routePolyline
        ? { routePolyline: { stringValue: rideData.routePolyline } }
        : {}),
      ...(rideData.maxDetourKm !== undefined
        ? { maxDetourKm: { integerValue: String(rideData.maxDetourKm) } }
        : {}),
      ...(rideData.baseRouteKm !== undefined && Number.isFinite(rideData.baseRouteKm)
        ? { baseRouteKm: { doubleValue: rideData.baseRouteKm } }
        : {}),
    },
  };

  const res = await fetch(withFirebaseApiKey(BASE_URL), {
    method: "POST",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(doc),
  });

  if (!res.ok) await throwFetchError(res, "Failed to create ride");
  invalidateRidesCache();
  return await res.json();
}

/** Fetch all available rides */
export async function fetchRides(options?: { force?: boolean }): Promise<Ride[]> {
  const now = Date.now();
  if (!options?.force && now - ridesFetchedAt < RIDES_CACHE_TTL_MS && cachedRides.length > 0) {
    return cachedRides;
  }
  if (!options?.force && ridesInFlight) {
    return ridesInFlight;
  }

  const authUser = getAuth().currentUser;
  if (!authUser) {
    // During logout/unmount race, avoid throwing permission errors.
    return [];
  }

  ridesInFlight = (async () => {
    const res = await fetch(withFirebaseApiKey(BASE_URL), {
      headers: await getAuthHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return [];
      }
      await throwFetchError(res, "Failed to fetch rides");
    }
    const data = (await res.json()) as { documents?: unknown[] };
    const rides = (data.documents ?? [])
      .map((doc) => parseRideFromFirestoreDocument(doc))
      .filter((ride): ride is Ride => ride !== null);

    cachedRides = rides;
    ridesFetchedAt = Date.now();
    return rides;
  })();

  try {
    return await ridesInFlight;
  } finally {
    ridesInFlight = null;
  }
}

export function invalidateRidesCache() {
  ridesFetchedAt = 0;
  cachedRides = [];
  ridesInFlight = null;
}

/** Accept (join) a ride */
export async function acceptRide(rideId: string, seatsRequested: number = 1) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");
  await assertCurrentUserHasPaymentMethod();

  const getUrl = withFirebaseApiKey(`${BASE_URL}/${rideId}`);
  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=passengers&updateMask.fieldPaths=seatsAvailable`,
  );

  // Get current ride state
  const rideRes = await fetch(getUrl, {
    headers: await getAuthHeaders(),
  });
  if (!rideRes.ok) await throwFetchError(rideRes, "Failed to fetch ride before accept");
  const rideData = await rideRes.json();

  const currentPassengers =
    rideData.fields.passengers.arrayValue?.values?.map((v: any) => v.stringValue) || [];

  // Add this user
  if (currentPassengers.includes(user.uid)) return rideData; // already joined

  currentPassengers.push(user.uid);

  const updateDoc = {
    fields: {
      passengers: {
        arrayValue: { values: currentPassengers.map((id: string) => ({ stringValue: id })) },
      },
      seatsAvailable: {
        integerValue: Math.max(0, Number(rideData.fields.seatsAvailable.integerValue) - seatsRequested),
      },
    },
  };

  const updateRes = await fetch(patchUrl, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });

  if (!updateRes.ok) await throwFetchError(updateRes, "Failed to accept ride");
  invalidateRidesCache();
  return await updateRes.json();
}

/** Delete ride (if you’re the driver) */
export async function deleteRide(rideId: string) {
  const res = await fetch(withFirebaseApiKey(`${BASE_URL}/${rideId}`), {
    method: "DELETE",
    headers: await getAuthHeaders(),
  });
  if (!res.ok) await throwFetchError(res, "Failed to delete ride");
  invalidateRidesCache();
}

export async function geoCode(place: string): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const encoded = encodeURIComponent(place);
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encoded}&components=administrative_area:QC|country:CA&key=${runtimeConfig.googleMapsApiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Network response was not ok");
    }

    const data = await response.json();
    if (data.status !== "OK" || !Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }

    const loc = data.results[0]?.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
      return null;
    }

    return { latitude: loc.lat, longitude: loc.lng };
  } catch (error) {
    console.error("Error fetching coordinates:", error);
    return null;
  }
}

export type LocationResult = {
  displayName: string;
  lat: string;
  lon: string;
  placeId?: string;
};

async function getPlaceCoordinates(
  placeId: string,
  signal?: AbortSignal,
): Promise<{ lat: string; lon: string } | null> {
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${encodeURIComponent(placeId)}&fields=geometry&key=${runtimeConfig.googleMapsApiKey}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const loc = data?.result?.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;
    return { lat: String(loc.lat), lon: String(loc.lng) };
  } catch {
    return null;
  }
}

export async function geoSuggestion(
  place: string,
  signal?: AbortSignal,
): Promise<LocationResult[]> {
  try { //`&locationrestriction=rectangle:44.99,-79.76|62.59,-57.10` +
    const encoded = encodeURIComponent(place);
    const url =
      `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
      `?input=${encoded}&components=country:ca` +
      
      `&language=fr&key=${runtimeConfig.googleMapsApiKey}`;

    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("Network response was not ok");
    const data = await response.json();
    if (data.status !== "OK" || !Array.isArray(data.predictions)) return [];

    const predictions = data.predictions.slice(0, 5) as Array<{
      description?: string;
      place_id?: string;
    }>;

    const results = await Promise.all(
      predictions.map(async (p): Promise<LocationResult | null> => {
        if (!p.description || !p.place_id) return null;
        const coords = await getPlaceCoordinates(p.place_id, signal);
        if (!coords) return null;
        return {
          displayName: p.description,
          lat: coords.lat,
          lon: coords.lon,
          placeId: p.place_id,
        };
      }),
    );

    return results.filter((r): r is LocationResult => r !== null);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") return [];
    console.error("geoSuggestion error:", error);
    return [];
  }
}

// Ratings + XP are now written exclusively by the /rides/rate Cloud Function
// (see submitRideRating below). The former client-side updateRatings()/updateXP()
// were removed: they did unauthenticated read-modify-write on user docs and were
// spoofable/racy. The tightened Firestore rules now block those writes entirely.

// ─── New Ride Flow Functions ──────────────────────────────────────────────────

const batchWriteUrl = (): string => `${firestoreBaseUrl}:batchWrite`;

const userDocPath = (uid: string): string => {
  const projectId = runtimeConfig.firebaseProjectId;
  const dbId = encodeURIComponent(runtimeConfig.firestoreDatabaseId);
  return `projects/${projectId}/databases/${dbId}/documents/users/${uid}`;
};

async function applyCancellationChargeToUser(
  uid: string,
  cents: number,
): Promise<void> {
  if (cents <= 0) return;
  const user = getAuth().currentUser;
  if (!user) return;
  const token = await user.getIdToken();

  const res = await fetch(withFirebaseApiKey(batchWriteUrl()), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      writes: [
        {
          transform: {
            document: userDocPath(uid),
            fieldTransforms: [
              {
                fieldPath: "pendingChargeCents",
                increment: { integerValue: String(cents) },
              },
            ],
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    console.warn(`Failed to apply cancellation charge to user ${uid}`);
    return;
  }

}

/** Request to join a ride (passenger sends request, driver must approve) */
export async function requestToJoinRide(
  rideId: string,
  passengerLocation: LocationPoint,
  seatsRequested: number = 1,
  dropoff?: LocationPoint,
  dropoffLabel?: string,
): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");
  await assertCurrentUserHasPaymentMethod();

  // Fetch current ride to validate
  const getUrl = withFirebaseApiKey(`${BASE_URL}/${rideId}`);
  const rideRes = await fetch(getUrl, { headers: await getAuthHeaders() });
  if (!rideRes.ok) await throwFetchError(rideRes, "Failed to fetch ride");
  const rideData = await rideRes.json();
  const fields = rideData.fields;

  const status = fields.status?.stringValue ?? "planned";
  if (status !== "planned") throw new Error("This ride is no longer accepting requests.");

  const seats = Number(fields.seatsAvailable?.integerValue ?? 0);
  if (seats < seatsRequested) throw new Error(`Not enough seats available (need ${seatsRequested}, have ${seats}).`);

  const passengers: string[] =
    fields.passengers?.arrayValue?.values?.map((v: any) => v.stringValue) ?? [];
  if (passengers.includes(user.uid)) throw new Error("You are already in this ride.");

  // Check passenger is within the driver's max pickup radius
  const maxPickupRadiusKm = Number(fields.maxPickupRadiusKm?.integerValue ?? 0);
  if (maxPickupRadiusKm > 0) {
    const driverLoc = isRecord(fields.localisation?.geoPointValue)
      ? fields.localisation.geoPointValue as { latitude: number; longitude: number }
      : null;
    if (driverLoc) {
      const distKm = haversineKm(
        passengerLocation.latitude, passengerLocation.longitude,
        driverLoc.latitude, driverLoc.longitude,
      );
      if (distKm > maxPickupRadiusKm) {
        throw new Error(`You are too far from the driver's location (${Math.round(distKm * 10) / 10} km away, max ${maxPickupRadiusKm} km).`);
      }
    }
  }

  // Check not already requested
  const existingRequest = fields.joinRequests?.mapValue?.fields?.[user.uid];
  if (existingRequest) {
    const reqStatus = existingRequest.mapValue?.fields?.status?.stringValue;
    if (reqStatus === "pending") throw new Error("You already have a pending request.");
    if (reqStatus === "accepted") throw new Error("You are already accepted.");
  }

  // Build the full joinRequests map with the new entry merged in
  const existingJR = fields.joinRequests?.mapValue?.fields ?? {};
  const mergedJR: Record<string, unknown> = { ...existingJR };
  mergedJR[user.uid] = {
    mapValue: {
      fields: {
        status: { stringValue: "pending" },
        location: {
          geoPointValue: {
            latitude: passengerLocation.latitude,
            longitude: passengerLocation.longitude,
          },
        },
        requestedAt: { stringValue: new Date().toISOString() },
        seatsRequested: { integerValue: String(seatsRequested) },
        ...(dropoff
          ? {
              dropoff: {
                geoPointValue: {
                  latitude: dropoff.latitude,
                  longitude: dropoff.longitude,
                },
              },
            }
          : {}),
        ...(dropoffLabel ? { dropoffLabel: { stringValue: dropoffLabel } } : {}),
      },
    },
  };

  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=joinRequests`,
  );
  const updateDoc = {
    fields: {
      joinRequests: {
        mapValue: { fields: mergedJR },
      },
    },
  };

  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
  if (!res.ok) await throwFetchError(res, "Failed to send join request");
  invalidateRidesCache();
}

/** Driver responds to a join request (accept or reject) */
export async function respondToJoinRequest(
  rideId: string,
  passengerId: string,
  accept: boolean,
): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  // Fetch current ride
  const getUrl = withFirebaseApiKey(`${BASE_URL}/${rideId}`);
  const rideRes = await fetch(getUrl, { headers: await getAuthHeaders() });
  if (!rideRes.ok) await throwFetchError(rideRes, "Failed to fetch ride");
  const rideData = await rideRes.json();
  const fields = rideData.fields;

  // Verify caller is the driver
  if (fields.driverId?.stringValue !== user.uid) {
    throw new Error("Only the driver can respond to join requests.");
  }

  // Build full joinRequests map with updated status
  const existingJR = fields.joinRequests?.mapValue?.fields ?? {};
  const mergedJR: Record<string, unknown> = { ...existingJR };
  const existingEntry = (existingJR as Record<string, any>)[passengerId]?.mapValue?.fields ?? {};
  mergedJR[passengerId] = {
    mapValue: {
      fields: {
        status: { stringValue: accept ? "accepted" : "rejected" },
        location: existingEntry.location ?? { geoPointValue: { latitude: 0, longitude: 0 } },
        requestedAt: existingEntry.requestedAt ?? { stringValue: "" },
        ...(existingEntry.seatsRequested ? { seatsRequested: existingEntry.seatsRequested } : {}),
        ...(existingEntry.dropoff ? { dropoff: existingEntry.dropoff } : {}),
        ...(existingEntry.dropoffLabel ? { dropoffLabel: existingEntry.dropoffLabel } : {}),
      },
    },
  };

  if (!accept) {
    // Reject: only update joinRequests
    const patchUrl = withFirebaseApiKey(
      `${BASE_URL}/${rideId}?updateMask.fieldPaths=joinRequests`,
    );
    const updateDoc = {
      fields: {
        joinRequests: { mapValue: { fields: mergedJR } },
      },
    };
    const res = await fetch(patchUrl, {
      method: "PATCH",
      headers: await getAuthHeaders(true),
      body: JSON.stringify(updateDoc),
    });
    if (!res.ok) await throwFetchError(res, "Failed to reject request");
    return;
  }

  // Accept: add to passengers[], decrement seats by seatsRequested, update joinRequest status
  const currentPassengers: string[] =
    fields.passengers?.arrayValue?.values?.map((v: any) => v.stringValue) ?? [];

  if (currentPassengers.includes(passengerId)) return; // already in

  currentPassengers.push(passengerId);
  const currentSeats = Number(fields.seatsAvailable?.integerValue ?? 0);
  const seatsRequested = Number(existingEntry.seatsRequested?.integerValue ?? 1);

  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=passengers&updateMask.fieldPaths=seatsAvailable&updateMask.fieldPaths=joinRequests&updateMask.fieldPaths=passengerSeats&updateMask.fieldPaths=passengerPickups&updateMask.fieldPaths=passengerDropoffs`,
  );

  // Build passengerSeats map
  const existingPS = fields.passengerSeats?.mapValue?.fields ?? {};
  const mergedPS: Record<string, unknown> = { ...existingPS };
  mergedPS[passengerId] = { integerValue: String(seatsRequested) };

  // Build passengerPickups map — copy passenger's location from join request
  const existingPP = fields.passengerPickups?.mapValue?.fields ?? {};
  const mergedPP: Record<string, unknown> = { ...existingPP };
  const passengerLoc = existingEntry.location ?? { geoPointValue: { latitude: 0, longitude: 0 } };
  mergedPP[passengerId] = passengerLoc;

  // Build passengerDropoffs map — copy dropoff from join request if present
  const existingPD = fields.passengerDropoffs?.mapValue?.fields ?? {};
  const mergedPD: Record<string, unknown> = { ...existingPD };
  if (existingEntry.dropoff) {
    mergedPD[passengerId] = existingEntry.dropoff;
  }

  const updateDoc = {
    fields: {
      passengers: {
        arrayValue: { values: currentPassengers.map((id: string) => ({ stringValue: id })) },
      },
      seatsAvailable: { integerValue: Math.max(0, currentSeats - seatsRequested) },
      joinRequests: { mapValue: { fields: mergedJR } },
      passengerSeats: { mapValue: { fields: mergedPS } },
      passengerPickups: { mapValue: { fields: mergedPP } },
      passengerDropoffs: { mapValue: { fields: mergedPD } },
    },
  };

  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
  if (!res.ok) await throwFetchError(res, "Failed to accept request");
  invalidateRidesCache();
}

/** Driver starts the ride — server-authoritative (locks passengers, blocks joins). */
export async function startRideService(rideId: string): Promise<void> {
  await apiPostRide("/rides/start", { rideId });
  invalidateRidesCache();
}

/** Update driver's live location on the ride doc */
export async function updateDriverLocation(
  rideId: string,
  location: LocationPoint,
): Promise<void> {
  const now = Date.now();
  if (now - lastDriverLocationWriteAt < DRIVER_LOCATION_THROTTLE_MS) return;
  lastDriverLocationWriteAt = now;
  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=driverLocation`,
  );
  const updateDoc = {
    fields: {
      driverLocation: {
        geoPointValue: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
      },
    },
  };
  // Fire-and-forget telemetry write: callers don't await this (it runs from the
  // location watcher), so a transient network failure — e.g. the blip when
  // returning from Google Maps — must be swallowed here, never thrown, or it
  // surfaces as an uncaught promise rejection.
  try {
    const res = await fetch(patchUrl, {
      method: "PATCH",
      headers: await getAuthHeaders(true),
      body: JSON.stringify(updateDoc),
    });
    if (!res.ok) {
      console.warn("Failed to update driver location");
    }
  } catch (e) {
    console.warn("Failed to update driver location (network)", e);
  }
}

/** Driver drops a passenger (or marks a no-show). Server derives confirmation
 *  and charge eligibility — the client only names the passenger. */
export async function markPassengerDropped(
  rideId: string,
  passengerId: string,
  opts?: { noShow?: boolean },
): Promise<void> {
  await apiPostRide("/rides/dropoff", {
    rideId,
    passengerId,
    ...(opts?.noShow ? { noShow: true } : {}),
  });
  invalidateRidesCache();
}

/** Passenger submits their rating of the driver (1–5). Server-authoritative. */
export async function submitRideRating(rideId: string, stars: number): Promise<void> {
  await apiPostRide("/rides/rate", { rideId, stars });
}

/** Passenger leaves an accepted ride before boarding (restores the seat). */
export async function leaveRide(rideId: string): Promise<void> {
  await apiPostRide("/rides/leave", { rideId });
  invalidateRidesCache();
}

/** Passenger swipes right to confirm the matched driver (mutual match).
 *  Removes them from the ride's pendingConfirmation set so the driver can start. */
export async function confirmDriver(rideId: string): Promise<void> {
  await apiPostRide("/rides/confirm-driver", { rideId });
  invalidateRidesCache();
}

/** Passenger swipes left to pass on the matched driver: leaves the ride
 *  (restores the seat) and re-opens the ride request so the search resumes. */
export async function rejectDriver(rideId: string): Promise<void> {
  await apiPostRide("/rides/reject-driver", { rideId });
  invalidateRidesCache();
}

/** Fetch a single ride by ID and parse it */
export async function fetchRideById(rideId: string): Promise<Ride | null> {
  const url = withFirebaseApiKey(`${BASE_URL}/${rideId}`);
  const res = await fetch(url, { headers: await getAuthHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return parseRideFromFirestoreDocument(data);
}

/** Directly enroll in a future/scheduled ride (no driver approval needed) */
export async function enrollInFutureRide(
  rideId: string,
  seatsRequested: number = 1,
  passengerLocation?: LocationPoint,
  dropoff?: LocationPoint,
): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");
  await assertCurrentUserHasPaymentMethod();

  const getUrl = withFirebaseApiKey(`${BASE_URL}/${rideId}`);
  const rideRes = await fetch(getUrl, { headers: await getAuthHeaders() });
  if (!rideRes.ok) await throwFetchError(rideRes, "Failed to fetch ride");
  const rideData = await rideRes.json();
  const fields = rideData.fields;

  const status = fields.status?.stringValue ?? "planned";
  if (status !== "planned") throw new Error("This ride is no longer available.");

  const seats = Number(fields.seatsAvailable?.integerValue ?? 0);
  if (seats < seatsRequested) throw new Error(`Not enough seats available (need ${seatsRequested}, have ${seats}).`);

  const currentPassengers: string[] =
    fields.passengers?.arrayValue?.values?.map((v: any) => v.stringValue) ?? [];
  if (currentPassengers.includes(user.uid)) throw new Error("You are already enrolled in this ride.");

  currentPassengers.push(user.uid);

  // Build passengerSeats map
  const existingPS = fields.passengerSeats?.mapValue?.fields ?? {};
  const mergedPS: Record<string, unknown> = { ...existingPS };
  mergedPS[user.uid] = { integerValue: String(seatsRequested) };

  // Build passengerPickups map
  const existingPP = fields.passengerPickups?.mapValue?.fields ?? {};
  const mergedPP: Record<string, unknown> = { ...existingPP };
  if (passengerLocation) {
    mergedPP[user.uid] = {
      geoPointValue: {
        latitude: passengerLocation.latitude,
        longitude: passengerLocation.longitude,
      },
    };
  }

  // Build passengerDropoffs map
  const existingPD = fields.passengerDropoffs?.mapValue?.fields ?? {};
  const mergedPD: Record<string, unknown> = { ...existingPD };
  if (dropoff) {
    mergedPD[user.uid] = {
      geoPointValue: {
        latitude: dropoff.latitude,
        longitude: dropoff.longitude,
      },
    };
  }

  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=passengers&updateMask.fieldPaths=seatsAvailable&updateMask.fieldPaths=passengerSeats&updateMask.fieldPaths=passengerPickups&updateMask.fieldPaths=passengerDropoffs`,
  );
  const updateDoc = {
    fields: {
      passengers: {
        arrayValue: { values: currentPassengers.map((id: string) => ({ stringValue: id })) },
      },
      seatsAvailable: { integerValue: Math.max(0, seats - seatsRequested) },
      passengerSeats: { mapValue: { fields: mergedPS } },
      passengerPickups: { mapValue: { fields: mergedPP } },
      passengerDropoffs: { mapValue: { fields: mergedPD } },
    },
  };

  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
  if (!res.ok) await throwFetchError(res, "Failed to enroll in ride");
  invalidateRidesCache();
}

/** Mark an expired planned ride — clears passengers and sets status to "expired".
 *  For abandoned started rides, call cleanupAbandonedStartedRide instead. */
export async function cleanupExpiredRide(rideId: string): Promise<void> {
  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=status&updateMask.fieldPaths=passengers&updateMask.fieldPaths=joinRequests`,
  );
  const updateDoc = {
    fields: {
      status: { stringValue: "expired" },
      passengers: { arrayValue: {} },
      joinRequests: { mapValue: { fields: {} } },
    },
  };
  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
  if (!res.ok) {
    console.warn(`Failed to cleanup expired ride ${rideId}`);
  }
  invalidateRidesCache();
}

/** Mark a started ride that's been abandoned (>3h without completion) as expired.
 *  Preserves passengers list for history / future payment reconciliation. */
export async function cleanupAbandonedStartedRide(rideId: string): Promise<void> {
  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=status`,
  );
  const updateDoc = {
    fields: {
      status: { stringValue: "expired" },
    },
  };
  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
  if (!res.ok) {
    console.warn(`Failed to cleanup abandoned started ride ${rideId}`);
  }
  invalidateRidesCache();
}

/** Cancel a pending join request (passenger cancels their own request).
 *  Applies `passengerCancelCents` to the user's pendingChargeCents unless
 *  they're still inside the grace window since they requested.
 *  Returns the fee applied (0 if within grace). */
export async function cancelJoinRequest(rideId: string): Promise<number> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  // Fetch current ride to get full joinRequests map
  const getUrl = withFirebaseApiKey(`${BASE_URL}/${rideId}`);
  const rideRes = await fetch(getUrl, { headers: await getAuthHeaders() });
  if (!rideRes.ok) await throwFetchError(rideRes, "Failed to fetch ride");
  const rideData = await rideRes.json();
  const existingJR = rideData.fields?.joinRequests?.mapValue?.fields ?? {};
  const existingEntry = (existingJR as Record<string, any>)[user.uid]?.mapValue?.fields ?? {};
  const requestedAt = readString(
    isRecord(existingEntry.requestedAt) ? existingEntry.requestedAt.stringValue : "",
    "",
  );
  const prevStatus = readString(
    isRecord(existingEntry.status) ? existingEntry.status.stringValue : "",
    "",
  );

  const mergedJR: Record<string, unknown> = { ...existingJR };
  mergedJR[user.uid] = {
    mapValue: {
      fields: {
        status: { stringValue: "rejected" },
        location: { geoPointValue: { latitude: 0, longitude: 0 } },
        requestedAt: { stringValue: "" },
      },
    },
  };

  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=joinRequests`,
  );
  const updateDoc = {
    fields: {
      joinRequests: { mapValue: { fields: mergedJR } },
    },
  };
  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
  if (!res.ok) await throwFetchError(res, "Failed to cancel request");
  invalidateRidesCache();

  // Only charge if passenger was actually pending/accepted AND outside grace.
  const shouldCharge =
    (prevStatus === "pending" || prevStatus === "accepted") &&
    !isWithinGraceWindow(requestedAt);
  if (!shouldCharge) return 0;

  await applyCancellationChargeToUser(
    user.uid,
    CANCELLATION_FEES.passengerCancelCents,
  );
  return CANCELLATION_FEES.passengerCancelCents;
}

/** Passenger quits an accepted ride — removes them from passengers[] and applies fee. */
export async function quitRide(rideId: string): Promise<number> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const getUrl = withFirebaseApiKey(`${BASE_URL}/${rideId}`);
  const rideRes = await fetch(getUrl, { headers: await getAuthHeaders() });
  if (!rideRes.ok) await throwFetchError(rideRes, "Failed to fetch ride");
  const rideData = await rideRes.json();
  const fields = rideData.fields ?? {};

  const currentPassengers: string[] =
    fields.passengers?.arrayValue?.values?.map((v: any) => v.stringValue) ?? [];
  if (!currentPassengers.includes(user.uid)) return 0;

  const remaining = currentPassengers.filter((id) => id !== user.uid);

  const existingPS = fields.passengerSeats?.mapValue?.fields ?? {};
  const seatsFreed = Number(
    existingPS[user.uid]?.integerValue ?? 1,
  );
  const currentSeats = Number(fields.seatsAvailable?.integerValue ?? 0);

  const mergedPS: Record<string, unknown> = { ...existingPS };
  delete mergedPS[user.uid];

  const existingPP = fields.passengerPickups?.mapValue?.fields ?? {};
  const mergedPP: Record<string, unknown> = { ...existingPP };
  delete mergedPP[user.uid];

  const existingPD = fields.passengerDropoffs?.mapValue?.fields ?? {};
  const mergedPD: Record<string, unknown> = { ...existingPD };
  delete mergedPD[user.uid];

  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=passengers&updateMask.fieldPaths=seatsAvailable&updateMask.fieldPaths=passengerSeats&updateMask.fieldPaths=passengerPickups&updateMask.fieldPaths=passengerDropoffs`,
  );
  const updateDoc = {
    fields: {
      passengers: {
        arrayValue: { values: remaining.map((id: string) => ({ stringValue: id })) },
      },
      seatsAvailable: { integerValue: String(currentSeats + seatsFreed) },
      passengerSeats: { mapValue: { fields: mergedPS } },
      passengerPickups: { mapValue: { fields: mergedPP } },
      passengerDropoffs: { mapValue: { fields: mergedPD } },
    },
  };
  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
  if (!res.ok) await throwFetchError(res, "Failed to quit ride");
  invalidateRidesCache();

  // Past grace — quitting an accepted ride always charges.
  await applyCancellationChargeToUser(
    user.uid,
    CANCELLATION_FEES.passengerCancelCents,
  );
  return CANCELLATION_FEES.passengerCancelCents;
}

/** Driver cancels their own ride — server marks it cancelled, releases
 *  passengers, and notifies them. Returns the cancellation fee applied (0). */
export async function cancelRideAsDriver(rideId: string): Promise<number> {
  await apiPostRide("/rides/cancel", { rideId });
  invalidateRidesCache();
  return CANCELLATION_FEES.driverCancelCents;
}
