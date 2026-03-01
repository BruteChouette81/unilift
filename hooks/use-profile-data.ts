import { fetchAndSyncUserData } from "@/components/userHelper";
import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { fetchRides } from "@/services/rideServices";
import type { LocationPoint, Ride, UserProfile } from "@/types/models";
import * as Location from "expo-location";
import type { User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";

const buildFallbackProfile = (email = ""): UserProfile => ({
  email,
  xp: 0,
  rating: 0,
  avatar: null,
  homeAddress: null,
  localisation: { latitude: null, longitude: null },
  ridesCompleted: 0,
  favorite: [],
});

export function useProfileData(user: User | null) {
  const [userData, setUserData] = useState<UserProfile | null>(null);
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const getUserLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      throw new Error("Location permission denied");
    }

    const pos = await Location.getCurrentPositionAsync({});
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    };
  }, []);

  const updateLoc = useCallback(async (token: string, uid: string, data: LocationPoint) => {
    const docPath =
      firestoreDocumentUrl("users", uid) + "?updateMask.fieldPaths=localisation";

    const res = await fetch(docPath, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fields: {
          localisation: {
            geoPointValue: {
              latitude: data.latitude,
              longitude: data.longitude,
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to upload user data: ${errorText}`);
    }
  }, []);

  const reloadData = useCallback(async (forceRidesFetch = false) => {
    if (!user) return;

    try {
      await fetchAndSyncUserData({
        user,
        getUserLocation,
        updateLoc,
        setUserData,
      });
    } catch {
      setUserData((prev) => prev ?? buildFallbackProfile(user.email ?? ""));
    }

    const ridesData = await fetchRides({ force: forceRidesFetch }).catch(() => []);
    setRides(ridesData);
  }, [getUserLocation, updateLoc, user]);

  useEffect(() => {
    if (!user) {
      setUserData(null);
      setRides(null);
      return;
    }

    setUserData((prev) => prev ?? buildFallbackProfile(user.email ?? ""));
    void reloadData();
  }, [reloadData, user]);

  const onRefresh = useCallback(async () => {
    if (!user) return;

    setRefreshing(true);
    try {
      await reloadData(true);
    } finally {
      setRefreshing(false);
    }
  }, [reloadData, user]);

  return {
    userData,
    rides,
    refreshing,
    onRefresh,
  };
}
