import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useWallet } from "@/context/WalletContext";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import {
  confirmPaymentMethod,
  removePaymentMethod,
  setupPaymentMethod,
} from "@/services/walletService";
import {
  initPaymentSheet,
  presentPaymentSheet,
} from "@stripe/stripe-react-native";
import InfoButton from "@/components/info-button";
import WizardModal, { type WizardStep } from "@/components/wizard/wizard-modal";
import { useFirstRun } from "@/hooks/use-first-run";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// ── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(137, 56, 213, 0.30)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  pink:        "#FD165A",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
  success:     "#34d399",
  gold:        "#fbbf24",
};

const BALANCE_GRADIENT  = ["#1c0038", "#08001a"] as const;
const CARD_GRADIENT     = ["#1e1b4b", "#0d1224"] as const;
const EARNINGS_GRADIENT = ["#052e16", "#0d1224"] as const;
const BTN_GRADIENT      = ["#FD165A", "#8938D5"] as const;

// Safety net for `presentPaymentSheet` — generous enough that a user filling in
// card details is never cut off, short enough that a sheet which failed to
// present can't strand the UI in a permanent spinner.
const PAYMENT_SHEET_TIMEOUT_MS = 120_000;

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

// ── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ iconName, title }: { iconName: IoniconsName; title: string }) {
  return (
    <View style={sh.row}>
      <View style={sh.iconDot}>
        <Ionicons name={iconName} size={14} color={C.purpleLight} />
      </View>
      <Text style={sh.title}>{title}</Text>
    </View>
  );
}

const sh = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, marginTop: 24 },
  iconDot: { width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(224,154,247,0.10)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(224,154,247,0.15)" },
  title:   { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
});

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, label }: { status: string; label: string }) {
  const color = status === "completed" ? C.success : status === "failed" ? C.danger : C.gold;
  const bg    = status === "completed" ? "rgba(52,211,153,0.12)" : status === "failed" ? "rgba(248,113,113,0.12)" : "rgba(251,191,36,0.12)";
  return (
    <View style={[badge.wrap, { backgroundColor: bg, borderColor: color + "44" }]}>
      <Text style={[badge.text, { color }]}>{label}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  text: { fontSize: 11, fontWeight: "600" },
});

