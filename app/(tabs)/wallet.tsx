import { formatCentsAsDollars } from "@/constants/pricing";
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
  formatExplicitSignedCents,
  formatSignedCents,
  signedAmountColor,
} from "@/utils/formatBalance";
import {
  initPaymentSheet,
  presentPaymentSheet,
} from "@stripe/stripe-react-native";
import InfoButton from "@/components/info-button";
import PayoutSetupCard from "@/components/payout-setup-card";
import {
  disconnectConnectAccount,
  openConnectDashboard,
  requestTestCashout,          // TEST-ONLY — delete with the test payout surface
  startConnectOnboarding,
  type ConnectErrorDetail,
} from "@/services/connectService";
import { devWarn } from "@/constants/runtime-config";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
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
import { P } from "@/constants/palette";
import { tabBarClearance } from "@/constants/layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          P.bg,
  surface:     P.surface,
  surfaceAlt:  P.surfaceRaised,
  border:      "rgba(137, 56, 213, 0.30)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      P.accent,
  purpleLight: P.accentLight,
  pink:        P.hype,
  text:        P.text,
  muted:       P.textMuted,
  dim:         P.textDim,
  danger:      P.danger,
  success:     P.success,
  gold:        P.warning,
};

const BALANCE_GRADIENT  = ["#1c0038", "#08001a"] as const;
const CARD_GRADIENT     = ["#1e1b4b", "#0d1224"] as const;

// The balance card keeps one gradient and expresses its sign through the amount
// colour and a tinted border — reskinning the whole card on every balance
// change makes the screen flash on refresh.
const BALANCE_PALETTE = { positive: C.success, negative: C.danger, neutral: "#fff" };
const BORDER_POSITIVE = "rgba(52,211,153,0.25)";
const BORDER_NEGATIVE = "rgba(248,113,113,0.25)";

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

// ── Balance Breakdown Row ─────────────────────────────────────────────────────
function BreakdownRow({
  iconName, color, label, amount,
}: { iconName: IoniconsName; color: string; label: string; amount: number }) {
  return (
    <View style={br.row}>
      <View style={[br.iconWrap, { backgroundColor: color + "1f", borderColor: color + "40" }]}>
        <Ionicons name={iconName} size={13} color={color} />
      </View>
      <Text style={br.label}>{label}</Text>
      <Text style={[br.amount, { color }]}>{formatExplicitSignedCents(amount)}</Text>
    </View>
  );
}

