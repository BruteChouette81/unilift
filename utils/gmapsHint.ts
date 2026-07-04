import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";

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
