import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/hooks/use-wallet";
import { addFunds, confirmPayment, requestCashout, setupWallet } from "@/services/walletService";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  initPaymentSheet,
  presentPaymentSheet,
} from "@stripe/stripe-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// ── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  border:      "rgba(124, 58, 237, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#7C3AED",
  purpleLight: "#a78bfa",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
  success:     "#34d399",
  gold:        "#fbbf24",
};

const BALANCE_GRADIENT = ["#3b0764", "#1e3a8a"] as const;
const BUTTON_GRADIENT  = ["#7C3AED", "#2563eb"] as const;
const CARD_GRADIENT    = ["#1e1b4b", "#0d1224"] as const;

const PRESETS = [10, 20, 50, 100];

// ── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={sh.row}>
      <View style={sh.iconDot}>
        <Ionicons name={icon as any} size={14} color={C.purpleLight} />
      </View>
      <Text style={sh.title}>{title}</Text>
    </View>
  );
}

const sh = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, marginTop: 24 },
  iconDot: { width: 26, height: 26, borderRadius: 7, backgroundColor: "rgba(167,139,250,0.12)", alignItems: "center", justifyContent: "center" },
  title:   { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
});

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const color = status === "completed" ? C.success : status === "failed" ? C.danger : C.gold;
  const bg    = status === "completed" ? "rgba(52,211,153,0.12)" : status === "failed" ? "rgba(248,113,113,0.12)" : "rgba(251,191,36,0.12)";
  return (
    <View style={[badge.wrap, { backgroundColor: bg, borderColor: color + "44" }]}>
      <Text style={[badge.text, { color }]}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  text: { fontSize: 11, fontWeight: "600" },
});

