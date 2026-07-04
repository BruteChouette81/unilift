import {
  FORCE_UPDATE_ANDROID_URL,
  FORCE_UPDATE_ENABLED,
  FORCE_UPDATE_IOS_URL,
  FORCE_UPDATE_MINIMUM_VERSION,
  type ForceUpdateRemoteConfig,
} from "@/constants/force-update-config";
import { firestoreDocumentUrl, withFirebaseApiKey } from "@/constants/runtime-config";
import { useEffect, useState } from "react";

const FALLBACK: ForceUpdateRemoteConfig = {
  enabled: FORCE_UPDATE_ENABLED,
  minimumVersion: FORCE_UPDATE_MINIMUM_VERSION,
  iosStoreUrl: FORCE_UPDATE_IOS_URL,
  androidStoreUrl: FORCE_UPDATE_ANDROID_URL,
  loading: false,
};

export function useForceUpdateConfigFetcher(): ForceUpdateRemoteConfig {
  const [config, setConfig] = useState<ForceUpdateRemoteConfig>({
    ...FALLBACK,
    loading: true,
  });

  useEffect(() => {
    const url = withFirebaseApiKey(firestoreDocumentUrl("config", "forceUpdate"));

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((doc) => {
        const enabled: boolean =
          doc.fields?.enabled?.booleanValue ?? FORCE_UPDATE_ENABLED;
        const minimumVersion: string =
          doc.fields?.minimumVersion?.stringValue ?? FORCE_UPDATE_MINIMUM_VERSION;
        const iosStoreUrl: string =
          doc.fields?.iosStoreUrl?.stringValue ?? FORCE_UPDATE_IOS_URL;
        const androidStoreUrl: string =
          doc.fields?.androidStoreUrl?.stringValue ?? FORCE_UPDATE_ANDROID_URL;
        setConfig({ enabled, minimumVersion, iosStoreUrl, androidStoreUrl, loading: false });
      })
      .catch(() => {
        // Network error or doc missing — use local fallback silently
        setConfig(FALLBACK);
      });
  }, []);

  return config;
}
