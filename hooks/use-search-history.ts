import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const MAX_HISTORY = 5;

export type SearchHistoryEntry = {
  displayName: string;
  lat: string;
  lon: string;
};

function storageKey(uid: string) {
  return `search_history_${uid}`;
}

export function useSearchHistory(uid: string | undefined) {
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);

  // Load on mount / uid change
  useEffect(() => {
    if (!uid) { setHistory([]); return; }
    AsyncStorage.getItem(storageKey(uid))
      .then((raw) => {
        if (raw) setHistory(JSON.parse(raw) as SearchHistoryEntry[]);
      })
      .catch(() => {});
  }, [uid]);

  const persist = useCallback(
    (entries: SearchHistoryEntry[]) => {
      if (!uid) return;
      setHistory(entries);
      AsyncStorage.setItem(storageKey(uid), JSON.stringify(entries)).catch(() => {});
    },
    [uid],
  );

  const addToHistory = useCallback(
    (entry: SearchHistoryEntry) => {
      setHistory((prev) => {
        // Deduplicate by displayName (case-insensitive), push new entry to top
        const filtered = prev.filter(
          (e) => e.displayName.toLowerCase() !== entry.displayName.toLowerCase(),
        );
        const next = [entry, ...filtered].slice(0, MAX_HISTORY);
        if (uid) {
          AsyncStorage.setItem(storageKey(uid), JSON.stringify(next)).catch(() => {});
        }
        return next;
      });
    },
    [uid],
  );

  const removeFromHistory = useCallback(
    (displayName: string) => {
      const next = history.filter(
        (e) => e.displayName.toLowerCase() !== displayName.toLowerCase(),
      );
      persist(next);
    },
    [history, persist],
  );

  return { history, addToHistory, removeFromHistory };
}
