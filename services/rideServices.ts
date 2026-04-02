import {
  firestoreBaseUrl,
  firestoreCollectionUrl,
  runtimeConfig,
  withFirebaseApiKey
} from "@/constants/runtime-config";
import type { JoinRequest, LocationPoint, Ride } from "@/types/models";
import { getAuth } from "firebase/auth";

const BASE_URL = firestoreCollectionUrl("rides");
const USERS_BASE_URL = firestoreCollectionUrl("users");
const RIDES_CACHE_TTL_MS = 3000;
let ridesInFlight: Promise<Ride[]> | null = null;
let cachedRides: Ride[] = [];
let ridesFetchedAt = 0;

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
  //console.log(seatsAvailable)
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
        joinRequests[pid] = {
          passengerId: pid,
          location: loc ?? { latitude: 0, longitude: 0 },
          status: readString(isRecord(f.status) ? f.status.stringValue : "pending", "pending") as JoinRequest["status"],
          requestedAt: readString(isRecord(f.requestedAt) ? f.requestedAt.stringValue : "", ""),
        };
      }
    }
  }

  // Parse driverLocation
  const driverLocation = readGeoPoint(
    isRecord(fields.driverLocation) ? fields.driverLocation.geoPointValue : null,
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
    status: readString(isRecord(fields.status) ? fields.status.stringValue : "planned", "planned"),
    boardedPassengers: boardedValues
      .map((v: unknown) => (isRecord(v) ? readString(v.stringValue, "") : ""))
      .filter(Boolean),
    joinRequests: Object.keys(joinRequests).length > 0 ? joinRequests : undefined,
    driverLocation: driverLocation ?? undefined,
    pendingRatings: pendingRatingsValues
      .map((v: unknown) => (isRecord(v) ? readString(v.stringValue, "") : ""))
      .filter(Boolean),
    ratingsSubmitted: ratingsSubmittedValues
      .map((v: unknown) => (isRecord(v) ? readString(v.stringValue, "") : ""))
      .filter(Boolean),
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
}) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

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
export async function acceptRide(rideId: string) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

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
        integerValue: Number(rideData.fields.seatsAvailable.integerValue) - 1,
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

export async function geoCode(place:string) {
  try {
    // Encode the place name so it can safely be used in a URL
    const encodedPlace = encodeURIComponent(place);

    // Nominatim (OpenStreetMap) geocoding endpoint
    const url = `https://nominatim.openstreetmap.org/search?q=${encodedPlace}&format=json&limit=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "UniLift/1.0"  // Nominatim requires a user-agent
      }
    });

    if (!response.ok) {
      throw new Error("Network response was not ok");
    }

    const data = await response.json();

    if (data.length === 0) {
      return null; // No results found
    }

    // Extract latitude and longitude from the first result
    const { lat, lon } = data[0];

    return {
      latitude: Number(lat),
      longitude: Number(lon)
    };
  } catch (error) {
    console.error("Error fetching coordinates:", error);
    return null;
  }
}

export type LocationResult = {
  displayName: string;
  lat: string;
  lon: string;
};

const parseSuggestionItem = (item: unknown): LocationResult | null => {
  if (!isRecord(item)) return null;
  const displayName = readString(item.display_name, "");
  const lat = readString(item.lat, "");
  const lon = readString(item.lon, "");
  if (!displayName || !lat || !lon) return null;
  return { displayName, lat, lon };
};

export async function geoSuggestion(
  place: string,
  signal?: AbortSignal,
): Promise<LocationResult[]> {
  try {
    const encoded = encodeURIComponent(place);
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encoded}&format=json&countrycodes=ca&viewbox=-79.8,62.6,-57.1,44.9&bounded=1&limit=5&addressdetails=1&accept-language=fr`
    const response = await fetch(url, {
      headers: { "User-Agent": "UniLift/1.0" },
      signal,
    });
    if (!response.ok) throw new Error("Network response was not ok");
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .map((item) => parseSuggestionItem(item))
      .filter((item): item is LocationResult => item !== null);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") return [];
    console.error("geoSuggestion error:", error);
    return [];
  }
}

