import { getAuth } from "firebase/auth";
import { GeoPoint } from "firebase/firestore";
import {
  firestoreCollectionUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import type { LocationPoint, Ride } from "@/types/models";

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

  return {
    id,
    destination,
    destinationCoords,
    date: readString(isRecord(fields.date) ? fields.date.timestampValue : "", ""),
    seatsAvailable,
    time: readString(doc.createdTime, ""),
    driverId,
    passengers: passengerValues
      .map((v) => (isRecord(v) ? readString(v.stringValue, "") : ""))
      .filter(Boolean),
    localisation,
    started: isRecord(fields.started) ? Boolean(fields.started.booleanValue) : false,
    status: readString(isRecord(fields.status) ? fields.status.stringValue : "planned", "planned"),
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
  geopoint: GeoPoint;
  destinationCoords: {lat:number|undefined, lng:number|undefined};
  started: boolean;
}) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const doc = {
    fields: {
      driverId: { stringValue: user.uid },
      localisation: {geoPointValue: {"latitude": rideData.geopoint.latitude, "longitude": rideData.geopoint.longitude}},
      
      destination: { stringValue: rideData.destination },
      destinationCoords: {geoPointValue: {"latitude": rideData.destinationCoords.lat, "longitude": rideData.destinationCoords.lng}},
      started: {booleanValue: rideData.started},
      status: {stringValue: "planned"}, //planned, started, arrived ==> delete ? 

      
      seatsAvailable: { integerValue: rideData.seatsAvailable },
      date: { timestampValue: rideData.date },
      
      passengers: { arrayValue: { values: [] } },
      //createdAt: { timestampValue: new Date().toISOString() },
    },
  };
  console.log(doc)

  const res = await fetch(withFirebaseApiKey(BASE_URL), {
    method: "POST",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(doc),
  });
  console.log(res)

  if (!res.ok) await throwFetchError(res, "Failed to create ride");
  invalidateRidesCache();
  return await res.json();
}

/** Fetch all available rides */
export async function fetchRides(options?: { force?: boolean }): Promise<Ride[]> {
  const now = Date.now();
  if (!options?.force && now - ridesFetchedAt < RIDES_CACHE_TTL_MS) {
    return cachedRides;
  }
  if (ridesInFlight) {
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
}

/** Accept (join) a ride */
export async function acceptRide(rideId: string) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const rideUrl = withFirebaseApiKey(
    `${BASE_URL}/${rideId}?updateMask.fieldPaths=passengers,seatsAvailable`,
  );

  // Get current passengers
  const rideRes = await fetch(rideUrl, {
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
        integerValue: Number(rideData.fields.seatsAvailable.integerValue - 1)
      }
    },
  };

  const updateRes = await fetch(rideUrl, { //+ `?key=${API_KEY}`
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

export async function geoSuggestion(place:string): Promise<LocationResult[] | null> {
   //if (!place.trim()) return [];
   console.log(place)

  try {
    // Encode the place name so it can safely be used in a URL
    const encodedPlace = encodeURIComponent(place);

    // Nominatim (OpenStreetMap) geocoding endpoint
    const url = `https://nominatim.openstreetmap.org/search?q=${encodedPlace}&format=json&addressdetails=1&limit=5&viewbox=-79.7624,62.5854,-57.1056,44.9917&bounded=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "UniLift/1.0"  // Nominatim requires a user-agent
      }
    });

    if (!response.ok) {
      throw new Error("Network response was not ok");
    }

   const data = (await response.json()) as unknown;
   if (!Array.isArray(data)) return [];

  return data
    .map((item) => parseSuggestionItem(item))
    .filter((item): item is LocationResult => item !== null);
  } catch (error) {
    console.error("Error fetching coordinates:", error);
    return null;
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
  let currentRatings = userData.fields.ratings?.integerValue || 0;
  let numberOfRatings = userData.fields.ratingWeigth?.integerValue || 0;
  const newRatings = ((currentRatings * numberOfRatings) + rating) / (Number(numberOfRatings) + 1);
  const updateDoc = {
    fields: {
      ratings: {integerValue: Math.round(newRatings)},
      ratingWeigth: {integerValue: Number(numberOfRatings) + 1}
    },
  };
  const updateRes = await fetch(`${userUrl}&updateMask.fieldPaths=ratings,ratingWeigth`, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
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
  let currentXP = userData.fields.xp?.integerValue || 0;
  const newXP = Number(currentXP) +  Math.floor(xpToAdd / 2);;
  const updateDoc = {
    fields: {
      xp: {integerValue: newXP}
    },
  };
  const updateRes = await fetch(`${userUrl}&updateMask.fieldPaths=xp`, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDoc),
  });
  if (!updateRes.ok) await throwFetchError(updateRes, "Failed to update XP");

  const driverUrl = withFirebaseApiKey(`${USERS_BASE_URL}/${driverId}`);
  const driverRes = await fetch(driverUrl, {
    headers: await getAuthHeaders(),
  });
  if (!driverRes.ok) await throwFetchError(driverRes, "Failed to fetch driver for XP");
  const driverData = await driverRes.json();
  let driverXP = driverData.fields.xp?.integerValue || 0;
  const newDriverXP = Number(driverXP) + xpToAdd

  const updateDriverDoc = {
    fields: {
      xp: {integerValue: newDriverXP}
    },
  };
  const updateDriverRes = await fetch(`${driverUrl}&updateMask.fieldPaths=xp`, {
    method: "PATCH",
    headers: await getAuthHeaders(true),
    body: JSON.stringify(updateDriverDoc),
  });
  if (!updateDriverRes.ok) await throwFetchError(updateDriverRes, "Failed to update driver XP");
  return;
}