// ── Error Banner ──────────────────────────────────────────────────────────────
function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={eb.wrap}>
      <Ionicons name="alert-circle-outline" size={16} color={C.danger} />
      <Text style={eb.text} numberOfLines={2}>{message}</Text>
      <TouchableOpacity onPress={onRetry} style={eb.retryBtn}>
        <Text style={eb.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const eb = StyleSheet.create({
  wrap:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(248,113,113,0.1)", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "rgba(248,113,113,0.25)", marginBottom: 8 },
  text:      { flex: 1, color: C.danger, fontSize: 13 },
  retryBtn:  { backgroundColor: "rgba(248,113,113,0.2)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  retryText: { color: C.danger, fontSize: 12, fontWeight: "600" },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function WalletScreen() {
  const { user } = useAuth();
  const {
    balance,
    transactions,
    loading,
    refreshing,
    error,
    refresh,
    setBalance,
    refreshTransactions,
  } = useWallet(user);

  const [actionLoading, setActionLoading] = useState(false);
  const [showAddFunds, setShowAddFunds]   = useState(false);
  const [showCashout, setShowCashout]     = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customAmount, setCustomAmount]      = useState("");
  const [cashoutAmount, setCashoutAmount]    = useState("");

  const getAddAmount = (): number => {
    if (customAmount) return parseFloat(customAmount) || 0;
    return selectedPreset ?? 0;
  };

  const handleAddFunds = async () => {
    if (!user) {
      Alert.alert("Not signed in", "Please sign in to add funds.");
      return;
    }
    const dollars = getAddAmount();
    if (!dollars || dollars < 10) {
      Alert.alert("Minimum $10", "Please select or enter at least $10.");
      return;
    }
    const amountCents = Math.round(dollars * 100);
    setActionLoading(true);
    try {
      const token = await user.getIdToken();

      let customerId: string;
      let ephemeralKey: string;
      let clientSecret: string;

      try {
        let setupData = await setupWallet(token).catch(async () => {
          // Silent retry after brief delay (handles missing customerId on first use)
          await new Promise((r) => setTimeout(r, 1200));
          return setupWallet(await user.getIdToken());
        });
        if (!setupData?.customerId) {
          // Still no customer — one more attempt then give up
          await new Promise((r) => setTimeout(r, 1500));
          setupData = await setupWallet(await user.getIdToken());
        }
        customerId   = setupData.customerId;
        ephemeralKey = setupData.ephemeralKey;
      } catch {
        Alert.alert("Setup Failed", "Could not connect to payment service. Please try again.");
        return;
      }

      try {
        const fundsData = await addFunds(token, amountCents);
        clientSecret = fundsData.clientSecret;
      } catch (err: any) {
        Alert.alert("Payment Error", err.message ?? "Could not create payment. Please try again.");
        return;
      }

      const { error: initError } = await initPaymentSheet({
        customerId,
        customerEphemeralKeySecret: ephemeralKey,
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: "UniLift",
      });
      if (initError) {
        Alert.alert("Payment Setup Error", initError.message);
        return;
      }

      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        // "Canceled" is not an error — user dismissed the sheet
        if (presentError.code !== "Canceled") {
          Alert.alert("Payment Failed", presentError.message);
        }
        return;
      }

      // Extract paymentIntentId from clientSecret format: "pi_xxx_secret_yyy"
      const paymentIntentId = clientSecret.split("_secret_")[0];
      if (!paymentIntentId.startsWith("pi_")) {
        Alert.alert("Confirmation Error", "Could not verify payment. Contact support if funds were deducted.");
        return;
      }

      try {
        const { balance: newBalance } = await confirmPayment(token, paymentIntentId);
        setBalance(newBalance);
        await refreshTransactions();
        setShowAddFunds(false);
        setSelectedPreset(null);
        setCustomAmount("");
        Alert.alert("Success", `$${(amountCents / 100).toFixed(2)} added to your wallet!`);
      } catch (err: any) {
        // Payment went through but confirmation failed — don't lose their money
        Alert.alert(
          "Confirmation Pending",
          "Your payment was processed but balance may take a moment to update. Pull to refresh.",
        );
        await refresh();
      }
    } catch (err: any) {
      Alert.alert("Unexpected Error", err.message ?? "Something went wrong. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCashout = async () => {
    if (!user) {
      Alert.alert("Not signed in", "Please sign in to request a cashout.");
      return;
    }
    const dollars = parseFloat(cashoutAmount) || 0;
    if (dollars < 10) {
      Alert.alert("Minimum $10", "Minimum cashout amount is $10.");
      return;
    }
    const amountCents = Math.round(dollars * 100);
    if (amountCents > balance) {
      Alert.alert("Insufficient Balance", `Your balance is $${(balance / 100).toFixed(2)}.`);
      return;
    }
    Alert.alert(
      "Confirm Cashout",
      `Cash out $${dollars.toFixed(2)}? Funds arrive in 2–5 business days.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            setActionLoading(true);
            try {
              const token = await user.getIdToken();
              const { balance: newBalance } = await requestCashout(token, amountCents);
              setBalance(newBalance);
              await refreshTransactions();
              setShowCashout(false);
              setCashoutAmount("");
              Alert.alert("Cashout Requested", "Your cashout is being processed.");
            } catch (err: any) {
              const msg = err.message ?? "Something went wrong.";
              Alert.alert("Cashout Failed", msg);
            } finally {
              setActionLoading(false);
            }
          },
        },
      ],
    );
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={C.purpleLight} />
        <Text style={styles.loadingText}>Loading wallet…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.purpleLight} />
      }
    >
      {/* ── Balance Card ────────────────────────────────────────────────── */}
      <LinearGradient colors={BALANCE_GRADIENT} style={styles.balanceCard}>
        <View style={styles.balanceHeader}>
          <Text style={styles.balanceLabel}>My Wallet</Text>
          <Ionicons name="wallet" size={22} color="rgba(255,255,255,0.7)" />
        </View>
        <Text style={styles.balanceAmount}>${(balance / 100).toFixed(2)}</Text>
        <Text style={styles.balanceSubtitle}>Available balance</Text>
      </LinearGradient>

      <View style={styles.content}>
        {/* ── Error Banner ────────────────────────────────────────────────── */}
        {error && <ErrorBanner message={error} onRetry={refresh} />}

        {/* ── Action Row ──────────────────────────────────────────────────── */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtnWrap}
            activeOpacity={0.8}
            disabled={actionLoading}
            onPress={() => { setShowAddFunds(!showAddFunds); setShowCashout(false); }}
          >
            <LinearGradient colors={BUTTON_GRADIENT} style={styles.actionBtn}>
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>Add Funds</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtnWrap, balance === 0 && styles.actionBtnDisabled]}
            activeOpacity={balance === 0 ? 1 : 0.8}
            disabled={balance === 0 || actionLoading}
            onPress={() => { setShowCashout(!showCashout); setShowAddFunds(false); }}
          >
            <LinearGradient
              colors={balance === 0 ? ["#1a1040", "#0f1730"] : BUTTON_GRADIENT}
              style={styles.actionBtn}
            >
              <Ionicons
                name="arrow-down-circle-outline"
                size={20}
                color={balance === 0 ? C.dim : "#fff"}
              />
              <Text style={[styles.actionBtnText, balance === 0 && { color: C.dim }]}>
                Cash Out
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* ── Add Funds Panel ──────────────────────────────────────────────── */}
        {showAddFunds && (
          <LinearGradient colors={CARD_GRADIENT} style={styles.panel}>
            <Text style={styles.panelTitle}>Add Funds</Text>

            <View style={styles.presetRow}>
              {PRESETS.map((amount) => (
                <TouchableOpacity
                  key={amount}
                  style={[
                    styles.presetChip,
                    selectedPreset === amount && !customAmount && styles.presetChipActive,
                  ]}
                  onPress={() => { setSelectedPreset(amount); setCustomAmount(""); }}
                >
                  <Text style={[
                    styles.presetChipText,
                    selectedPreset === amount && !customAmount && styles.presetChipTextActive,
                  ]}>
                    ${amount}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.inputWrapper}>
              <Text style={styles.inputCurrency}>$</Text>
              <TextInput
                style={styles.input}
                placeholder="Custom amount"
                placeholderTextColor={C.dim}
                keyboardType="decimal-pad"
                value={customAmount}
                onChangeText={(v) => { setCustomAmount(v); setSelectedPreset(null); }}
              />
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleAddFunds}
              disabled={actionLoading}
              style={[styles.primaryBtnWrap, actionLoading && styles.disabledBtn]}
            >
              <LinearGradient colors={BUTTON_GRADIENT} style={styles.primaryBtn}>
                {actionLoading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>Pay with Card</Text>
                }
              </LinearGradient>
            </TouchableOpacity>
          </LinearGradient>
        )}

        {/* ── Cash Out Panel ───────────────────────────────────────────────── */}
        {showCashout && (
          <LinearGradient colors={CARD_GRADIENT} style={styles.panel}>
            <Text style={styles.panelTitle}>Cash Out</Text>

            <View style={styles.inputWrapper}>
              <Text style={styles.inputCurrency}>$</Text>
              <TextInput
                style={styles.input}
                placeholder={`Max $${(balance / 100).toFixed(2)}`}
                placeholderTextColor={C.dim}
                keyboardType="decimal-pad"
                value={cashoutAmount}
                onChangeText={setCashoutAmount}
              />
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleCashout}
              disabled={actionLoading}
              style={[styles.primaryBtnWrap, actionLoading && styles.disabledBtn]}
            >
              <LinearGradient colors={BUTTON_GRADIENT} style={styles.primaryBtn}>
                {actionLoading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.primaryBtnText}>Request Cashout</Text>
                }
              </LinearGradient>
            </TouchableOpacity>

            <Text style={styles.cashoutNote}>
              Funds arrive in 2–5 business days via bank transfer
            </Text>
          </LinearGradient>
        )}

        {/* ── Transactions ─────────────────────────────────────────────────── */}
        <SectionHeader icon="receipt-outline" title="Transactions" />

        {transactions.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="receipt-outline" size={26} color={C.purple} />
            </View>
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptySubtext}>Add funds to get started</Text>
          </View>
        ) : (
          transactions.map((tx) => (
            <View key={tx.id} style={styles.txRow}>
              <View style={[
                styles.txIconWrap,
                { backgroundColor: tx.type === "topup" ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)" },
              ]}>
                <Ionicons
                  name={tx.type === "topup" ? "arrow-up" : "arrow-down"}
                  size={16}
                  color={tx.type === "topup" ? C.success : C.danger}
                />
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txDesc} numberOfLines={1}>{tx.description}</Text>
                <Text style={styles.txDate}>
                  {new Date(tx.createdAt).toLocaleDateString("en-CA", {
                    month: "short", day: "numeric", year: "numeric",
                  })}
                </Text>
              </View>
              <View style={styles.txRight}>
                <Text style={[styles.txAmount, { color: tx.type === "topup" ? C.success : C.danger }]}>
                  {tx.type === "topup" ? "+" : "-"}${(tx.amount / 100).toFixed(2)}
                </Text>
                <StatusBadge status={tx.status} />
              </View>
            </View>
          ))
        )}

        <View style={{ height: 32 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText:      { color: C.muted, fontSize: 14 },
  container:        { flex: 1, backgroundColor: C.bg },
  content:          { paddingHorizontal: 16 },

  // Balance card
  balanceCard:     { margin: 16, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  balanceHeader:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  balanceLabel:    { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "600" },
  balanceAmount:   { color: "#fff", fontSize: 42, fontWeight: "800", letterSpacing: -1 },
  balanceSubtitle: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 4 },

  // Action row
  actionRow:         { flexDirection: "row", gap: 12, marginBottom: 4 },
  actionBtnWrap:     { flex: 1, borderRadius: 14, overflow: "hidden" },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  actionBtnText:     { color: "#fff", fontWeight: "700", fontSize: 14 },

  // Panel
  panel:      { borderRadius: 16, padding: 16, marginTop: 12, borderWidth: 1, borderColor: C.border, gap: 12 },
  panelTitle: { color: C.text, fontSize: 15, fontWeight: "700" },

  // Presets
  presetRow:           { flexDirection: "row", gap: 8 },
  presetChip:          { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: "center", backgroundColor: "rgba(255,255,255,0.04)" },
  presetChipActive:    { backgroundColor: "rgba(124,58,237,0.25)", borderColor: C.purple },
  presetChipText:      { color: C.muted, fontWeight: "600", fontSize: 14 },
  presetChipTextActive:{ color: C.purpleLight },

  // Input
  inputWrapper:  { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)", borderRadius: 10, paddingHorizontal: 12 },
  inputCurrency: { color: C.muted, fontSize: 16, marginRight: 4 },
  input:         { flex: 1, paddingVertical: 12, fontSize: 15, color: C.text },

  // Primary button
  primaryBtnWrap: { borderRadius: 12, overflow: "hidden" },
  primaryBtn:     { paddingVertical: 14, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  disabledBtn:    { opacity: 0.6 },

  // Cashout note
  cashoutNote: { color: C.dim, fontSize: 12, textAlign: "center" },

  // Transactions
  txRow:      { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14, backgroundColor: C.surface, borderRadius: 12, marginBottom: 7, borderWidth: 1, borderColor: C.borderFaint },
  txIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 12 },
  txInfo:     { flex: 1 },
  txDesc:     { color: C.text, fontSize: 13, fontWeight: "600" },
  txDate:     { color: C.muted, fontSize: 11, marginTop: 2 },
  txRight:    { alignItems: "flex-end", gap: 4 },
  txAmount:   { fontSize: 14, fontWeight: "700" },

  // Empty state
  emptyState:    { alignItems: "center", paddingVertical: 28, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.borderFaint, gap: 5 },
  emptyIconWrap: { width: 52, height: 52, borderRadius: 14, backgroundColor: "rgba(124,58,237,0.1)", alignItems: "center", justifyContent: "center", marginBottom: 4, borderWidth: 1, borderColor: C.border },
  emptyTitle:    { color: C.text, fontSize: 14, fontWeight: "600" },
  emptySubtext:  { color: C.dim, fontSize: 12 },
});
