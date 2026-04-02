import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { useUserProfile } from "@/context/UserProfileContext";
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
        firestoreDocumentUrl("rides", uid) + "?updateMask.fieldPaths=started";
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
    async (uid: string) => {
      const docPath = firestoreDocumentUrl("rides", uid);
      const token = await user?.getIdToken();

      const res = await fetch(docPath, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to cancel ride: ${errorText}`);
      }

      alert("Ride cancelled!");
      await refreshRides();
    },
    [refreshRides, user],
  );

  return { startRide, cancelRide };
}