export async function updateRatings(rideId: string, rating: number) {
  //get driver id from rideId
   const res = await fetch(withFirebaseApiKey(`${BASE_URL}/${rideId}`), {
    headers: await getAuthHeaders(),
  });
  if (!res.ok) await throwFetchError(res, "Failed to fetch ride for rating");
  const data = await res.json();
  console.log(data)

  const driverId = data.fields.driverId.stringValue;
  //update driver's ratings in users collection
  const userUrl = withFirebaseApiKey(`${USERS_BASE_URL}/${driverId}`);
  const userRes = await fetch(userUrl, {
    headers: await getAuthHeaders(),
  });
  if (!userRes.ok) await throwFetchError(userRes, "Failed to fetch user for rating");
  const userData = await userRes.json();
  const currentRatings = Number(userData.fields.ratings?.integerValue) || 0;
  const numberOfRatings = Number(userData.fields.ratingWeigth?.integerValue) || 0;
  const newRatings = ((currentRatings * numberOfRatings) + rating) / (numberOfRatings + 1);
  const updateDoc = {
    fields: {
      ratings: { integerValue: Math.round(newRatings) },
      ratingWeigth: { integerValue: numberOfRatings + 1 },
    },
  };

  const updateRes = await fetch(
    `${userUrl}&updateMask.fieldPaths=ratings&updateMask.fieldPaths=ratingWeigth`,
    {
      method: "PATCH",
      headers: await getAuthHeaders(true),
      body: JSON.stringify(updateDoc),
    },
  );
  if (!updateRes.ok) await throwFetchError(updateRes, "Failed to update ratings");
  return driverId;

}

export async function updateXP(userId: string, driverId: string, xpToAdd: number) {
  //update user's XP in users collection
  const userUrl = withFirebaseApiKey(`${USERS_BASE_URL}/${userId}`);
  const userRes = await fetch(userUrl, {
    headers: await getAuthHeaders(),
  });
  if (!userRes.ok) await throwFetchError(userRes, "Failed to fetch user for XP");
  const userData = await userRes.json();
  const currentXP = Number(userData.fields.xp?.integerValue) || 0;
  const currentRidesCompleted = Number(userData.fields.ridesCompleted?.integerValue) || 0;
  const newXP = currentXP + Math.floor(xpToAdd / 2);
  const updateDoc = {
    fields: {
      xp: { integerValue: newXP },
      ridesCompleted: { integerValue: currentRidesCompleted + 1 },
    },
  };
  const updateRes = await fetch(
    `${userUrl}&updateMask.fieldPaths=xp&updateMask.fieldPaths=ridesCompleted`,
    {
      method: "PATCH",
      headers: await getAuthHeaders(true),
      body: JSON.stringify(updateDoc),
    },
  );
  if (!updateRes.ok) await throwFetchError(updateRes, "Failed to update XP");

  const driverUrl = withFirebaseApiKey(`${USERS_BASE_URL}/${driverId}`);
  const driverRes = await fetch(driverUrl, {
    headers: await getAuthHeaders(),
  });
  if (!driverRes.ok) await throwFetchError(driverRes, "Failed to fetch driver for XP");
  const driverData = await driverRes.json();
  const driverXP = Number(driverData.fields.xp?.integerValue) || 0;
  const driverRidesCompleted = Number(driverData.fields.ridesCompleted?.integerValue) || 0;
  const newDriverXP = driverXP + xpToAdd;

  const updateDriverDoc = {
    fields: {
      xp: { integerValue: newDriverXP },
      ridesCompleted: { integerValue: driverRidesCompleted + 1 },
    },
  };
  const updateDriverRes = await fetch(
    `${driverUrl}&updateMask.fieldPaths=xp&updateMask.fieldPaths=ridesCompleted`,
    {
      method: "PATCH",
      headers: await getAuthHeaders(true),
      body: JSON.stringify(updateDriverDoc),
    },
  );
  if (!updateDriverRes.ok) await throwFetchError(updateDriverRes, "Failed to update driver XP");
  return;
}

// ─── New Ride Flow Functions ──────────────────────────────────────────────────

const batchWriteUrl = (): string => `${firestoreBaseUrl}:batchWrite`;

const rideDocPath = (rideId: string): string => {
  const projectId = runtimeConfig.firebaseProjectId;
  const dbId = encodeURIComponent(runtimeConfig.firestoreDatabaseId);
  return `projects/${projectId}/databases/${dbId}/documents/rides/${rideId}`;
};

