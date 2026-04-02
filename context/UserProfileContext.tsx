import { fetchAndSyncUserData } from "@/components/userHelper";
import { useAuth } from "@/context/AuthContext";
import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { fetchRides } from "@/services/rideServices";
import type { LocationPoint, Ride, UserProfile } from "@/types/models";
import * as Location from "expo-location";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import React from "react";

export interface UserProfileContextValue {
  userData: UserProfile | null;
  rides: Ride[] | null;
  refreshing: boolean;
  /** Merge a partial update into the in-memory cache (no Firestore read). */
  updateUserData: (patch: Partial<UserProfile>) => void;
  /** Force a full re-fetch of the user profile from Firestore. */
  refreshProfile: () => Promise<void>;
  /** Force a full re-fetch of the rides list. */
  refreshRides: () => Promise<void>;
}

const UserProfileContext = createContext<UserProfileContextValue | undefined>(undefined);

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [userData, setUserData] = useState<UserProfile | null>(null);
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const getUserLocation = useCallback(async (): Promise<LocationPoint> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") throw new Error("Location permission denied");
    const pos = await Location.getCurrentPositionAsync({});
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  }, []);

  const updateLoc = useCallback(async (token: string, uid: string, data: LocationPoint) => {
    const res = await fetch(
      firestoreDocumentUrl("users", uid) + "?updateMask.fieldPaths=localisation",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fields: {
            localisation: {
              geoPointValue: { latitude: data.latitude, longitude: data.longitude },
            },
          },
        }),
      },
    );
    if (!res.ok) throw new Error(await res.text());
  }, []);

  const doFetchProfile = useCallback(async () => {
    if (!user) return;
    await fetchAndSyncUserData({ user, getUserLocation, updateLoc, setUserData });
  }, [user, getUserLocation, updateLoc]);

  const doFetchRides = useCallback(async () => {
    const ridesData = await fetchRides({ force: true }).catch(() => []);
    setRides(ridesData);
  }, []);

  // Fetch once on login; clear on logout.
  useEffect(() => {
    if (!user) {
      setUserData(null);
      setRides(null);
      return;
    }
    void doFetchProfile();
    void doFetchRides();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]); // only re-run when the actual user identity changes

  const updateUserData = useCallback((patch: Partial<UserProfile>) => {
    setUserData((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const refreshProfile = useCallback(async () => {
    setRefreshing(true);
    try {
      await doFetchProfile();
    } finally {
      setRefreshing(false);
    }
  }, [doFetchProfile]);

  const refreshRides = useCallback(async () => {
    await doFetchRides();
  }, [doFetchRides]);

  return (
    <UserProfileContext.Provider
      value={{ userData, rides, refreshing, updateUserData, refreshProfile, refreshRides }}
    >
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile(): UserProfileContextValue {
  const ctx = useContext(UserProfileContext);
  if (!ctx) throw new Error("useUserProfile must be used within UserProfileProvider");
  return ctx;
}
