import { firestoreDocumentUrl } from "@/constants/runtime-config";
import type { FavoriteRoute as FavoriteRouteFormData } from "@/components/favoriteForm";
import { useUserProfile } from "@/context/UserProfileContext";
import { geoSuggestion, type LocationResult } from "@/services/rideServices";
import type { FavoriteRoute, UserProfile } from "@/types/models";
import type { User } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

type Params = {
  user: User | null;
  userData: UserProfile | null;
  onRefresh?: () => Promise<void> | void; // kept for API compatibility, no longer used internally
};

type FavoriteGeoKey = "destinationGeo" | "destinationGeolocation";
type FavoriteGeoRecord = {
  destination: string;
  destinationGeo?: { lat?: number; lon?: number };
  destinationGeolocation?: { lat?: number; lon?: number };
};

export function useProfileFavorites({ user, userData }: Params) {
  const { updateUserData } = useUserProfile();
  const [modifyFavorite, setModifyFavorite] = useState(false);
  const [initialData, setInitialData] = useState<FavoriteRouteFormData | undefined>(undefined);
  const [homeAddress, setHomeAddress] = useState("");
  const [homeAddressCoords, setHomeAddressCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // ── Home address suggestions ──────────────────────────────────────────────
  const [homeSuggestions, setHomeSuggestions] = useState<LocationResult[]>([]);
  const [showHomeSuggestions, setShowHomeSuggestions] = useState(false);
  const suppressHomeSuggestionsRef = useRef(false);
  const debouncedHomeAddress = useDebouncedValue(homeAddress, 700);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (suppressHomeSuggestionsRef.current) { suppressHomeSuggestionsRef.current = false; return; }
      if (debouncedHomeAddress.length < 3) { setShowHomeSuggestions(false); return; }
      const results = await geoSuggestion(debouncedHomeAddress.trim());
      if (cancelled) return;
      setHomeSuggestions(results ?? []);
      setShowHomeSuggestions((results?.length ?? 0) > 0);
    };
    void run();
    return () => { cancelled = true; };
  }, [debouncedHomeAddress]);

  const onHomeAddressChange = useCallback((text: string) => {
    suppressHomeSuggestionsRef.current = false;
    setHomeAddress(text);
    setHomeAddressCoords(null);
  }, []);

  const onSelectHomeSuggestion = useCallback((item: LocationResult) => {
    suppressHomeSuggestionsRef.current = true;
    setHomeAddress(item.displayName);
    setHomeAddressCoords({ latitude: parseFloat(item.lat), longitude: parseFloat(item.lon) });
    setShowHomeSuggestions(false);
  }, []);

  const toFavoriteRoutes = (records: FavoriteGeoRecord[]): FavoriteRoute[] =>
    records.map((r) => ({
      destination: r.destination,
      destinationGeo: {
        lat: (r.destinationGeo ?? r.destinationGeolocation)?.lat ?? 0,
        lon: (r.destinationGeo ?? r.destinationGeolocation)?.lon ?? 0,
      },
    }));

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
      updateUserData({ favorite: toFavoriteRoutes(updated) });
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
    updateUserData({ favorite: toFavoriteRoutes(updated) });
  };

  const handleFavoriteDelete = async (index: number) => {
    if (!user || !userData) return;
    let updated: FavoriteGeoRecord[] = [...userData.favorite];
    updated = updated.slice(0, index).concat(updated.slice(index + 1));
    const fields = buildFavoriteFields(updated, "destinationGeo");
    await updateFavoriteRoutes(await user.getIdToken(), user.uid, fields);
    setModifyFavorite(false);
    updateUserData({ favorite: toFavoriteRoutes(updated) });
  };

  const handleNewHomeAddress = async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();

      const fieldPaths = ["homeAddress", "homeAddressCoords"];
      const mask = fieldPaths.map((f) => `updateMask.fieldPaths=${f}`).join("&");
      const docPath = `${firestoreDocumentUrl("users", user.uid)}?${mask}`;

      const fields: Record<string, unknown> = {
        homeAddress: { stringValue: homeAddress },
      };
      if (homeAddressCoords) {
        fields.homeAddressCoords = {
          geoPointValue: {
            latitude: homeAddressCoords.latitude,
            longitude: homeAddressCoords.longitude,
          },
        };
      }

      const res = await fetch(docPath, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fields }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to upload user data: ${errorText}`);
      }

      alert("Updated your home address!");
      updateUserData({ homeAddress, homeAddressCoords });
      setHomeAddress("");
      setHomeAddressCoords(null);
    } catch (error: unknown) {
      console.error("Error uploading user data:", error);
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
    onHomeAddressChange,
    onSelectHomeSuggestion,
    homeSuggestions,
    showHomeSuggestions,
    errors,
    handleNewHomeAddress,
    handleFavoriteSubmit,
    handleFavoriteDelete,
  };
}
