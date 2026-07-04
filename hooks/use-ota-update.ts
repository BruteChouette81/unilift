import * as Updates from "expo-updates";
import { useEffect, useState } from "react";

/**
 * Startup OTA gate. On cold launch, checks for a newer JS bundle (EAS Update)
 * for the current native runtime, fetches it, and reloads into it before the
 * app renders. This keeps every user on the latest JS for their app version.
 *
 * FAIL-OPEN: if the check/fetch is slow or errors (offline, server down), we
 * stop blocking after a short timeout and let the app start on the cached
 * bundle — a backend hiccup must never prevent the app from opening.
 *
 * No-ops in Expo Go / dev clients where `Updates.isEnabled` is false.
 */
const OTA_TIMEOUT_MS = 4000;

export function useOtaUpdate(): { checking: boolean } {
  // Nothing to do when updates are disabled (Expo Go, __DEV__, web) — start now.
  const [checking, setChecking] = useState<boolean>(Updates.isEnabled);

  useEffect(() => {
    if (!Updates.isEnabled) return;

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      setChecking(false);
    };

    // Fail-open safety net: never block startup longer than the timeout.
    const timer = setTimeout(done, OTA_TIMEOUT_MS);

    (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          // reloadAsync restarts the app into the new bundle; this effect unmounts.
          await Updates.reloadAsync();
          return;
        }
      } catch {
        // Offline / server error — fall through and start on the cached bundle.
      } finally {
        clearTimeout(timer);
        done();
      }
    })();

    return () => clearTimeout(timer);
  }, []);

  return { checking };
}
