import { useAuth } from "@/context/AuthContext";
import { getTransactions, setupWallet } from "@/services/walletService";
import {
  getPayoutSummary,
  refreshConnectStatus,
  type ConnectState,
  type PayoutSummary,
} from "@/services/connectService";
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
import { devError } from "@/constants/runtime-config";

type PaymentMethod = { id: string; last4: string; brand: string };

interface WalletContextValue {
  pendingChargeCents: number;
  pendingEarningsCents: number;
  /**
   * Earnings minus charges — the single number the wallet card and the header
   * pill both render. Positive = UniLift owes the user, negative = the user
   * owes UniLift. Month-end settlement moves only this difference.
   */
  netBalanceCents: number;
  paymentMethod: PaymentMethod | null;
  hasPaymentMethod: boolean;
  /** Driver payout state (Stripe Connect). Independent of `paymentMethod` —
   *  that is how this user PAYS, this is how they GET PAID. */
  connect: ConnectState;
  /** Re-read Connect status from Stripe. Call after returning from onboarding. */
  refreshConnect: () => Promise<void>;
  /** Settled balance + when the next automatic monthly payout will send it.
   *  Decided server-side so the wallet and the payout job always agree. */
  payouts: PayoutSummary;
  /** Re-read the payout summary. */
  refreshPayouts: () => Promise<void>;
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

const DEFAULT_PAYOUTS: PayoutSummary = {
  availableCents: 0,
  balanceCents: 0,
  outstandingChargeCents: 0,
  pendingCents: 0,
  pendingNetCents: 0,
  minPayoutCents: 2500,
  payoutFeeCents: 0,
  netPayoutCents: 0,
  nextPayoutDate: "",
  testCashoutEnabled: false,   // TEST-ONLY — delete with the test payout surface
  canCashout: false,
  reason: null,
  pendingRequest: null,
};

const DEFAULT_CONNECT: ConnectState = {
  status: "none",
  payoutsEnabled: false,
  requirementsDue: [],
  bankLast4: null,
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [pendingChargeCents, setPendingCharge]     = useState(0);
  const [pendingEarningsCents, setPendingEarnings] = useState(0);
  const [paymentMethod, setPaymentMethod]          = useState<PaymentMethod | null>(null);
  const [transactions, setTransactions]            = useState<WalletTransaction[]>([]);
  const [stripeCustomerId, setCustomerId]          = useState<string | null>(null);
  const [connect, setConnect]                      = useState<ConnectState>(DEFAULT_CONNECT);
  const [payouts, setPayouts]                      = useState<PayoutSummary>(DEFAULT_PAYOUTS);
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
      setConnect({ ...DEFAULT_CONNECT, ...(setupData.connect ?? {}) });

      // Payout summary is best-effort — a failure here must not blank the card
      // or the balance, which are the parts the passenger flow depends on.
      try {
        const summaryRes = await getPayoutSummary(await user.getIdToken());
        if (isStale()) return;
        if (summaryRes.ok) {
          const { ok: _ok, ...summary } = summaryRes;
          setPayouts({ ...DEFAULT_PAYOUTS, ...summary });
        }
      } catch {
        if (isStale()) return;
      }

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
      devError("useWallet load error:", err);
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
      devError("refreshTransactions error:", err);
    }
  }, [user]);

  const refreshPayouts = useCallback(async () => {
    if (!user) return;
    try {
      const res = await getPayoutSummary(await user.getIdToken());
      if (res.ok) {
        const { ok: _ok, ...summary } = res;
        setPayouts({ ...DEFAULT_PAYOUTS, ...summary });
      }
    } catch (err) {
      devError("refreshPayouts error:", err);
    }
  }, [user]);

  // Ask the server to re-read Stripe. Separate from `load()` because returning
  // from the hosted onboarding flow needs the fresh Connect state immediately,
  // without re-fetching the card and the whole transaction list.
  const refreshConnect = useCallback(async () => {
    if (!user) return;
    try {
      const res = await refreshConnectStatus(await user.getIdToken());
      if (res.ok) {
        const { ok: _ok, ...state } = res;
        setConnect({ ...DEFAULT_CONNECT, ...state });
      }
    } catch (err) {
      devError("refreshConnect error:", err);
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
      setConnect(DEFAULT_CONNECT);
      setPayouts(DEFAULT_PAYOUTS);
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
  const netBalanceCents = pendingEarningsCents - pendingChargeCents;

  return (
    <WalletContext.Provider
      value={{
        pendingChargeCents,
        pendingEarningsCents,
        netBalanceCents,
        paymentMethod,
        hasPaymentMethod,
        connect,
        refreshConnect,
        payouts,
        refreshPayouts,
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
