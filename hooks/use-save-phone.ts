import { patchUserField } from "@/components/userHelper";
import { devError } from "@/constants/runtime-config";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { getAuth } from "firebase/auth";
import { useCallback } from "react";
import { Alert } from "react-native";

/**
 * Saves the signed-in user's phone number, optimistically.
 *
 * The number is written to `users/{uid}.phone` — owner-writable, on none of the
 * financial/cert/reputation deny-lists in firestore.rules — and mirrored into
 * UserProfileContext first so the field shows the new value on the next frame
 * rather than after the round trip. A failed write reverts and alerts.
 *
 * `phoneConsent` is written in the same PATCH, never separately: every caller
 * reaches this only from a surface that has just stated what the number is used
 * for and who receives it — the card's ticked consent line, or the share
 * sheet's Share button under the same disclosure — so the permission and the
 * data it covers land together or not at all.
 *
 * Returns `false` instead of throwing so a caller can keep its editor open and
 * show an error, which is the contract `PhoneNumberCard.onCommit` and
 * `PhoneShareSheet.onSave` both expect.
 *
 * Lives here because the profile tab and the passenger's ride screen both need
 * it, and it was previously written inline in the latter.
 */
export function useSavePhone(): (e164: string) => Promise<boolean> {
  const { userData, updateUserData } = useUserProfile();
  const { t } = useLanguage();
  const previous = userData?.phone;
  const previousConsent = userData?.phoneConsent;

  return useCallback(
    async (e164: string): Promise<boolean> => {
      const user = getAuth().currentUser;
      if (!user) return false;

      updateUserData({ phone: e164, phoneConsent: true });
      try {
        const token = await user.getIdToken();
        await patchUserField(token, user.uid, {
          phone: { stringValue: e164 },
          phoneConsent: { booleanValue: true },
        });
        return true;
      } catch (err) {
        devError("[useSavePhone] save failed:", err);
        updateUserData({ phone: previous, phoneConsent: previousConsent });
        Alert.alert(t("phoneShare.saveFailed"), t("phoneShare.saveFailedMsg"));
        return false;
      }
    },
    [previous, previousConsent, updateUserData, t],
  );
}

/**
 * Withdraws consent, which means deleting the number rather than flagging it.
 *
 * A `phoneConsent: false` sitting beside a stored number would be a promise the
 * app cannot keep: `POST /rides/passenger-contact` reads `phone`, and knows
 * nothing about the flag. So the same PATCH clears both, and the empty string
 * is enough — `normalizeUserData` reads "" as no number at all.
 *
 * Returns false rather than throwing, so the card can leave the box ticked when
 * the write fails instead of showing a permission that was never revoked.
 */
export function useRevokePhone(): () => Promise<boolean> {
  const { userData, updateUserData } = useUserProfile();
  const { t } = useLanguage();
  const previous = userData?.phone;
  const previousConsent = userData?.phoneConsent;

  return useCallback(async (): Promise<boolean> => {
    const user = getAuth().currentUser;
    if (!user) return false;

    updateUserData({ phone: undefined, phoneConsent: false });
    try {
      const token = await user.getIdToken();
      await patchUserField(token, user.uid, {
        phone: { stringValue: "" },
        phoneConsent: { booleanValue: false },
      });
      return true;
    } catch (err) {
      devError("[useRevokePhone] revoke failed:", err);
      updateUserData({ phone: previous, phoneConsent: previousConsent });
      Alert.alert(t("phoneCard.revokeFailed"), t("common.genericError"));
      return false;
    }
  }, [previous, previousConsent, updateUserData, t]);
}
