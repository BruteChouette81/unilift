import {
  firestoreDocumentUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import type { FavoriteRoute } from "@/types/models";
import type { Language } from "@/constants/translations";
import { getAuth } from "firebase/auth";

// Inlined (not imported from components/userHelper) to avoid a module cycle:
// userHelper already imports from this file. Pure age-from-birthdate calc.
const ageFromBirthDate = (birthDateStr: string): number => {
  const birth = new Date(birthDateStr);
  if (isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

export type FirestoreDocument = {
  fields?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const readNumber = (value: unknown, fallback = 0): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export const fetchUserDocument = async (
  uid: string,
  token?: string,
): Promise<FirestoreDocument | null> => {
  if (!uid) return null;

  const url = withFirebaseApiKey(firestoreDocumentUrl("users", uid));

  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as FirestoreDocument;
  } catch {
    return null;
  }
};

export const extractFavoriteRoutes = (data: FirestoreDocument | null) => {
  const favoriteField = data?.fields?.favorite;
  const values =
    isRecord(favoriteField) &&
    isRecord(favoriteField.arrayValue) &&
    Array.isArray(favoriteField.arrayValue.values)
      ? favoriteField.arrayValue.values
      : [];

  if (!Array.isArray(values) || values.length === 0) return [];

  return values
    .map((item): FavoriteRoute | null => {
      if (!isRecord(item) || !isRecord(item.mapValue) || !isRecord(item.mapValue.fields)) {
        return null;
      }

      const fields = item.mapValue.fields;
      const destinationField = isRecord(fields.destination) ? fields.destination : {};
      const destinationGeoField = isRecord(fields.destinationGeolocation)
        ? fields.destinationGeolocation
        : {};
      const geoPoint = isRecord(destinationGeoField.geoPointValue)
        ? destinationGeoField.geoPointValue
        : {};

      return {
        destination: readString(destinationField.stringValue, ""),
        destinationGeo: {
          lat: readNumber(geoPoint.latitude, 0),
          lon: readNumber(geoPoint.longitude, 0),
        },
      };
    })
    .filter((route): route is FavoriteRoute => route !== null);
};

export const updateUserLanguage = async (
  uid: string,
  token: string,
  language: Language,
): Promise<void> => {
  const url = withFirebaseApiKey(
    firestoreDocumentUrl("users", uid) + "?updateMask.fieldPaths=language",
  );
  await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      fields: { language: { stringValue: language } },
    }),
  });
};

/** A driver's public-facing profile, shown on the passenger's ride screen and
 *  the swipe-to-confirm match card. Decoded from the users/{uid} Firestore doc. */
export type DriverProfile = {
  uid: string;
  name: string;
  xp: number;
  rating: number;
  avatar: string | null;
  ridesCompleted: number;
  school?: string;
  age?: number;
  instagramHandle?: string;
  certifications: string[];
};

/** Decode a raw users/{uid} Firestore REST document into a DriverProfile. */
export function extractDriverProfile(
  uid: string,
  doc: { fields?: Record<string, unknown> },
): DriverProfile {
  const fields = doc?.fields ?? {};
  const str = (key: string): string => {
    const v = fields[key] as Record<string, unknown> | undefined;
    return typeof v?.stringValue === "string" ? v.stringValue : "";
  };
  const num = (key: string): number => {
    const v = fields[key] as Record<string, unknown> | undefined;
    return Number(v?.integerValue ?? v?.doubleValue ?? 0);
  };
  const strArr = (key: string): string[] => {
    const v = fields[key] as Record<string, unknown> | undefined;
    const values = (v?.arrayValue as Record<string, unknown> | undefined)?.values;
    if (!Array.isArray(values)) return [];
    return values
      .map((e) => (e as Record<string, unknown>)?.stringValue)
      .filter((s): s is string => typeof s === "string");
  };
  const email = str("email");
  const name = str("name") || email.split("@")[0] || "Driver";
  const birthDate = str("birthDate");
  const storedAge = num("age");
  const age = birthDate ? ageFromBirthDate(birthDate) : (storedAge > 0 ? storedAge : undefined);
  return {
    uid,
    name,
    xp: num("xp"),
    rating: num("rating"),
    avatar: str("avatar") || null,
    ridesCompleted: num("ridesCompleted"),
    school: str("school") || undefined,
    age: typeof age === "number" && age > 0 ? age : undefined,
    instagramHandle: str("instagramHandle") || undefined,
    certifications: strArr("certifications"),
  };
}

/** Fetch and decode a driver's profile by uid (authenticated). */
export async function fetchDriverProfile(uid: string): Promise<DriverProfile | null> {
  if (!uid) return null;
  const token = await getAuth().currentUser?.getIdToken();
  const doc = await fetchUserDocument(uid, token);
  if (!doc) return null;
  return extractDriverProfile(uid, doc);
}

export const extractDriverSummary = (data: FirestoreDocument | null) => {
  const fields = data?.fields ?? {};
  const emailField = isRecord(fields.email) ? fields.email : {};
  const nameField = isRecord(fields.name) ? fields.name : {};
  const xpField = isRecord(fields.xp) ? fields.xp : {};
  const avatarField = isRecord(fields.avatar) ? fields.avatar : {};
  const email = readString(emailField.stringValue, "");
  // Prefer an explicit name field; fall back to the part before "@" in the email
  const displayName =
    readString(nameField.stringValue, "") ||
    (email ? email.split("@")[0] : "Unknown Driver");
  return {
    name: displayName,
    level: readNumber(xpField.integerValue, 0),
    avatar: readString(avatarField.stringValue, "") || null,
  };
};
