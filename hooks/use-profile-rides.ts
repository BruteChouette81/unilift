import { firestoreDocumentUrl } from "@/constants/runtime-config";
import type { StartRidePayload } from "@/types/models";
import type { User } from "firebase/auth";
import { useCallback } from "react";

type UseProfileRidesParams = {
  user: User | null;
  onRefresh: () => Promise<void> | void;
  onRideStarted: (params: {
    rideId: string;
    originLat: number;
    originLng: number;
    destination: string;
  }) => void;
};

export function useProfileRides({
  user,
  onRefresh,
  onRideStarted,
}: UseProfileRidesParams) {
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
      await onRefresh();
    },
    [onRefresh, user],
  );

  return { startRide, cancelRide };
}