/** Request to join a ride (passenger sends request, driver must approve) */
export async function requestToJoinRide(
  rideId: string,
  passengerLocation: LocationPoint,
): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  // Fetch current ride to validate
  const getUrl = withFirebaseApiKey(`${BASE_URL}/${rideId}`);
  const rideRes = await fetch(getUrl, { headers: await getAuthHeaders() });
  if (!rideRes.ok) await throwFetchError(rideRes, "Failed to fetch ride");
  const rideData = await rideRes.json();
  const fields = rideData.fields;

  const status = fields.status?.stringValue ?? "planned";
  if (status !== "planned") throw new Error("This ride is no longer accepting requests.");

  const seats = Number(fields.seatsAvailable?.integerValue ?? 0);
  if (seats <= 0) throw new Error("No seats available.");

  const passengers: string[] =
    fields.passengers?.arrayValue?.values?.map((v: any) => v.stringValue) ?? [];
  if (passengers.includes(user.uid)) throw new Error("You are already in this ride.");

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

  // Accept: add to passengers[], decrement seats, update joinRequest status
  const currentPassengers: string[] =
    fields.passengers?.arrayValue?.values?.map((v: any) => v.stringValue) ?? [];

  if (currentPassengers.includes(passengerId)) return; // already in

  currentPassengers.push(passengerId);
  const currentSeats = Number(fields.seatsAvailable?.integerValue ?? 0);

  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=passengers&updateMask.fieldPaths=seatsAvailable&updateMask.fieldPaths=joinRequests`,
  );
  const updateDoc = {
    fields: {
      passengers: {
        arrayValue: { values: currentPassengers.map((id: string) => ({ stringValue: id })) },
      },
      seatsAvailable: { integerValue: Math.max(0, currentSeats - 1) },
      joinRequests: { mapValue: { fields: mergedJR } },
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

/** Driver starts the ride — locks passengers, blocks new joins */
export async function startRideService(rideId: string): Promise<void> {
  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=status&updateMask.fieldPaths=started`,
  );
  const updateDoc = {
    fields: {
      status: { stringValue: "started" },
      started: { booleanValue: true },
    },
  };
  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
  if (!res.ok) await throwFetchError(res, "Failed to start ride");
  invalidateRidesCache();
}

/** Update driver's live location on the ride doc */
export async function updateDriverLocation(
  rideId: string,
  location: LocationPoint,
): Promise<void> {
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
  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
  if (!res.ok) {
    console.warn("Failed to update driver location");
  }
}

/** Mark ride as completed and set pendingRatings */
export async function markRideCompleted(
  rideId: string,
  passengerIds: string[],
): Promise<void> {
  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=status&updateMask.fieldPaths=pendingRatings&updateMask.fieldPaths=ratingsSubmitted`,
  );
  const updateDoc = {
    fields: {
      status: { stringValue: "completed" },
      pendingRatings: {
        arrayValue: {
          values: passengerIds.map((id) => ({ stringValue: id })),
        },
      },
      ratingsSubmitted: { arrayValue: { values: [] } },
    },
  };
  const res = await fetch(patchUrl, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
  if (!res.ok) await throwFetchError(res, "Failed to mark ride completed");
  invalidateRidesCache();
}

/** Submit a passenger's rating (append to ratingsSubmitted) */
export async function submitRating(rideId: string, passengerId: string): Promise<void> {
  const docPath = rideDocPath(rideId);
  const res = await fetch(withFirebaseApiKey(batchWriteUrl()), {
    method: "POST",
    headers: await getAuthHeaders(true),
    body: JSON.stringify({
      writes: [
        {
          transform: {
            document: docPath,
            fieldTransforms: [
              {
                fieldPath: "ratingsSubmitted",
                appendMissingElements: {
                  values: [{ stringValue: passengerId }],
                },
              },
            ],
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    console.warn("Failed to submit rating record");
  }
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
export async function enrollInFutureRide(rideId: string): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const getUrl = withFirebaseApiKey(`${BASE_URL}/${rideId}`);
  const rideRes = await fetch(getUrl, { headers: await getAuthHeaders() });
  if (!rideRes.ok) await throwFetchError(rideRes, "Failed to fetch ride");
  const rideData = await rideRes.json();
  const fields = rideData.fields;

  const status = fields.status?.stringValue ?? "planned";
  if (status !== "planned") throw new Error("This ride is no longer available.");

  const seats = Number(fields.seatsAvailable?.integerValue ?? 0);
  if (seats <= 0) throw new Error("No seats available.");

  const currentPassengers: string[] =
    fields.passengers?.arrayValue?.values?.map((v: any) => v.stringValue) ?? [];
  if (currentPassengers.includes(user.uid)) throw new Error("You are already enrolled in this ride.");

  currentPassengers.push(user.uid);

  const patchUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=passengers&updateMask.fieldPaths=seatsAvailable`,
  );
  const updateDoc = {
    fields: {
      passengers: {
        arrayValue: { values: currentPassengers.map((id: string) => ({ stringValue: id })) },
      },
      seatsAvailable: { integerValue: Math.max(0, seats - 1) },
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

/** Cancel a pending join request (passenger cancels their own request) */
export async function cancelJoinRequest(rideId: string): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  // Fetch current ride to get full joinRequests map
  const getUrl = withFirebaseApiKey(`${BASE_URL}/${rideId}`);
  const rideRes = await fetch(getUrl, { headers: await getAuthHeaders() });
  if (!rideRes.ok) await throwFetchError(rideRes, "Failed to fetch ride");
  const rideData = await rideRes.json();
  const existingJR = rideData.fields?.joinRequests?.mapValue?.fields ?? {};

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
}
