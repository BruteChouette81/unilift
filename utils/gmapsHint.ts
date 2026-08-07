import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Linking, Platform } from "react-native";

const STORAGE_KEY = "railguards:gmapsHintDismissed";

type TranslateFn = (key: string) => string;

export async function maybeShowGmapsHint(t: TranslateFn): Promise<void> {
  try {
    const dismissed = await AsyncStorage.getItem(STORAGE_KEY);
    if (dismissed === "1") return;
  } catch {
    // If storage is unavailable, fall through and show the hint once.
  }

  await new Promise<void>((resolve) => {
    Alert.alert(
      t("railguards.gmapsHintTitle"),
      t("railguards.gmapsHintBody"),
      [
        {
          text: t("railguards.gmapsHintDismiss"),
          onPress: async () => {
            try {
              await AsyncStorage.setItem(STORAGE_KEY, "1");
            } catch {}
            resolve();
          },
        },
        { text: t("railguards.gmapsHintOpen"), onPress: () => resolve() },
      ],
      { onDismiss: () => resolve() },
    );
  });
}

/** Open native/web Google Maps directions to a single destination. Mirrors the
 *  single-stop branch of riderScreen's openGoogleMaps. */
export async function openDirectionsTo(
  dest: { latitude: number; longitude: number },
  t: TranslateFn,
): Promise<void> {
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${dest.latitude},${dest.longitude}`;
  const nativeUrl = Platform.OS === "ios"
    ? `comgooglemaps://?daddr=${dest.latitude},${dest.longitude}&directionsmode=driving`
    : `google.navigation:q=${dest.latitude},${dest.longitude}`;

  try {
    const canOpenNative = await Linking.canOpenURL(nativeUrl);
    if (canOpenNative) {
      await Linking.openURL(nativeUrl);
      return;
    }
  } catch {
    // fall through to web
  }

  await maybeShowGmapsHint(t);
  await Linking.openURL(webUrl);
}
