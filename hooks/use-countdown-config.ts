import {
  COUNTDOWN_ENABLED,
  COUNTDOWN_END_DATE,
  COUNTDOWN_END_MS,
  type CountdownRemoteConfig,
} from "@/constants/countdown-config";
import { withFirebaseApiKey, firestoreDocumentUrl } from "@/constants/runtime-config";
import { useEffect, useState } from "react";

const FALLBACK: CountdownRemoteConfig = {
  enabled: COUNTDOWN_ENABLED,
  endMs: COUNTDOWN_END_MS,
  endDate: COUNTDOWN_END_DATE,
  loading: false,
};

export function useCountdownConfigFetcher(): CountdownRemoteConfig {
  const [config, setConfig] = useState<CountdownRemoteConfig>({
    ...FALLBACK,
    loading: true,
  });

  useEffect(() => {
    const url = withFirebaseApiKey(firestoreDocumentUrl("config", "countdown"));

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((doc) => {
        const enabled: boolean =
          doc.fields?.enabled?.booleanValue ?? COUNTDOWN_ENABLED;
        const endDate: string =
          doc.fields?.endDate?.stringValue ?? COUNTDOWN_END_DATE;
        const endMs = new Date(endDate).getTime();
        setConfig({ enabled, endMs, endDate, loading: false });
      })
      .catch(() => {
        // Network error or doc missing — use local fallback silently
        setConfig(FALLBACK);
      });
  }, []);

  return config;
}
