

//function to deal with the firebase database for the users

const projectId = "unilift-6e756";

const apiKey = "AIzaSyDQMdY0la_sZuHvumHjFl4ibfCsOe1UW6Q"; 

type FirestoreUser = any;

type Location = {
  latitude: number;
  longitude: number;
};

async function fetchUser(uid:string) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/users/${uid}?key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(res)
    } else {
       const data = await res.json();
    console.log("Firestore user data:", JSON.stringify(data.fields.avatar?.stringValue));
    return data
    }
   
  } catch (err) {
    console.error(err);
  }
}

export const normalizeUserData = (
  data: FirestoreUser,
  fallbackLoc?: Location
) => {
  const fields = data?.fields || {};

  const localisation = fields.localisation?.geoPointValue;

  return {
    email: fields.email?.stringValue ?? "",
    xp: Number(fields.xp?.integerValue ?? 0),
    rating: Number(fields.rating?.integerValue ?? 0),
    avatar: fields.avatar?.stringValue ?? null,
    homeAddress: fields.homeAddress?.stringValue ?? null,

    localisation: {
      latitude:
        localisation?.latitude ?? fallbackLoc?.latitude ?? null,
      longitude:
        localisation?.longitude ?? fallbackLoc?.longitude ?? null,
    },

    ridesCompleted: Number(fields.ridesCompleted?.integerValue ?? 0),

    favorite:
      fields.favorite?.arrayValue?.values?.map((item: any) => {
        const f = item.mapValue?.fields || {};
        return {
          destination: f.destination?.stringValue ?? "",
          destinationGeo: {
            lat: f.destinationGeolocation?.geoPointValue?.latitude ?? null,
            lon: f.destinationGeolocation?.geoPointValue?.longitude ?? null,
          },
        };
      }) ?? [],
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
  user: any;
  getUserLocation: () => Promise<Location>;
  updateLoc: (token: string, uid: string, loc: Location) => Promise<void>;
  setUserData: (data: any) => void;
}) => {
  if (!user) return;

  try {
    const [loc, firestoreData] = await Promise.all([
      getUserLocation(),
      fetchUser(user.uid),
    ]);

    const normalized = normalizeUserData(firestoreData, loc);

    const needsUpdate = shouldUpdateLocation(
      loc,
      firestoreData?.fields?.localisation?.geoPointValue
    );

    if (needsUpdate) {
      await updateLoc(await user.getIdToken(), user.uid, loc);
      normalized.localisation = loc;
    }

    setUserData(normalized);
  } catch (err) {
    console.error("fetchAndSyncUserData error:", err);
  }
};

export async function patchUserField(
  token: string,
  uid: string,
  fields: Record<string, any>
) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/users/${uid}`,
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
