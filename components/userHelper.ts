import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { extractFavoriteRoutes, fetchUserDocument } from "@/services/userService";
import type { LocationPoint, UserProfile } from "@/types/models";
import type { User } from "firebase/auth";

// function to deal with the firebase database for the users

type FirestoreUser = { fields?: Record<string, unknown> } | null;
type Location = LocationPoint;

async function fetchUser(uid:string) {
  const data = await fetchUserDocument(uid);
  if (data) {
    console.log(
      "Firestore user data:",
      JSON.stringify(data.fields?.avatar),
    );
  }
  return data;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const fieldString = (fields: Record<string, unknown>, key: string, fallback = "") => {
  const field = asRecord(fields[key]);
  return typeof field?.stringValue === "string" ? field.stringValue : fallback;
};

const fieldInt = (fields: Record<string, unknown>, key: string, fallback = 0) => {
  const field = asRecord(fields[key]);
  const parsed = Number(field?.integerValue);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeUserData = (
  data: FirestoreUser,
  fallbackLoc?: Location
): UserProfile => {
  const fields = asRecord(data?.fields) ?? {};
  const localisationField = asRecord(fields.localisation);
  const localisation = asRecord(localisationField?.geoPointValue);

  return {
    email: fieldString(fields, "email", ""),
    xp: fieldInt(fields, "xp", 0),
    rating: fieldInt(fields, "rating", 0),
    avatar: fieldString(fields, "avatar", "") || null,
    homeAddress: fieldString(fields, "homeAddress", "") || null,

    localisation: {
      latitude:
        (typeof localisation?.latitude === "number" ? localisation.latitude : null) ??
        fallbackLoc?.latitude ??
        null,
      longitude:
        (typeof localisation?.longitude === "number" ? localisation.longitude : null) ??
        fallbackLoc?.longitude ??
        null,
    },

    ridesCompleted: fieldInt(fields, "ridesCompleted", 0),
    favorite: extractFavoriteRoutes(data),
  };
};

export const shouldUpdateLocation = (
  live: Location,
  stored?: { latitude?: number; longitude?: number }
) => {
  if (!stored?.latitude || !stored?.longitude) return true;

  return (
    live.latitude !== stored.latitude ||
    live.longitude !== stored.longitude
  );
};


export const fetchAndSyncUserData = async ({
  user,
  getUserLocation,
  updateLoc,
  setUserData,
}: {
  user: User;
  getUserLocation: () => Promise<Location>;
  updateLoc: (token: string, uid: string, loc: Location) => Promise<void>;
  setUserData: (data: UserProfile) => void;
}) => {
  if (!user) return;

  try {
    const firestoreData = await fetchUser(user.uid);
    let loc: Location | undefined;

    try {
      loc = await getUserLocation();
    } catch (locationErr) {
      console.warn("Location unavailable, continuing without live location:", locationErr);
    }

    const normalized = normalizeUserData(firestoreData, loc);

    const needsUpdate = loc
      ? shouldUpdateLocation(
          loc,
          asRecord(asRecord(firestoreData?.fields)?.localisation)?.geoPointValue as
            | { latitude?: number; longitude?: number }
            | undefined,
        )
      : false;

    if (needsUpdate && loc) {
      try {
        await updateLoc(await user.getIdToken(), user.uid, loc);
        normalized.localisation = loc;
      } catch (updateErr) {
        console.warn("Failed to sync location to Firestore:", updateErr);
      }
    }

    if (!normalized.email && user?.email) {
      normalized.email = user.email;
    }

    setUserData(normalized);
  } catch (err) {
    console.error("fetchAndSyncUserData error:", err);
    setUserData({
      email: user?.email ?? "",
      xp: 0,
      rating: 0,
      avatar: null,
      homeAddress: null,
      localisation: { latitude: null, longitude: null },
      ridesCompleted: 0,
      favorite: [],
    });
  }
};

export async function patchUserField(
  token: string,
  uid: string,
  fields: Record<string, unknown>
) {
  const res = await fetch(
    firestoreDocumentUrl("users", uid),
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    }
  );

  if (!res.ok) throw new Error(await res.text());
}
