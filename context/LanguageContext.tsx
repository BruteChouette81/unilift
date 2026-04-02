import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  translations,
  type Language,
  type TranslationDict,
} from "@/constants/translations";
import { useAuth } from "@/context/AuthContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { firestoreDocumentUrl } from "@/constants/runtime-config";

const STORAGE_KEY = "unilift.language";

type TranslationParams = { count?: number; [key: string]: string | number | undefined };

type LanguageContextValue = {
  language: Language;
  changeLanguage: (lang: Language) => Promise<void>;
  t: (key: string, params?: TranslationParams) => string;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNestedValue(obj: unknown, key: string): string | undefined {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function buildT(dict: TranslationDict, fallbackDict: TranslationDict) {
  return function t(key: string, params?: TranslationParams): string {
    let resolvedKey = key;

    // Pluralization: try _one / _other suffix when count is provided
    if (params?.count !== undefined) {
      const pluralKey = params.count === 1 ? key + "_one" : key + "_other";
      if (getNestedValue(dict, pluralKey) !== undefined) {
        resolvedKey = pluralKey;
      }
    }

    // Traverse nested dict, fallback to fr, then key itself
    const raw =
      getNestedValue(dict, resolvedKey) ??
      getNestedValue(fallbackDict, resolvedKey) ??
      resolvedKey;

    if (!params) return raw;

    // Replace {{token}} placeholders
    return raw.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
      const val = params[name];
      return val !== undefined ? String(val) : `{{${name}}}`;
    });
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { userData } = useUserProfile();
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);

  // Load from AsyncStorage on mount (instant, no flash)
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored && SUPPORTED_LANGUAGES.includes(stored as Language)) {
        setLanguage(stored as Language);
      }
    });
  }, []);

  // Sync language from session cache when it becomes available
  useEffect(() => {
    if (!userData?.language) return;
    setLanguage(userData.language);
    AsyncStorage.setItem(STORAGE_KEY, userData.language).catch(() => {});
  }, [userData?.language]);

  const changeLanguage = useCallback(
    async (lang: Language) => {
      setLanguage(lang);
      await AsyncStorage.setItem(STORAGE_KEY, lang);

      // Fire-and-forget Firestore save
      if (user) {
        user.getIdToken().then((token) => {
          const url =
            firestoreDocumentUrl("users", user.uid) +
            "?updateMask.fieldPaths=language";
          fetch(url, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              fields: { language: { stringValue: lang } },
            }),
          }).catch((err) => console.warn("Language save failed:", err));
        });
      }
    },
    [user],
  );

  const t = useMemo(() => {
    const dict = translations[language];
    const fallback = translations[DEFAULT_LANGUAGE];
    return buildT(dict, fallback);
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, changeLanguage, t }),
    [language, changeLanguage, t],
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
