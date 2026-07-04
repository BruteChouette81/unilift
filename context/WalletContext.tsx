import { useAuth } from "@/context/AuthContext";
import { getTransactions, setupWallet } from "@/services/walletService";
import type { WalletTransaction } from "@/types/models";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

type PaymentMethod = { id: string; last4: string; brand: string };

export interface WalletContextValue {
  pendingChargeCents: number;
  pendingEarningsCents: number;
  paymentMethod: PaymentMethod | null;
  hasPaymentMethod: boolean;
  transactions: WalletTransaction[];
  stripeCustomerId: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Silent re-fetch (no pull-to-refresh spinner). Use after mutations / on focus. */
  reload: () => Promise<void>;
  /** Re-fetch that drives the pull-to-refresh spinner. */
  refresh: () => Promise<void>;
  setPaymentMethod: React.Dispatch<React.SetStateAction<PaymentMethod | null>>;
  refreshTransactions: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [pendingChargeCents, setPendingCharge]     = useState(0);
  const [pendingEarningsCents, setPendingEarnings] = useState(0);
  const [paymentMethod, setPaymentMethod]          = useState<PaymentMethod | null>(null);
  const [transactions, setTransactions]            = useState<WalletTransaction[]>([]);
  const [stripeCustomerId, setCustomerId]          = useState<string | null>(null);
  const [loading, setLoading]                      = useState(true);
  const [refreshing, setRefreshing]                = useState(false);
  const [error, setError]                          = useState<string | null>(null);

  // Monotonic token: only the most-recently-started load may commit its result.
  // Without this, the initial fetch (with its 1.2s retry) can resolve *after*
  // the user adds a card and overwrite `paymentMethod` back to null.
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const seq = ++loadSeqRef.current;
    const isStale = () => seq !== loadSeqRef.current;
    setError(null);
    try {
      const token = await user.getIdToken();

      let setupData: any;
      try {
        setupData = await setupWallet(token);
      } catch {
        // First attempt failed — wait briefly and retry (handles cold-start / no customerId yet)
        await new Promise((r) => setTimeout(r, 1200));
        try {
          setupData = await setupWallet(await user.getIdToken());
        } catch (retryErr: any) {
          if (isStale()) return;
          setError(retryErr.message ?? "Failed to load wallet");
          return;
        }
      }

      if (isStale()) return;
      setPendingCharge(setupData.pendingChargeCents ?? 0);
      setPendingEarnings(setupData.pendingEarningsCents ?? 0);
      setPaymentMethod(setupData.paymentMethod ?? null);
      setCustomerId(setupData.customerId ?? null);

      // Transactions are best-effort
      try {
        const txData = await getTransactions(await user.getIdToken());
        if (isStale()) return;
        setTransactions(txData.transactions ?? []);
      } catch {
        if (isStale()) return;
        setTransactions([]);
      }
    } catch (err: any) {
      if (isStale()) return;
      console.error("useWallet load error:", err);
      setError(err.message ?? "Failed to load wallet");
    }
  }, [user]);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const refreshTransactions = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const txData = await getTransactions(token);
      setTransactions(txData.transactions ?? []);
    } catch (err) {
      console.error("refreshTransactions error:", err);
    }
  }, [user]);

  // Initial load on login; clear state on logout (and invalidate any in-flight load).
  useEffect(() => {
    if (!user) {
      loadSeqRef.current++;
      setPendingCharge(0);
      setPendingEarnings(0);
      setPaymentMethod(null);
      setTransactions([]);
      setCustomerId(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [user, load]);

  const lastForegroundRefreshAt = useRef(0);

  // App-wide foreground sync: re-fetch when the app returns to the foreground so
  // the header wallet pill and ride-join gate reflect backend/cross-device changes.
  // Throttled to at most once per 60 seconds to avoid redundant wallet fetches.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !user) return;
      const now = Date.now();
      if (now - lastForegroundRefreshAt.current < 60000) return;
      lastForegroundRefreshAt.current = now;
      void load();
    });
    return () => sub.remove();
  }, [user, load]);

  const hasPaymentMethod = !!paymentMethod?.id;

  return (
    <WalletContext.Provider
      value={{
        pendingChargeCents,
        pendingEarningsCents,
        paymentMethod,
        hasPaymentMethod,
        transactions,
        stripeCustomerId,
        loading,
        refreshing,
        error,
        reload,
        refresh,
        setPaymentMethod,
        refreshTransactions,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
