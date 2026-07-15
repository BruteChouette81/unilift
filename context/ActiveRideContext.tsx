import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "unilift_active_ride";
const PENDING_REQUEST_KEY = "unilift_pending_request";

export type ActiveRideRole = "driver" | "passenger";

export type ActiveRideInfo = {
  rideId: string;
  role: ActiveRideRole;
  /** Route params needed to re-open the ride screen */
  params: Record<string, string>;
};

/**
 * A live ride request the passenger is still waiting on (no driver yet).
 * Persisted so the search can auto-resume if the app is closed/reopened
 * before a driver accepts. Mirrors ActiveRideInfo but for the pre-match phase.
 */
export type PendingRideRequest = {
  requestId: string;
  /** Route params needed to re-open findingDriverScreen */
  params: Record<string, string>;
};

type ActiveRideContextValue = {
  activeRide: ActiveRideInfo | null;
  setActiveRide: (info: ActiveRideInfo) => void;
  clearActiveRide: () => void;
  pendingRequest: PendingRideRequest | null;
  setPendingRequest: (info: PendingRideRequest) => void;
  clearPendingRequest: () => void;
};

const ActiveRideContext = createContext<ActiveRideContextValue>({
  activeRide: null,
  setActiveRide: () => {},
  clearActiveRide: () => {},
  pendingRequest: null,
  setPendingRequest: () => {},
  clearPendingRequest: () => {},
});

export function ActiveRideProvider({ children }: { children: React.ReactNode }) {
  const [activeRide, setActiveRideState] = useState<ActiveRideInfo | null>(null);
  const [pendingRequest, setPendingRequestState] = useState<PendingRideRequest | null>(null);

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
    AsyncStorage.getItem(PENDING_REQUEST_KEY)
      .then((raw) => {
        if (raw) {
          try {
            setPendingRequestState(JSON.parse(raw));
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

  const setPendingRequest = useCallback((info: PendingRideRequest) => {
    setPendingRequestState(info);
    AsyncStorage.setItem(PENDING_REQUEST_KEY, JSON.stringify(info)).catch(() => {});
  }, []);

  const clearPendingRequest = useCallback(() => {
    setPendingRequestState(null);
    AsyncStorage.removeItem(PENDING_REQUEST_KEY).catch(() => {});
  }, []);

  return (
    <ActiveRideContext.Provider
      value={{
        activeRide,
        setActiveRide,
        clearActiveRide,
        pendingRequest,
        setPendingRequest,
        clearPendingRequest,
      }}
    >
      {children}
    </ActiveRideContext.Provider>
  );
}

export const useActiveRide = () => useContext(ActiveRideContext);
