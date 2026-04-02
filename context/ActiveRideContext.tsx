import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "unilift_active_ride";

export type ActiveRideRole = "driver" | "passenger";

export type ActiveRideInfo = {
  rideId: string;
  role: ActiveRideRole;
  /** Route params needed to re-open the ride screen */
  params: Record<string, string>;
};

type ActiveRideContextValue = {
  activeRide: ActiveRideInfo | null;
  setActiveRide: (info: ActiveRideInfo) => void;
  clearActiveRide: () => void;
};

const ActiveRideContext = createContext<ActiveRideContextValue>({
  activeRide: null,
  setActiveRide: () => {},
  clearActiveRide: () => {},
});

export function ActiveRideProvider({ children }: { children: React.ReactNode }) {
  const [activeRide, setActiveRideState] = useState<ActiveRideInfo | null>(null);

  // Restore from storage on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            setActiveRideState(JSON.parse(raw));
          } catch {
            // corrupt data — ignore
          }
        }
      })
      .catch(() => {});
  }, []);

  const setActiveRide = useCallback((info: ActiveRideInfo) => {
    setActiveRideState(info);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(info)).catch(() => {});
  }, []);

  const clearActiveRide = useCallback(() => {
    setActiveRideState(null);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  return (
    <ActiveRideContext.Provider value={{ activeRide, setActiveRide, clearActiveRide }}>
      {children}
    </ActiveRideContext.Provider>
  );
}

export const useActiveRide = () => useContext(ActiveRideContext);
