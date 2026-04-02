import { useUserProfile } from "@/context/UserProfileContext";
import type { User } from "firebase/auth";
import { useCallback } from "react";

export function useProfileData(_user: User | null) {
  const { userData, rides, refreshing, refreshProfile, refreshRides } = useUserProfile();

  const onRefresh = useCallback(async () => {
    await Promise.all([refreshProfile(), refreshRides()]);
  }, [refreshProfile, refreshRides]);

  return { userData, rides, refreshing, onRefresh };
}