// ── Error Banner ──────────────────────────────────────────────────────────────
function ErrorBanner({ message, onRetry, retryLabel }: { message: string; onRetry: () => void; retryLabel: string }) {
  return (
    <View style={eb.wrap}>
      <Ionicons name="warning-outline" size={16} color={C.danger} />
      <Text style={eb.text} numberOfLines={2}>{message}</Text>
      <TouchableOpacity onPress={onRetry} style={eb.retryBtn}>
        <Text style={eb.retryText}>{retryLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const eb = StyleSheet.create({
  wrap:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(248,113,113,0.1)", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "rgba(248,113,113,0.25)", marginBottom: 8 },
  text:      { flex: 1, color: C.danger, fontSize: 13 },
  retryBtn:  { backgroundColor: "rgba(248,113,113,0.2)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  retryText: { color: C.danger, fontSize: 12, fontWeight: "600" },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function WalletScreen() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const {
    pendingChargeCents,
    pendingEarningsCents,
    paymentMethod,
    transactions,
    loading,
    refreshing,
    error,
    refresh,
    reload,
    setPaymentMethod,
  } = useWallet();

  const [actionLoading, setActionLoading] = useState(false);
  // Same-tick re-entrancy guard: two taps in one frame both read the stale
  // `actionLoading`, and a second initPaymentSheet orphans the first sheet.
  const addCardInFlight = useRef(false);
  // Set when the wizard's final CTA is tapped; consumed once the modal is gone.
  const pendingAddCard = useRef(false);

  // Re-sync card + transactions when returning to the tab or foregrounding.
  useLiveRefresh(reload);

  // First-run wizard: explains how to connect a card. Auto-fires once only
  // while the user has no payment method; always replayable from the link.
  const cardWizard = useFirstRun("wallet-card");
  const cardWizardSteps = useMemo<WizardStep[]>(() => [
    { icon: "card-outline",          title: t("wizard.wallet.step1Title"), highlight: t("wizard.wallet.step1Highlight"), body: t("wizard.wallet.step1Body") },
    { icon: "lock-closed-outline",   title: t("wizard.wallet.step2Title"), body: t("wizard.wallet.step2Body") },
    { icon: "calendar-outline",      title: t("wizard.wallet.step3Title"), body: t("wizard.wallet.step3Body") },
  ], [t]);
  const showCardWizard = cardWizard.shouldShow && !paymentMethod && !loading;

  // ── Add Card ────────────────────────────────────────────────────────────────
  const handleAddCard = async () => {
    if (!user || addCardInFlight.current) return;
    addCardInFlight.current = true;
    setActionLoading(true);
    try {
      const token = await user.getIdToken();

      let setupData: any;
      try {
        setupData = await setupPaymentMethod(token);
      } catch {
        await new Promise((r) => setTimeout(r, 1200));
        setupData = await setupPaymentMethod(await user.getIdToken());
      }

      const { clientSecret, customerId, ephemeralKey } = setupData;

      const { error: initError } = await initPaymentSheet({
        customerId,
        customerEphemeralKeySecret: ephemeralKey,
        setupIntentClientSecret: clientSecret,
        merchantDisplayName: "UniLift",
        applePay: {
          merchantCountryCode: "CA",
        },
      });
      if (initError) {
        Alert.alert(t("wallet.paymentSetupError"), initError.message);
        return;
      }

      // Hard backstop: if the sheet can never present, the native completion
      // handler is never called and this promise would otherwise hang forever,
      // leaving the button stuck in its disabled spinner state.
      const { error: presentError } = await presentPaymentSheet({ timeout: PAYMENT_SHEET_TIMEOUT_MS });
      if (presentError) {
        if (presentError.code !== "Canceled") {
          Alert.alert(t("wallet.paymentFailed"), presentError.message);
        }
        return;
      }

      const setupIntentId = clientSecret.split("_secret_")[0];
      const freshToken = await user.getIdToken();
      const { paymentMethod: pm } = await confirmPaymentMethod(freshToken, setupIntentId);
      setPaymentMethod(pm);          // instant optimistic feedback
      void reload();                 // reconcile in the background — never block the spinner
    } catch (err: any) {
      Alert.alert(t("wallet.unexpectedError"), err.message ?? t("wallet.somethingWrong"));
    } finally {
      addCardInFlight.current = false;
      setActionLoading(false);
    }
  };

  // ── Remove Card ──────────────────────────────────────────────────────────────
  const handleRemoveCard = async () => {
    if (!user) return;
    Alert.alert(
      t("wallet.removeCard"),
      t("wallet.removeCardMsg"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.confirm"),
          style: "destructive",
          onPress: async () => {
            setActionLoading(true);
            try {
              const token = await user.getIdToken();
              await removePaymentMethod(token);
              setPaymentMethod(null);   // instant optimistic feedback
              await reload();           // reconcile with backend truth (shared state)
            } catch (err: any) {
              Alert.alert(t("wallet.unexpectedError"), err.message ?? t("wallet.somethingWrong"));
            } finally {
              setActionLoading(false);
            }
          },
        },
      ],
    );
  };

  // ── Loading state ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={C.purpleLight} />
        <Text style={styles.loadingText}>{t("wallet.loading")}</Text>
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
      {/* ── Balance Hero Card ─────────────────────────────────────────────── */}
      <LinearGradient colors={BALANCE_GRADIENT} style={styles.balanceCard}>
        <View style={styles.balanceHeader}>
          <View style={styles.balanceLabelRow}>
            <View style={styles.balanceIconWrap}>
              <Ionicons name="wallet-outline" size={16} color={C.purpleLight} />
            </View>
            <Text style={styles.balanceLabel}>{t("wallet.pendingThisMonth")}</Text>
          </View>
          <InfoButton
            title={t("wallet.info.pendingCharge.title")}
            body={t("wallet.info.pendingCharge.body")}
          />
        </View>
        <Text style={styles.balanceAmount}>${(pendingChargeCents / 100).toFixed(2)}</Text>
        <View style={styles.balanceFooter}>
          <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.4)" />
          <Text style={styles.balanceSubtitle}>{t("wallet.billedEndOfMonth")}</Text>
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {/* ── Error Banner ─────────────────────────────────────────────────── */}
        {error && <ErrorBanner message={error} onRetry={refresh} retryLabel={t("wallet.retry")} />}

        {/* ── Payment Method Section ────────────────────────────────────────── */}
        <View style={styles.sectionRow}>
          <SectionHeader iconName="card-outline" title={t("wallet.paymentMethod")} />
          <InfoButton
            title={t("wallet.info.paymentMethod.title")}
            body={t("wallet.info.paymentMethod.body")}
          />
        </View>

        {paymentMethod ? (
          <View style={styles.pmRow}>
            <View style={styles.pmIconWrap}>
              <Ionicons name="card-outline" size={20} color={C.purpleLight} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pmBrand}>
                {paymentMethod.brand.toUpperCase()} •••• {paymentMethod.last4}
              </Text>
              <Text style={styles.pmLabel}>{t("wallet.defaultCard")}</Text>
            </View>
            <TouchableOpacity onPress={handleRemoveCard} disabled={actionLoading} hitSlop={8} style={styles.removeBtn}>
              <Ionicons name="trash-outline" size={16} color={C.danger} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.addCardBtn, actionLoading && { opacity: 0.6 }]}
              onPress={handleAddCard}
              disabled={actionLoading}
              activeOpacity={0.75}
            >
              {actionLoading ? (
                <ActivityIndicator size="small" color={C.purpleLight} />
              ) : (
                <LinearGradient
                  colors={BTN_GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.addCardIconGrad}
                >
                  <Ionicons name="add" size={16} color="#fff" />
                </LinearGradient>
              )}
              <Text style={styles.addCardBtnText}>{t("wallet.addCard")}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={cardWizard.replay} style={styles.howItWorksBtn} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="help-circle-outline" size={15} color={C.muted} />
              <Text style={styles.howItWorksText}>{t("wizard.replay")}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Driver Earnings (only if driver has pending earnings) ─────────── */}
        {pendingEarningsCents > 0 && (
          <>
            <View style={styles.sectionRow}>
              <SectionHeader iconName="cash-outline" title={t("wallet.pendingEarnings")} />
              <InfoButton
                title={t("wallet.info.earnings.title")}
                body={t("wallet.info.earnings.body")}
              />
            </View>
            <LinearGradient colors={EARNINGS_GRADIENT} style={styles.earningsCard}>
              <View style={styles.earningsRow}>
                <View style={styles.earningsIconWrap}>
                  <Ionicons name="trending-up-outline" size={18} color={C.success} />
                </View>
                <View>
                  <Text style={styles.earningsAmount}>
                    ${(pendingEarningsCents / 100).toFixed(2)}
                  </Text>
                  <Text style={styles.earningsLabel}>{t("wallet.paidEndOfMonth")}</Text>
                </View>
              </View>
            </LinearGradient>
          </>
        )}

        {/* ── Transactions ─────────────────────────────────────────────────── */}
        <View style={styles.sectionRow}>
          <SectionHeader iconName="receipt-outline" title={t("wallet.transactions")} />
          <InfoButton
            title={t("wallet.info.transactions.title")}
            body={t("wallet.info.transactions.body")}
          />
        </View>

        {transactions.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="receipt-outline" size={26} color={C.purpleLight} />
            </View>
            <Text style={styles.emptyTitle}>{t("wallet.noTransactions")}</Text>
            <Text style={styles.emptySubtext}>{t("wallet.noTransactionsSub")}</Text>
          </View>
        ) : (
          transactions.map((tx) => {
            const isCredit = tx.type === "ride_earning" || tx.type === "monthly_payout";
            const txTypeNames: Record<typeof tx.type, string> = {
              ride_charge:    t("wallet.txRideCharge"),
              ride_earning:   t("wallet.txRideEarning"),
              monthly_charge: t("wallet.txMonthlyCharge"),
              monthly_payout: t("wallet.txMonthlyPayout"),
            };
            return (
              <View key={tx.id} style={styles.txRow}>
                <View style={[
                  styles.txIconWrap,
                  { backgroundColor: isCredit ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)", borderColor: isCredit ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)" },
                ]}>
                  <Ionicons
                    name={isCredit ? "arrow-up-outline" : "arrow-down-outline"}
                    size={16}
                    color={isCredit ? C.success : C.danger}
                  />
                </View>
                <View style={styles.txInfo}>
                  <Text style={styles.txDesc} numberOfLines={1}>{txTypeNames[tx.type]}</Text>
                  <Text style={styles.txDate}>
                    {new Date(tx.createdAt).toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA", {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                  </Text>
                </View>
                <View style={styles.txRight}>
                  <Text style={[styles.txAmount, { color: isCredit ? C.success : C.danger }]}>
                    {isCredit ? "+" : "-"}${(tx.amount / 100).toFixed(2)}
                  </Text>
                  <StatusBadge
                    status={tx.status}
                    label={
                      tx.status === "completed"
                        ? t("wallet.statusCompleted")
                        : tx.status === "failed"
                        ? t("wallet.statusFailed")
                        : t("wallet.statusPending")
                    }
                  />
                </View>
              </View>
            );
          })
        )}

        <View style={{ height: 32 }} />
      </View>

      <WizardModal
        visible={showCardWizard}
        steps={cardWizardSteps}
        onDone={cardWizard.markSeen}
        // The Stripe sheet must wait for `onDismissed` — presenting it from here
        // targets the wizard's own view controller while it is tearing down, and
        // the native present silently never completes.
        onComplete={() => { pendingAddCard.current = true; cardWizard.markSeen(); }}
        onDismissed={() => {
          if (!pendingAddCard.current) return;
          pendingAddCard.current = false;
          void handleAddCard();
        }}
        finalLabel={t("wizard.wallet.finalCta")}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText:      { color: C.muted, fontSize: 14 },
  container:        { flex: 1, backgroundColor: C.bg },
  content:          { paddingHorizontal: 16 },

  // Balance hero card
  balanceCard:      { margin: 16, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: C.border },
  balanceHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  balanceLabelRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  balanceIconWrap:  { width: 30, height: 30, borderRadius: 8, backgroundColor: "rgba(137,56,213,0.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  balanceLabel:     { color: "rgba(255,255,255,0.65)", fontSize: 13, fontWeight: "600" },
  balanceAmount:    { color: "#fff", fontSize: 44, fontWeight: "800", letterSpacing: -1 },
  balanceFooter:    { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  balanceSubtitle:  { color: "rgba(255,255,255,0.4)", fontSize: 12 },

  // Payment method
  pmRow:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(137,56,213,0.06)", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  pmIconWrap: { width: 42, height: 42, borderRadius: 12, backgroundColor: "rgba(137,56,213,0.12)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  pmBrand:    { color: C.text, fontSize: 14, fontWeight: "700" },
  pmLabel:    { color: C.muted, fontSize: 11, marginTop: 2 },
  removeBtn:  { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(248,113,113,0.1)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(248,113,113,0.2)" },

  addCardBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "rgba(137,56,213,0.06)", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  addCardIconGrad:    { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  addCardBtnText:     { color: C.purpleLight, fontSize: 14, fontWeight: "600" },
  howItWorksBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10, marginTop: 2 },
  howItWorksText:     { color: C.muted, fontSize: 12.5, fontWeight: "600" },

  // Earnings card
  earningsCard:    { borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "rgba(52,211,153,0.20)" },
  earningsRow:     { flexDirection: "row", alignItems: "center", gap: 14 },
  earningsIconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(52,211,153,0.10)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(52,211,153,0.20)" },
  earningsAmount:  { color: C.success, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  earningsLabel:   { color: C.muted, fontSize: 12, marginTop: 3 },

  // Transactions
  txRow:      { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14, backgroundColor: "rgba(137,56,213,0.04)", borderRadius: 14, marginBottom: 7, borderWidth: 1, borderColor: C.borderFaint },
  txIconWrap: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", marginRight: 12, borderWidth: 1 },
  txInfo:     { flex: 1 },
  txDesc:     { color: C.text, fontSize: 13, fontWeight: "600" },
  txDate:     { color: C.muted, fontSize: 11, marginTop: 2 },
  txRight:    { alignItems: "flex-end", gap: 4 },
  txAmount:   { fontSize: 14, fontWeight: "700" },

  // Section row wrapper (header + info button)
  sectionRow: { flexDirection: "row", alignItems: "center" },

  // Empty state
  emptyState:    { alignItems: "center", paddingVertical: 32, backgroundColor: "rgba(137,56,213,0.04)", borderRadius: 16, borderWidth: 1, borderColor: C.borderFaint, gap: 6 },
  emptyIconWrap: { width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(137,56,213,0.10)", alignItems: "center", justifyContent: "center", marginBottom: 4, borderWidth: 1, borderColor: C.border },
  emptyTitle:    { color: C.text, fontSize: 14, fontWeight: "600" },
  emptySubtext:  { color: C.dim, fontSize: 12 },
});
