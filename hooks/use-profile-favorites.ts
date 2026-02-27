import { firestoreDocumentUrl } from "@/constants/runtime-config";
import type { FavoriteRoute as FavoriteRouteFormData } from "@/components/favoriteForm";
import type { UserProfile } from "@/types/models";
import type { User } from "firebase/auth";
import { useState } from "react";

type Params = {
  user: User | null;
  userData: UserProfile | null;
  onRefresh: () => Promise<void> | void;
};

type FavoriteGeoKey = "destinationGeo" | "destinationGeolocation";
type FavoriteGeoRecord = {
  destination: string;
  destinationGeo?: { lat?: number; lon?: number };
  destinationGeolocation?: { lat?: number; lon?: number };
};

export function useProfileFavorites({ user, userData, onRefresh }: Params) {
  const [modifyFavorite, setModifyFavorite] = useState(false);
  const [initialData, setInitialData] = useState<FavoriteRouteFormData | undefined>(undefined);
  const [homeAddress, setHomeAddress] = useState("");
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const updateFavoriteRoutes = async (
    token: string,
    uid: string,
    data: { favorite: { arrayValue: { values: unknown[] } } },
  ) => {
    const docPath =
      firestoreDocumentUrl("users", uid) + "?updateMask.fieldPaths=favorite";

    const res = await fetch(docPath, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fields: {
          favorite: data.favorite,
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to upload user data: ${errorText}`);
    }
  };

  const buildFavoriteFields = (items: FavoriteGeoRecord[], useGeoKey: FavoriteGeoKey) => {
    return {
      favorite: {
        arrayValue: {
          values: (items || []).map((item) => {
            const geo = item[useGeoKey] || {};
            return {
              mapValue: {
                fields: {
                  destination: {
                    stringValue: item.destination || "",
                  },
                  destinationGeolocation: {
                    geoPointValue: {
                      latitude: geo.lat || 0,
                      longitude: geo.lon || 0,
                    },
                  },
                },
              },
            };
          }),
        },
      },
    };
  };

  const handleFavoriteSubmit = async (data: FavoriteRouteFormData) => {
    if (!user || !userData) return;

    if (data.id !== undefined) {
      const updated: FavoriteGeoRecord[] = [...userData.favorite];
      updated[data.id] = {
        destination: data.endAddress,
        destinationGeolocation: {
          lat: data.endGeolocation?.lat,
          lon: data.endGeolocation?.lon,
        },
      };

      const fields = buildFavoriteFields(updated, "destinationGeolocation");
      await updateFavoriteRoutes(await user.getIdToken(), user.uid, fields);
      setModifyFavorite(false);
      await onRefresh();
      return;
    }

    const updated: FavoriteGeoRecord[] = [...userData.favorite];
    updated.push({
      destination: data.endAddress,
      destinationGeo: {
        lat: data.endGeolocation?.lat,
        lon: data.endGeolocation?.lon,
      },
    });

    const fields = buildFavoriteFields(updated, "destinationGeo");
    await updateFavoriteRoutes(await user.getIdToken(), user.uid, fields);
    setModifyFavorite(false);
    await onRefresh();
  };

  const handleFavoriteDelete = async (index: number) => {
    if (!user || !userData) return;
    let updated: FavoriteGeoRecord[] = [...userData.favorite];
    updated = updated.slice(0, index).concat(updated.slice(index + 1));
    const fields = buildFavoriteFields(updated, "destinationGeo");
    await updateFavoriteRoutes(await user.getIdToken(), user.uid, fields);
    setModifyFavorite(false);
    await onRefresh();
  };

  const handleNewHomeAddress = async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const docPath =
        firestoreDocumentUrl("users", user.uid) +
        "?updateMask.fieldPaths=homeAddress";

      const res = await fetch(docPath, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fields: {
            homeAddress: { stringValue: homeAddress },
          },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to upload user data: ${errorText}`);
      }

      alert("Updated your home address!");
      setHomeAddress("");
      await onRefresh();
    } catch (error: unknown) {
      console.error("❌ Error uploading user data:", error);
      setErrors({
        startAddress:
          error instanceof Error ? error.message : "Failed to update home address",
      });
    }
  };

  return {
    modifyFavorite,
    setModifyFavorite,
    initialData,
    setInitialData,
    homeAddress,
    setHomeAddress,
    errors,
    handleNewHomeAddress,
    handleFavoriteSubmit,
    handleFavoriteDelete,
  };
}
