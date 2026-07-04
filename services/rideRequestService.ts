import {
  firestoreBaseUrl,
  firestoreCollectionUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import type { LocationPoint, RideRequest } from "@/types/models";
import { getAuth } from "firebase/auth";

const BASE_URL = firestoreCollectionUrl("rideRequests");
const USERS_BASE_URL = firestoreCollectionUrl("users");

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

async function getAuthHeaders(includeJson = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const user = getAuth().currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }
  if (includeJson) headers["Content-Type"] = "application/json";
  return headers;
}

async function throwFetchError(res: Response, message: string): Promise<never> {
  const details = await res.text().catch(() => "");
  const trimmed = details ? `: ${details.slice(0, 300)}` : "";
  throw new Error(`${message} (status ${res.status})${trimmed}`);
}

function parseRideRequestFromFirestoreDocument(doc: unknown): RideRequest | null {
  if (!isRecord(doc) || !isRecord(doc.fields)) return null;
  const fields = doc.fields;
  const name = readString(doc.name, "");
  const id = name.split("/").pop() || "";

  const passengerId = readString(
    isRecord(fields.passengerId) ? fields.passengerId.stringValue : "",
  );
  const destination = readString(
    isRecord(fields.destination) ? fields.destination.stringValue : "",
  );
  const origin = readGeoPoint(
    isRecord(fields.origin) ? fields.origin.geoPointValue : null,
  );

  if (!id || !passengerId || !destination || !origin) return null;

  const destinationCoords =
    readGeoPoint(
      isRecord(fields.destinationCoords) ? fields.destinationCoords.geoPointValue : null,
    ) ?? { latitude: 0, longitude: 0 };

  const passengerName = readString(
    isRecord(fields.passengerName) ? fields.passengerName.stringValue : "",
  );
  const passengerAvatar = readString(
    isRecord(fields.passengerAvatar) ? fields.passengerAvatar.stringValue : "",
  );
  const originLabel = readString(
    isRecord(fields.originLabel) ? fields.originLabel.stringValue : "",
  );

  return {
    id,
    passengerId,
    passengerName: passengerName || undefined,
    passengerAvatar: passengerAvatar || undefined,
    origin,
    originLabel: originLabel || undefined,
    destination,
    destinationCoords,
    date: readString(isRecord(fields.date) ? fields.date.timestampValue : "", ""),
    seatsRequested: readNumber(
      isRecord(fields.seatsRequested) ? fields.seatsRequested.integerValue : 1,
      1,
    ),
    status: readString(isRecord(fields.status) ? fields.status.stringValue : "open", "open"),
    createdAt:
      readString(isRecord(fields.createdAt) ? fields.createdAt.timestampValue : "", "") ||
      undefined,
    matchedRideId: readString(isRecord(fields.matchedRideId) ? fields.matchedRideId.stringValue : "", "") || undefined,
    matchedDriverId: readString(isRecord(fields.matchedDriverId) ? fields.matchedDriverId.stringValue : "", "") || undefined,
  };
}

/** Fetch a single ride request by id (used by the passenger waiting screen). */
export async function fetchRideRequestById(requestId: string): Promise<RideRequest | null> {
  const res = await fetch(withFirebaseApiKey(`${BASE_URL}/${requestId}`), {
    headers: await getAuthHeaders(),
  });
  if (!res.ok) return null;
  return parseRideRequestFromFirestoreDocument(await res.json());
}

