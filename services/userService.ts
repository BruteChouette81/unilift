import {
  firestoreDocumentUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import type { FavoriteRoute } from "@/types/models";
import type { Language } from "@/constants/translations";

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
