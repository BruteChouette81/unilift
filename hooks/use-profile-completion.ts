import { useUserProfile } from "@/context/UserProfileContext";
import { useWallet } from "@/context/WalletContext";
import { getProfileCompletion, type ProfileCompletion } from "@/utils/profile-completion";
import type { UserProfile } from "@/types/models";
import { useMemo } from "react";

export type UseProfileCompletion = {
  completion: ProfileCompletion;
  userData: UserProfile | null;
  /**
   * True once both the profile and the wallet have loaded. Until then the
   * completion figures are provisional — the wallet reports `hasPaymentMethod:
   * false` while it's still fetching, which would otherwise flash a wrong
   * "payment missing" row and an under-counted score.
   */
  ready: boolean;
};

/**
 * Single source of truth for profile completion, pulling from both contexts it
 * depends on. Used by the profile card and the ride-request nudge so the two
 * can never disagree about what's missing.
 */
export function useProfileCompletion(): UseProfileCompletion {
  const { userData } = useUserProfile();
  const { hasPaymentMethod, loading: walletLoading } = useWallet();

  const completion = useMemo(
    () => getProfileCompletion({ userData, hasPaymentMethod }),
    [userData, hasPaymentMethod],
  );

  return {
    completion,
    userData,
    ready: userData !== null && !walletLoading,
  };
}
