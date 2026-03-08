import { getTransactions, setupWallet } from "@/services/walletService";
import type { WalletTransaction } from "@/types/models";
import type { User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";

export function useWallet(user: User | null) {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [stripeCustomerId, setCustomerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const token = await user.getIdToken();
      console.log("Loading wallet with token:", token);

      // Setup wallet (creates Stripe customer if missing) — retry once silently
      let setupData: any;
      try {
        setupData = await setupWallet(token);
      } catch {
        // First attempt failed — wait briefly and retry (handles cold-start / no customerId yet)
        await new Promise((r) => setTimeout(r, 1200));
        try {
          setupData = await setupWallet(await user.getIdToken());
        } catch (retryErr: any) {
          setError(retryErr.message ?? "Failed to load wallet");
          return;
        }
      }

      setBalance(setupData.balance ?? 0);
      setCustomerId(setupData.customerId ?? null);

      // Transactions are best-effort: a missing index or empty subcollection must not block the screen
      try {
        const txData = await getTransactions(await user.getIdToken());
        setTransactions(txData.transactions ?? []);
      } catch {
        setTransactions([]);
      }
    } catch (err: any) {
      console.error("useWallet load error:", err);
      setError(err.message ?? "Failed to load wallet");
    }
  }, [user]);

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

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  return {
    balance,
    transactions,
    stripeCustomerId,
    loading,
    refreshing,
    error,
    refresh,
    setBalance,
    refreshTransactions,
  };
}
