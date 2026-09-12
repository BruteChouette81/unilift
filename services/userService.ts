import {
  firestoreDocumentUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import type { FavoriteRoute } from "@/types/models";
import type { Language } from "@/constants/translations";
import { isRecord, readNumber, readString } from "@/services/firestore-rest";
import {
  extractPublicProfile,
  fetchPublicProfile,
  type PublicProfile,
} from "@/services/publicProfileService";

type FirestoreDocument = {
  fields?: Record<string, unknown>;
};

/** Read a `users/{uid}` document.
 *
 *  OWNER ONLY. The rules deny reading anybody else's — that document holds email,
 *  birth date, home address, push token, Stripe ids and money counters. To show
 *  another person on a ride card or a profile modal, use
 *  fetchPublicProfile(uid) from services/publicProfileService.ts. */
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

/** A driver's public-facing profile, shown on the passenger's ride screen and
 *  the swipe-to-confirm match card.
 *
 *  Now an alias of PublicProfile: it is read from `users/{uid}/public/profile`,
 *  never from `users/{uid}`, which is owner-only. See services/publicProfileService.ts. */
export type DriverProfile = PublicProfile;

/** Decode a public-profile REST document into a DriverProfile.
 *
 *  Kept as a named export because several screens decode a document they already
 *  hold. It now expects a `users/{uid}/public/profile` document — passing a raw
 *  `users/{uid}` document would yield an empty profile, and reading one for
 *  somebody else is denied by the rules anyway. */
export const extractDriverProfile = extractPublicProfile;

/** Fetch a driver's public profile by uid (authenticated). */
export function fetchDriverProfile(uid: string): Promise<DriverProfile | null> {
  return fetchPublicProfile(uid);
}


/**
 * The `users/{uid}` document a brand-new account starts life with.
 *
 * Both signup paths land here — the email one after `signUp()`, the Apple one
 * immediately after `signInToFirebaseWithApple()`. Apple gives us no birth date
 * or school, so those arrive empty and are collected later from Profile
 * Settings; the field still has to be *written*, so the document has a
 * consistent shape either way.
 */
export type NewUserProfile = {
  name: string;
  email: string;
  birthDate: string;
  school: string;
  /** E.164, or omitted. Present only when the consent box was ticked. */
  phone?: string;
};

/**
 * Create the Firestore profile for a freshly created account.
 *
 * ## The mask is the part that bites
 *
 * A `PATCH` with `updateMask.fieldPaths` writes *only* the listed paths — a
 * field present in the body but missing from the mask is silently dropped, with
 * a 200 back. So the phone pair has to be added to both, which is why they are
 * built from one conditional rather than two.
 *
 * Lives here rather than in the signup screen because the Apple path and the
 * email path were each carrying their own copy of it, and a mask fixed in one
 * would not have reached the other.
 */
export const createUserProfile = async (
  uid: string,
  token: string,
  data: NewUserProfile,
): Promise<void> => {
  const hasPhone = Boolean(data.phone);

  const maskPaths = [
    "name", "email", "createdAt", "birthDate", "school", "driverModeEnabled",
    ...(hasPhone ? ["phone", "phoneConsent"] : []),
  ];

  const res = await fetch(
    firestoreDocumentUrl("users", uid) +
      "?" + maskPaths.map((f) => `updateMask.fieldPaths=${f}`).join("&"),
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fields: {
          name:      { stringValue: data.name },
          email:     { stringValue: data.email },
          createdAt: { stringValue: new Date().toISOString() },
          birthDate: { stringValue: data.birthDate },
          school:    { stringValue: data.school },
          // Only written when the tick box was ticked, so an account never
          // starts life holding a number it has no permission to hold.
          ...(hasPhone
            ? {
                phone:        { stringValue: data.phone },
                phoneConsent: { booleanValue: true },
              }
            : {}),
          // Driver mode is ON by default for new users; toggled from profile.
          driverModeEnabled: { booleanValue: true },
        },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(await res.text());
  }
};
