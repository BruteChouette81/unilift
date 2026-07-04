import { Alert } from "react-native";

type TranslateFn = (key: string) => string;
type RouterLike = { push: (path: any) => void };

export function ensurePaymentMethodOrAlert(
  hasPaymentMethod: boolean,
  t: TranslateFn,
  router: RouterLike,
  walletLoading?: boolean,
): boolean {
  if (walletLoading) return false;
  if (hasPaymentMethod) return true;
  Alert.alert(
    t("railguards.noPaymentMethodTitle"),
    t("railguards.noPaymentMethodBody"),
    [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("railguards.noPaymentMethodCta"),
        onPress: () => router.push("/(tabs)/wallet"),
      },
    ],
  );
  return false;
}
