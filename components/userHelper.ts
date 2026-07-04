import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { type Language, SUPPORTED_LANGUAGES } from "@/constants/translations";
import { extractFavoriteRoutes, fetchUserDocument } from "@/services/userService";
import type { DriverAvailabilityWindow, LocationPoint, UserProfile, WeekdayKey } from "@/types/models";
import { WEEKDAY_KEYS } from "@/types/models";
import type { User } from "firebase/auth";

// function to deal with the firebase database for the users

type FirestoreUser = { fields?: Record<string, unknown> } | null;
type Location = LocationPoint;

async function fetchUser(uid: string, token?: string) {
  return await fetchUserDocument(uid, token);
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

export const calculateAgeFromBirthDate = (birthDateStr: string): number => {
  const birth = new Date(birthDateStr);
  if (isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

/** Format a YYYY-MM-DD string as DD/MM/YYYY for display. */
export const formatBirthDateForDisplay = (isoDate: string): string => {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
};

/** Parse a DD/MM/YYYY input string into YYYY-MM-DD for storage. Returns "" if invalid. */
export const parseBirthDateInput = (input: string): string => {
  const cleaned = input.replace(/\D/g, "");
  if (cleaned.length !== 8) return "";
  const d = cleaned.slice(0, 2);
  const m = cleaned.slice(2, 4);
  const y = cleaned.slice(4, 8);
  const date = new Date(`${y}-${m}-${d}`);
  if (isNaN(date.getTime())) return "";
  return `${y}-${m}-${d}`;
};

/** Auto-format raw digit input into DD/MM/YYYY as the user types. */
export const autoFormatDateInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const fieldStringArray = (fields: Record<string, unknown>, key: string): string[] => {
  const field = asRecord(fields[key]);
  const arrayValue = asRecord(field?.arrayValue);
  if (!Array.isArray(arrayValue?.values)) return [];
  return (arrayValue.values as unknown[])
    .map((v) => asRecord(v)?.stringValue)
    .filter((s): s is string => typeof s === "string");
};

/** Parse the `driverAvailability` array-of-maps field from a Firestore user doc. */
const parseDriverAvailability = (fields: Record<string, unknown>): DriverAvailabilityWindow[] => {
  const field = asRecord(fields.driverAvailability);
  const arrayValue = asRecord(field?.arrayValue);
  if (!Array.isArray(arrayValue?.values)) return [];
  return (arrayValue.values as unknown[])
    .map((item): DriverAvailabilityWindow | null => {
      const mapValue = asRecord(asRecord(item)?.mapValue);
      const wf = asRecord(mapValue?.fields);
      if (!wf) return null;
      const days = fieldStringArray(wf, "days").filter(
        (d): d is WeekdayKey => (WEEKDAY_KEYS as readonly string[]).includes(d),
      );
      const destination = fieldString(wf, "destination", "");
      const gp = asRecord(asRecord(wf.destinationCoords)?.geoPointValue);
      if (!gp || typeof gp.latitude !== "number" || typeof gp.longitude !== "number") return null;
      if (days.length === 0 || !destination) return null;
      return {
        id: fieldString(wf, "id", "") || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        days,
        startMinutes: fieldInt(wf, "startMinutes", 0),
        endMinutes: fieldInt(wf, "endMinutes", 0),
        destination,
        destinationCoords: { latitude: gp.latitude, longitude: gp.longitude },
      };
    })
    .filter((w): w is DriverAvailabilityWindow => w !== null);
};

/** Encode availability windows into Firestore field-value maps for a PATCH. */
export const encodeDriverAvailabilityFields = (
  windows: DriverAvailabilityWindow[],
): Record<string, unknown> => {
  const days = Array.from(new Set(windows.flatMap((w) => w.days)));
  return {
    driverAvailability: {
      arrayValue: {
        values: windows.map((w) => ({
          mapValue: {
            fields: {
              id: { stringValue: w.id },
              days: { arrayValue: { values: w.days.map((d) => ({ stringValue: d })) } },
              startMinutes: { integerValue: String(w.startMinutes) },
              endMinutes: { integerValue: String(w.endMinutes) },
              destination: { stringValue: w.destination },
              destinationCoords: {
                geoPointValue: {
                  latitude: w.destinationCoords.latitude,
                  longitude: w.destinationCoords.longitude,
                },
              },
            },
          },
        })),
      },
    },
    // Derived index for the backend's cheap array-contains pre-filter.
    driverDays: { arrayValue: { values: days.map((d) => ({ stringValue: d })) } },
  };
};

export const normalizeUserData = (
  data: FirestoreUser,
  fallbackLoc?: Location
): UserProfile => {
  const fields = asRecord(data?.fields) ?? {};
  const localisationField = asRecord(fields.localisation);
  const localisation = asRecord(localisationField?.geoPointValue);

  const name = fieldString(fields, "name", "");
  const birthDate = fieldString(fields, "birthDate", "") || undefined;
  const storedAge = fieldInt(fields, "age", 0);
  const age = birthDate ? calculateAgeFromBirthDate(birthDate) : storedAge;
  const school = fieldString(fields, "school", "");
  const preferences = fieldStringArray(fields, "preferences");
  const langRaw = fieldString(fields, "language", "");
  const language = SUPPORTED_LANGUAGES.includes(langRaw as Language) ? (langRaw as Language) : undefined;
  const facebookId = fieldString(fields, "facebookId", "") || undefined;
  const facebookName = fieldString(fields, "facebookName", "") || undefined;
  const instagramId = fieldString(fields, "instagramId", "") || undefined;
  const instagramHandle = fieldString(fields, "instagramHandle", "") || undefined;
  const tiktokId = fieldString(fields, "tiktokId", "") || undefined;
  const tiktokHandle = fieldString(fields, "tiktokHandle", "") || undefined;
  const spotifyId = fieldString(fields, "spotifyId", "") || undefined;
  const spotifyName = fieldString(fields, "spotifyName", "") || undefined;

  const driverDays = fieldStringArray(fields, "driverDays");
  const driverAvailability = parseDriverAvailability(fields);
  const interestedEvents = fieldStringArray(fields, "interestedEvents");
  const driverMaxDetourKm = fieldInt(fields, "driverMaxDetourKm", 0) || undefined;
  const driverDestinationRadiusKm = fieldInt(fields, "driverDestinationRadiusKm", 0) || undefined;
  const driverDefaultDestination = fieldString(fields, "driverDefaultDestination", "") || null;
  const driverDefaultDestinationCoords = (() => {
    const ddcField = asRecord(fields.driverDefaultDestinationCoords);
    const gp = asRecord(ddcField?.geoPointValue);
    if (gp && typeof gp.latitude === "number" && typeof gp.longitude === "number") {
      return { latitude: gp.latitude, longitude: gp.longitude };
    }
    return null;
  })();

  return {
    ...(name ? { name } : {}),
    email: fieldString(fields, "email", ""),
    xp: fieldInt(fields, "xp", 0),
    rating: fieldInt(fields, "ratings", 0),
    avatar: fieldString(fields, "avatar", "") || null,
    homeAddress: fieldString(fields, "homeAddress", "") || null,
    homeAddressCoords: (() => {
      const hacField = asRecord(fields.homeAddressCoords);
      const gp = asRecord(hacField?.geoPointValue);
      if (gp && typeof gp.latitude === "number" && typeof gp.longitude === "number") {
        return { latitude: gp.latitude, longitude: gp.longitude };
      }
      return null;
    })(),

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
    walletBalance: fieldInt(fields, "walletBalance", 0),
    stripeCustomerId: fieldString(fields, "stripeCustomerId", "") || undefined,
    favorite: extractFavoriteRoutes(data),
    ...(age ? { age } : {}),
    ...(birthDate ? { birthDate } : {}),
    ...(school ? { school } : {}),
    ...(preferences.length ? { preferences } : {}),
    ...(language ? { language } : {}),
    ...(facebookId ? { facebookId } : {}),
    ...(facebookName ? { facebookName } : {}),
    ...(instagramId ? { instagramId } : {}),
    ...(instagramHandle ? { instagramHandle } : {}),
    ...(tiktokId ? { tiktokId } : {}),
    ...(tiktokHandle ? { tiktokHandle } : {}),
    ...(spotifyId ? { spotifyId } : {}),
    ...(spotifyName ? { spotifyName } : {}),
    ...(driverDays.length ? { driverDays } : {}),
    ...(driverAvailability.length ? { driverAvailability } : {}),
    ...(interestedEvents.length ? { interestedEvents } : {}),
    ...(driverMaxDetourKm ? { driverMaxDetourKm } : {}),
    ...(driverDestinationRadiusKm ? { driverDestinationRadiusKm } : {}),
    ...(driverDefaultDestination ? { driverDefaultDestination } : {}),
    ...(driverDefaultDestinationCoords ? { driverDefaultDestinationCoords } : {}),
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
    const token = await user.getIdToken().catch(() => undefined);
    const firestoreData = await fetchUser(user.uid, token);
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
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
  const res = await fetch(
    `${firestoreDocumentUrl("users", uid)}?${mask}`,
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