const br = StyleSheet.create({
  row:      { flexDirection: "row", alignItems: "center", gap: 9 },
  iconWrap: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  label:    { flex: 1, color: "rgba(255,255,255,0.60)", fontSize: 13 },
  amount:   { fontSize: 14, fontWeight: "700" },
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
// Which sentence to lead a payout failure with. The codes come from
// classifyStripeError on the server, so this map and the server's diagnosis
// cannot drift apart. Anything unmapped keeps the generic body — the code
// appended underneath is what makes even that case actionable.
const PAYOUT_ERROR_COPY: Record<string, string> = {
  // Platform-side configuration. Nothing is wrong with the driver's account, and
  // telling them to "try again" would be false advice.
  connect_not_enabled:         "wallet.payouts.errNotAvailableYet",
  platform_profile_incomplete: "wallet.payouts.errNotAvailableYet",
  stripe_auth:                 "wallet.payouts.errNotAvailableYet",
  stripe_permission:           "wallet.payouts.errNotAvailableYet",
  // Transient. Retrying really is the right advice here.
  stripe_unavailable:  "wallet.payouts.errStripeUnavailable",
  stripe_rate_limited: "wallet.payouts.errStripeUnavailable",
  network:             "wallet.payouts.errStripeUnavailable",
};

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const {
    pendingChargeCents,
    pendingEarningsCents,
    netBalanceCents,
    paymentMethod,
    transactions,
    loading,
    refreshing,
    error,
    refresh,
    reload,
    setPaymentMethod,
    connect,
    refreshConnect,
    payouts,
    refreshPayouts,
  } = useWallet();

  const balanceColor  = signedAmountColor(netBalanceCents, BALANCE_PALETTE);
  const balanceBorder =
    netBalanceCents > 0 ? BORDER_POSITIVE : netBalanceCents < 0 ? BORDER_NEGATIVE : C.border;
  const tipText =
    netBalanceCents > 0
      ? t("wallet.tipPositive")
      : netBalanceCents < 0
      ? t("wallet.tipNegative")
      : t("wallet.tipNeutral");

  const [actionLoading, setActionLoading] = useState(false);
  // Same-tick re-entrancy guard: two taps in one frame both read the stale
  // `actionLoading`, and a second initPaymentSheet orphans the first sheet.
  const addCardInFlight = useRef(false);
  // Set when the wizard's final CTA is tapped; consumed once the modal is gone.
  const pendingAddCard = useRef(false);
  // Same-tick guard for the payout flows, for the same reason as addCardInFlight
  // above: `payoutBusy` is state, so two taps in one frame both read it stale and
  // both open a browser session — and the second present throws, which surfaced
  // as the generic "couldn't open Stripe" alert.
  const payoutFlowInFlight = useRef(false);

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

  // ── Payout setup (Stripe Connect) ───────────────────────────────────────────
  const [payoutBusy, setPayoutBusy] = useState(false);
  // Payouts are a driver concern, so the section stays out of a pure passenger's
  // wallet entirely — no card, no nudge, nothing to dismiss.
  //
  // `connect.status !== "none"` is deliberately part of the test: a driver who
  // has connected a bank and then cashed out to zero still needs the Manage and
  // Disconnect controls. Gating on earnings alone would strand them with a live
  // Stripe account and no way in the app to remove it.
  // ── TEST-ONLY — DELETE THESE TWO LINES AND UNCOMMENT THE ORIGINAL ─────────
  // Lets a driver with an empty wallet reach Stripe Connect setup. The server
  // never gated onboarding on a balance; only this expression did.
  const showPayoutSection = true;
  // const showPayoutSection =
  //   pendingEarningsCents > 0 ||
  //   payouts.availableCents > 0 ||
  //   connect.status !== "none";
  // ── END TEST-ONLY ─────────────────────────────────────────────────────────

  // Opens a Stripe-hosted flow in an auth session and reconciles on return.
  // Same shape for both onboarding and the Express dashboard, so they share this.
  const openStripeFlow = async (
    label: "onboard" | "dashboard",
    fetchUrl: (
      token: string,
      returnUrl: string,
    ) => Promise<
      | { ok: true; url?: string }
      | { ok: false; error: string; detail?: ConnectErrorDetail; message?: string }
    >,
    reconcile: boolean,
  ) => {
    if (!user || payoutFlowInFlight.current) return;
    payoutFlowInFlight.current = true;
    setPayoutBusy(true);

    // Every failure below funnels through here, so the driver always leaves with
    // a code they can read out. On a production build nothing else survives:
    // devWarn is a no-op, and Cloud Logging is not something a tester can open.
    const fail = (code: string, detail?: ConnectErrorDetail) => {
      const trace = [label, code, detail?.step, detail?.requestId].filter(Boolean).join("/");
      Alert.alert(
        t("wallet.payouts.errorTitle"),
        `${t(PAYOUT_ERROR_COPY[code] ?? "wallet.payouts.errorBody")}\n\n` +
          t("wallet.payouts.errorCode", { code: trace }),
      );
    };

    try {
      // The link is single-use and short-lived, so it is minted on every tap
      // rather than cached.
      const returnUrl = Linking.createURL("/wallet");
      const res = await fetchUrl(await user.getIdToken(), returnUrl);
      if (!res.ok) {
        devWarn("[PAYOUT]", label, "failed:", res.error, res.detail, res.message);
        fail(res.error, res.detail);
        return;
      }
      // A 200 with an empty body yields ok:true and no url, which would hand
      // `undefined` to the browser. certificationScreen guards the same way.
      if (!res.url) {
        devWarn("[PAYOUT]", label, "returned no url");
        fail("no_url");
        return;
      }
      await WebBrowser.openAuthSessionAsync(res.url, returnUrl);
      // Reconcile regardless of the browser result: a driver can complete the
      // form and then dismiss the sheet rather than following the redirect, which
      // reports as "cancel" even though onboarding succeeded.
      if (reconcile) await refreshConnect();
    } catch (e) {
      // Bound, not bare: this arm catches getIdToken and the browser presentation
      // itself, and discarding the reason left them indistinguishable.
      devWarn("[PAYOUT]", label, "threw:", e);
      fail("exception");
    } finally {
      payoutFlowInFlight.current = false;
      setPayoutBusy(false);
    }
  };

  // Safeguard. The most common misunderstanding is "I can't use my earnings
  // until I set this up" — which is false: netting already pays for a driver's
  // own rides with no Connect account at all. Saying so before the KYC flow
  // stops a passenger who never drives from wandering into identity checks they
  // do not need. Only shown when setup hasn't started; resuming skips it.
  const handlePayoutSetup = () => {
    const go = () =>
      openStripeFlow("onboard", (token, returnUrl) => startConnectOnboarding(token, returnUrl), true);
    if (connect.status !== "none") return go();
    Alert.alert(
      t("wallet.payouts.confirmTitle"),
      t("wallet.payouts.confirmBody"),
      [
        { text: t("wallet.payouts.confirmCancel"), style: "cancel" },
        { text: t("wallet.payouts.confirmContinue"), onPress: go },
      ],
    );
  };

  // Mirrors handleRemoveCard for the payout side. The dialog leads with what
  // does NOT change — the balance stays and keeps paying for their rides —
  // because the fear this action triggers is "will I lose my money?".
  // ── TEST-ONLY — DELETE THIS HANDLER BEFORE LAUNCH ─────────────────────────
  const handleTestCashout = async () => {
    if (!user || payoutBusy) return;
    setPayoutBusy(true);
    try {
      const res = await requestTestCashout(await user.getIdToken());
      if (res.ok) {
        Alert.alert(
          "Test payout queued",
          `${formatCentsAsDollars(res.amountCents)} is queued. Run the payout sweeper to send it.`,
        );
      } else {
        Alert.alert("Test payout failed", res.error);
      }
    } catch {
      Alert.alert("Test payout failed", t("wallet.somethingWrong"));
    } finally {
      setPayoutBusy(false);
      await Promise.all([refreshPayouts(), reload()]);
    }
  };
  // ── END TEST-ONLY ─────────────────────────────────────────────────────────

  const handlePayoutDisconnect = () => {
    if (!user) return;
    Alert.alert(
      t("wallet.payouts.disconnectTitle"),
      t("wallet.payouts.disconnectBody", {
        amount: formatCentsAsDollars(payouts.availableCents),
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("wallet.payouts.disconnectConfirm"),
          style: "destructive",
          onPress: async () => {
            setPayoutBusy(true);
            try {
              const res = await disconnectConnectAccount(await user.getIdToken());
              if (res.ok) {
                Alert.alert(t("wallet.payouts.disconnectTitle"), t("wallet.payouts.disconnectDone"));
              } else {
                // Each refusal has a different remedy, and "try again" is wrong
                // advice for two of the three.
                const map: Record<string, string> = {
                  cashout_pending:  t("wallet.payouts.errCashoutPending"),
                  balance_not_zero: t("wallet.payouts.errBalanceNotZero"),
                  stripe_refused:   t("wallet.payouts.errStripeRefused"),
                };
                Alert.alert(t("wallet.unexpectedError"), map[res.error] ?? t("wallet.somethingWrong"));
              }
            } catch {
              Alert.alert(t("wallet.unexpectedError"), t("wallet.somethingWrong"));
            } finally {
              setPayoutBusy(false);
              await Promise.all([refreshConnect(), refreshPayouts(), reload()]);
            }
          },
        },
      ],
    );
  };

  const handlePayoutManage = () =>
    openStripeFlow("dashboard", (token) => openConnectDashboard(token), true);

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
      // The tab bar floats above the content rather than taking layout space, so
      // the scroll view has to reserve room for it or the last transaction sits
      // behind it, unreadable and untappable.
      contentContainerStyle={{ paddingBottom: tabBarClearance(insets.bottom) }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.purpleLight} />
      }
    >
      {/* ── Balance Hero Card ─────────────────────────────────────────────── */}
      <LinearGradient
        colors={BALANCE_GRADIENT}
        style={[styles.balanceCard, { borderColor: balanceBorder }]}
      >
        <View style={styles.balanceHeader}>
          <View style={styles.balanceLabelRow}>
            <View style={styles.balanceIconWrap}>
              <Ionicons name="wallet-outline" size={16} color={C.purpleLight} />
            </View>
            <Text style={styles.balanceLabel}>{t("wallet.yourBalance")}</Text>
          </View>
          <InfoButton
            title={t("wallet.info.balance.title")}
            body={t("wallet.info.balance.body")}
          />
        </View>

        <Text style={[styles.balanceAmount, { color: balanceColor }]}>
          {formatSignedCents(netBalanceCents)}
        </Text>

        {/* Both rows always render — seeing the two sides side by side is what
            explains a net figure that matches neither of them. */}
        <View style={styles.breakdown}>
          <BreakdownRow
            iconName="trending-up-outline"
            color={C.success}
            label={t("wallet.earningsRow")}
            amount={pendingEarningsCents}
          />
          <BreakdownRow
            iconName="trending-down-outline"
            color={C.danger}
            label={t("wallet.chargesRow")}
            amount={-pendingChargeCents}
          />
          {/* Settled money, deliberately shown apart from the two rows above.
              Those are this cycle's accrual and are not collectable yet; this is
              cash that exists and can be withdrawn today. Collapsing them into
              one figure is what makes "why can't I cash out my $40?" happen. */}
          {payouts.availableCents > 0 && (
            <View style={styles.availableRow}>
              <BreakdownRow
                iconName="wallet-outline"
                color={C.purpleLight}
                label={t("wallet.payouts.available")}
                amount={payouts.availableCents}
              />
            </View>
          )}
        </View>

        <View style={styles.balanceFooter}>
          <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.4)" />
          <Text style={styles.balanceSubtitle}>{t("wallet.settledOnFirst")}</Text>
        </View>
        <View style={styles.balanceTip}>
          <Ionicons name="bulb-outline" size={13} color={C.purpleLight} />
          <Text style={styles.balanceTipText}>{tipText}</Text>
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
                <View style={styles.addCardIconGrad}>
                  <Ionicons name="add" size={16} color="#2d0015" />
                </View>
              )}
              <Text style={styles.addCardBtnText}>{t("wallet.addCard")}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={cardWizard.replay} style={styles.howItWorksBtn} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="help-circle-outline" size={15} color={C.muted} />
              <Text style={styles.howItWorksText}>{t("wizard.replay")}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Transactions ─────────────────────────────────────────────────── */}
        {/* ── Payouts (drivers) ─────────────────────────────────────────────── */}
        {/* Drivers only — see showPayoutSection. */}
        {showPayoutSection && (
          <>
            <View style={styles.sectionRow}>
              <SectionHeader iconName="cash-outline" title={t("wallet.payouts.section")} />
              <InfoButton
                title={t("wallet.info.payouts.title")}
                body={t("wallet.info.payouts.body")}
              />
            </View>
            <PayoutSetupCard
              status={connect.status}
              bankLast4={connect.bankLast4}
              requirementsDue={connect.requirementsDue}
              busy={payoutBusy}
              payouts={payouts}
              onTestCashout={handleTestCashout}
              onSetup={handlePayoutSetup}
              onManage={handlePayoutManage}
              onDisconnect={handlePayoutDisconnect}
              t={t}
            />
          </>
        )}

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
            // Money arriving for this user, from their point of view. A row
            // whose type is missing from either map renders blank and red, so
            // both are exhaustive over WalletTransaction["type"] — TypeScript
            // fails the build if a new server-side type is not added here.
            const CREDIT_TYPES: ReadonlySet<typeof tx.type> = new Set([
              "ride_earning", "monthly_payout", "cashout", "earnings_available", "refund",
            ]);
            const isCredit = CREDIT_TYPES.has(tx.type);
            const txTypeNames: Record<typeof tx.type, string> = {
              ride_charge:        t("wallet.txRideCharge"),
              ride_earning:       t("wallet.txRideEarning"),
              monthly_charge:     t("wallet.txMonthlyCharge"),
              monthly_payout:     t("wallet.txMonthlyPayout"),
              cashout:            t("wallet.txCashout"),
              earnings_available: t("wallet.txEarningsAvailable"),
              refund:             t("wallet.txRefund"),
              clawback:           t("wallet.txClawback"),
              dispute:            t("wallet.txDispute"),
              payout_fee:         t("wallet.txPayoutFee"),
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
                  {/* A monthly charge is fare + Stripe's processing fee. Showing
                      the split keeps "why is this more than my rides?" answered
                      in place — UniLift itself takes nothing. */}
                  {tx.processingFeeCents != null && tx.subtotalCents != null ? (
                    <Text style={styles.txDate}>
                      {t("wallet.txFeeBreakdown", {
                        rides: formatCentsAsDollars(tx.subtotalCents),
                        fee: formatCentsAsDollars(tx.processingFeeCents),
                      })}
                    </Text>
                  ) : null}
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
                        // Distinct from "pending" on purpose: pending means we
                        // are paying it, awaiting_setup means the driver still
                        // has to finish payout setup before we can.
                        : tx.status === "awaiting_setup"
                        ? t("wallet.statusAwaitingSetup")
                        : tx.status === "cancelled"
                        ? t("wallet.statusCancelled")
                        : tx.status === "outstanding"
                        ? t("wallet.statusOutstanding")
                        : tx.status === "open"
                        ? t("wallet.statusOpen")
                        : t("wallet.statusPending")
                    }
                  />
                </View>
              </View>
            );
          })
        )}

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
  balanceAmount:    { fontSize: 44, fontWeight: "800", letterSpacing: -1 },
  breakdown:        { gap: 9, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  balanceFooter:    { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 16 },
  balanceSubtitle:  { color: "rgba(255,255,255,0.4)", fontSize: 12, flex: 1 },
  balanceTip:       { flexDirection: "row", gap: 6, marginTop: 10, backgroundColor: "rgba(224,154,247,0.07)", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: "rgba(224,154,247,0.14)" },
  balanceTipText:   { flex: 1, color: "rgba(255,255,255,0.62)", fontSize: 12, lineHeight: 17 },

  // Payment method
  pmRow:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(137,56,213,0.06)", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  pmIconWrap: { width: 42, height: 42, borderRadius: 12, backgroundColor: "rgba(137,56,213,0.12)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  pmBrand:    { color: C.text, fontSize: 14, fontWeight: "700" },
  pmLabel:    { color: C.muted, fontSize: 11, marginTop: 2 },
  removeBtn:  { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(248,113,113,0.1)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(248,113,113,0.2)" },

  addCardBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "rgba(137,56,213,0.06)", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  addCardIconGrad:    { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: C.purpleLight },
  addCardBtnText:     { color: C.purpleLight, fontSize: 14, fontWeight: "600" },
  howItWorksBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10, marginTop: 2 },
  howItWorksText:     { color: C.muted, fontSize: 12.5, fontWeight: "600" },

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
  availableRow: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", paddingTop: 8, marginTop: 2 },

  // Empty state
  emptyState:    { alignItems: "center", paddingVertical: 32, backgroundColor: "rgba(137,56,213,0.04)", borderRadius: 16, borderWidth: 1, borderColor: C.borderFaint, gap: 6 },
  emptyIconWrap: { width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(137,56,213,0.10)", alignItems: "center", justifyContent: "center", marginBottom: 4, borderWidth: 1, borderColor: C.border },
  emptyTitle:    { color: C.text, fontSize: 14, fontWeight: "600" },
  emptySubtext:  { color: C.dim, fontSize: 12 },
});