/** Create a planned ride request (passenger queues a future trip). */
export async function createRideRequest(data: {
  destination: string;
  destinationCoords: { lat: number | undefined; lng: number | undefined };
  origin: LocationPoint;
  originLabel?: string;
  date: string;
  seatsRequested: number;
}): Promise<{ name: string }> {
  const user = getAuth().currentUser;
  if (!user) throw new Error("Not authenticated");

  // Embed the passenger's name/avatar so drivers can show it later without
  // an extra profile fetch (mirrors how createRide embeds the driver).
  let passengerName = user.displayName || user.email?.split("@")[0] || "";
  let passengerAvatar = "";
  try {
    const token = await user.getIdToken();
    const profileRes = await fetch(
      withFirebaseApiKey(`${USERS_BASE_URL}/${user.uid}`),
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      const pf = profileData.fields ?? {};
      passengerName =
        (isRecord(pf.name) ? String(pf.name.stringValue ?? "") : "") ||
        (isRecord(pf.email) ? String(pf.email.stringValue ?? "").split("@")[0] : "") ||
        passengerName;
      passengerAvatar = isRecord(pf.avatar) ? String(pf.avatar.stringValue ?? "") : "";
    }
  } catch {
    // Fall back to the auth user's display name.
  }

  const doc = {
    fields: {
      passengerId: { stringValue: user.uid },
      passengerName: { stringValue: passengerName },
      passengerAvatar: { stringValue: passengerAvatar },
      origin: {
        geoPointValue: {
          latitude: data.origin.latitude,
          longitude: data.origin.longitude,
        },
      },
      ...(data.originLabel ? { originLabel: { stringValue: data.originLabel } } : {}),
      destination: { stringValue: data.destination },
      destinationCoords: {
        geoPointValue: {
          latitude: data.destinationCoords.lat ?? 0,
          longitude: data.destinationCoords.lng ?? 0,
        },
      },
      date: { timestampValue: data.date },
      seatsRequested: { integerValue: String(data.seatsRequested) },
      status: { stringValue: "open" },
      createdAt: { timestampValue: new Date().toISOString() },
    },
  };

  const res = await fetch(withFirebaseApiKey(BASE_URL), {
    method: "POST",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(doc),
  });
  if (!res.ok) await throwFetchError(res, "Failed to create ride request");
  return await res.json();
}

/** Fetch the current user's ride requests (server-side filtered by passengerId). */
export async function fetchMyRideRequests(): Promise<RideRequest[]> {
  const user = getAuth().currentUser;
  if (!user) return [];

  const res = await fetch(withFirebaseApiKey(`${firestoreBaseUrl}:runQuery`), {
    method: "POST",
    headers: await getAuthHeaders(true),
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "rideRequests" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "passengerId" },
            op: "EQUAL",
            value: { stringValue: user.uid },
          },
        },
      },
    }),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403 || res.status === 404) return [];
    await throwFetchError(res, "Failed to fetch ride requests");
  }
  const data = (await res.json()) as Array<{ document?: unknown }>;
  return data
    .filter((entry) => entry.document != null)
    .map((entry) => parseRideRequestFromFirestoreDocument(entry.document))
    .filter((r): r is RideRequest => r !== null);
}

/** Fetch all currently-open ride requests (for the driver inbox), excluding
 *  the caller's own. Detour-filtering happens client-side in the inbox. */
export async function fetchOpenRideRequests(): Promise<RideRequest[]> {
  const user = getAuth().currentUser;
  if (!user) return [];
  const res = await fetch(withFirebaseApiKey(BASE_URL), { headers: await getAuthHeaders() });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403 || res.status === 404) return [];
    await throwFetchError(res, "Failed to fetch open ride requests");
  }
  const data = (await res.json()) as { documents?: unknown[] };
  return (data.documents ?? [])
    .map((doc) => parseRideRequestFromFirestoreDocument(doc))
    .filter((r): r is RideRequest => r !== null && r.status === "open" && r.passengerId !== user.uid);
}

/** Cancel (delete) a ride request the user owns. */
export async function cancelRideRequest(requestId: string): Promise<void> {
  const res = await fetch(withFirebaseApiKey(`${BASE_URL}/${requestId}`), {
    method: "DELETE",
    headers: await getAuthHeaders(),
  });
  if (!res.ok) await throwFetchError(res, "Failed to cancel ride request");
}
