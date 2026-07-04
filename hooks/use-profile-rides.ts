import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { useUserProfile } from "@/context/UserProfileContext";
import { cancelRideAsDriver } from "@/services/rideServices";
import type { StartRidePayload } from "@/types/models";
import type { User } from "firebase/auth";
import { useCallback } from "react";

type UseProfileRidesParams = {
  user: User | null;
  onRefresh?: () => Promise<void> | void; // kept for API compatibility, no longer used internally
  onRideStarted: (params: {
    rideId: string;
    originLat: number;
    originLng: number;
    destination: string;
    destinationLat: number;
    destinationLng: number;
  }) => void;
};

export function useProfileRides({
  user,
  onRideStarted,
}: UseProfileRidesParams) {
  const { refreshRides } = useUserProfile();
  const startRide = useCallback(
    async (uid: string, data: StartRidePayload) => {
      const docPath =
        firestoreDocumentUrl("rides", uid) +
        "?updateMask.fieldPaths=started&updateMask.fieldPaths=status&updateMask.fieldPaths=startedAt";
      const token = await user?.getIdToken();

      const res = await fetch(docPath, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fields: {
            started: { booleanValue: true },
            status: { stringValue: "started" },
            startedAt: { timestampValue: new Date().toISOString() },
          },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to start ride: ${errorText}`);
      }

      onRideStarted({
        rideId: uid,
        originLat: data.originLat,
        originLng: data.originLng,
        destination: data.destination,
        destinationLat: data.destinationLat,
        destinationLng: data.destinationLng,
      });
    },
    [onRideStarted, user],
  );

  const cancelRide = useCallback(
    async (uid: string): Promise<number> => {
      const feeApplied = await cancelRideAsDriver(uid);
      await refreshRides();
      return feeApplied;
    },
    [refreshRides],
  );

  return { startRide, cancelRide };
}
