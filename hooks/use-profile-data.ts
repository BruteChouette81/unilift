import { useUserProfile } from "@/context/UserProfileContext";
import type { User } from "firebase/auth";
import { useCallback } from "react";

export function useProfileData(_user: User | null) {
  const { userData, rides, refreshing, refreshProfile, refreshRides } = useUserProfile();

  /**
   * Background sync (screen focus, app foreground, post-mutation).
   * Silent on purpose: flipping `refreshing` programmatically makes iOS add the
   * RefreshControl's top inset to the ScrollView, and turning it back off does
   * not always remove it — the content stays pushed down until the user touches
   * the list. Only `onPullRefresh` is allowed to drive the spinner.
   */
  const onRefresh = useCallback(async () => {
    await Promise.all([refreshProfile({ silent: true }), refreshRides()]);
  }, [refreshProfile, refreshRides]);

  /** User-initiated pull-to-refresh — shows the spinner. */
  const onPullRefresh = useCallback(async () => {
    await Promise.all([refreshProfile(), refreshRides()]);
  }, [refreshProfile, refreshRides]);

  return { userData, rides, refreshing, onRefresh, onPullRefresh };
}
