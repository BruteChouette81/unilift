// Driver payout setup (Stripe Connect Express).
//
// Rendered in the wallet below the Payment Method section. The two are
// deliberately distinct: Payment Method is how this user PAYS for rides they
// take, this is how they GET PAID for rides they give. A saved card cannot be a
// payout destination, which is why a driver registers a Connect account at all —
// the copy below says so, because users otherwise assume one card does both.
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { formatCentsAsDollars } from "@/constants/pricing";
import { P } from "@/constants/palette";
import type { ConnectStatus, PayoutSummary } from "@/services/connectService";

const C = {
  border:      "rgba(137, 56, 213, 0.30)",
  purpleLight: P.accentLight,
  text:        P.text,
  muted:       P.textMuted,
  danger:      P.danger,
  success:     P.success,
  gold:        P.warning,
};

export type PayoutSetupCardProps = {
  status: ConnectStatus;
  bankLast4: string | null;
  /** Stripe's `requirements.currently_due`, already localised by the caller. */
  requirementsDue: string[];
  busy: boolean;
  /** Settled balance + server-decided payability. */
  payouts: PayoutSummary;
  /** TEST-ONLY — delete with the test payout surface. */
  onTestCashout: () => void;
  /** Start or resume hosted onboarding. */
  onSetup: () => void;
  /** Open the Express dashboard (change bank details, see payout history). */
  onManage: () => void;
  /** Remove the connected account entirely. */
  onDisconnect: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

/** "2026-09-05" → "September 5". Falls back to the raw string if the server
 *  sent something unexpected, so the line never renders as "Invalid Date". */
function formatPayoutDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export default function PayoutSetupCard({
  status,
  bankLast4,
  requirementsDue,
  busy,
  payouts,
  onTestCashout,
  onSetup,
  onManage,
  onDisconnect,
  t,
}: PayoutSetupCardProps) {
  if (status === "ready") {
    const pending = payouts.pendingRequest;
    const shortfall = payouts.minPayoutCents - payouts.availableCents;
    return (
      <View style={{ gap: 10 }}>
      <View style={s.readyRow}>
        <View style={s.iconWrap}>
          <Ionicons name="checkmark-circle-outline" size={20} color={C.success} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.readyTitle}>
            {bankLast4
              ? t("wallet.payouts.activeWithBank", { last4: bankLast4 })
              : t("wallet.payouts.active")}
          </Text>
          <Text style={s.subtle}>{t("wallet.payouts.activeSub")}</Text>
        </View>
        <TouchableOpacity onPress={onManage} disabled={busy} hitSlop={8} style={s.manageBtn}>
          {busy
            ? <ActivityIndicator size="small" color={C.purpleLight} />
            : <Text style={s.manageText}>{t("wallet.payouts.manage")}</Text>}
        </TouchableOpacity>
        {/* Same trash affordance as the saved card above, so "remove the thing
            I connected" looks identical on both halves of the wallet. */}
        <TouchableOpacity
          onPress={onDisconnect}
          disabled={busy}
          hitSlop={8}
          style={s.removeBtn}
          accessibilityLabel={t("wallet.payouts.disconnect")}
        >
          <Ionicons name="trash-outline" size={16} color={C.danger} />
        </TouchableOpacity>
      </View>

      {/* ── TEST-ONLY — DELETE THIS JSX BEFORE LAUNCH ────────────────────────
          Bypasses the $25 floor so the payout rail can be exercised by hand.
          `testCashoutEnabled` is decided server-side per-uid, so this renders
          for exactly one account and is invisible to everyone else. Strings are
          inline on purpose — no translation keys to clean up afterwards. */}
      {payouts.testCashoutEnabled && !pending ? (
        <TouchableOpacity
          style={[s.testCashoutBtn, busy && { opacity: 0.6 }]}
          onPress={onTestCashout}
          disabled={busy}
          activeOpacity={0.75}
        >
          {busy
            ? <ActivityIndicator size="small" color="#2b0a0a" />
            : <Ionicons name="flask-outline" size={16} color="#2b0a0a" />}
          <Text style={s.testCashoutText}>
            TEST: cash out {formatCentsAsDollars(Math.min(payouts.availableCents, 500))} now
          </Text>
        </TouchableOpacity>
      ) : null}
      {/* ── END TEST-ONLY ──────────────────────────────────────────────────── */}

      {/* Nothing to tap — payouts send themselves on the 5th, once the month's
          passenger charges have been collected. This is either "on its way",
          "arriving on the 5th", or the reason it is not coming yet. */}
      {pending ? (
        <View style={s.pendingRow}>
          <ActivityIndicator size="small" color={C.gold} />
          <View style={{ flex: 1 }}>
            <Text style={s.pendingTitle}>
              {t("wallet.payouts.sending", { amount: formatCentsAsDollars(pending.amountCents) })}
            </Text>
            <Text style={s.subtle}>{t("wallet.payouts.sendingSub")}</Text>
          </View>
        </View>
      ) : payouts.canCashout ? (
        <View style={s.pendingRow}>
          <Ionicons name="calendar-outline" size={17} color={C.gold} />
          <View style={{ flex: 1 }}>
            <Text style={s.pendingTitle}>
              {t("wallet.payouts.nextPayout", {
                amount: formatCentsAsDollars(payouts.netPayoutCents || payouts.availableCents),
                date: formatPayoutDate(payouts.nextPayoutDate),
              })}
            </Text>
            {/* The fee is stated before it happens, not discovered in the
                ledger afterwards. Drivers are credited the full fare on every
                ride, so the one deduction there is has to be visible here. */}
            {payouts.payoutFeeCents > 0 && (
              <Text style={s.subtle}>
                {t("wallet.payouts.feeBreakdown", {
                  earned: formatCentsAsDollars(payouts.availableCents),
                  fee: formatCentsAsDollars(payouts.payoutFeeCents),
                })}
              </Text>
            )}
            <Text style={s.subtle}>{t("wallet.payouts.nextPayoutSub")}</Text>
          </View>
        </View>
      ) : (
        // Say what is actually missing. A balance sitting there with no
        // explanation is the most support-generating state this screen can be in.
        <Text style={s.blockedHint}>
          {shortfall > 0
            ? t("wallet.payouts.needMore", {
                amount: formatCentsAsDollars(shortfall),
                min: formatCentsAsDollars(payouts.minPayoutCents),
              })
            : t("wallet.payouts.needSetup")}
        </Text>
      )}
      </View>
    );
  }

  const restricted = status === "restricted";
  const pending = status === "pending";
  const accent = restricted ? C.danger : pending ? C.gold : C.purpleLight;

  return (
    <View style={[s.wrap, { borderColor: restricted ? "rgba(248,113,113,0.35)" : C.border }]}>
      <View style={s.headerRow}>
        <View style={s.iconWrap}>
          <Ionicons
            name={restricted ? "warning-outline" : pending ? "time-outline" : "cash-outline"}
            size={18}
            color={accent}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>
            {restricted
              ? t("wallet.payouts.restrictedTitle")
              : pending
              ? t("wallet.payouts.pendingTitle")
              : t("wallet.payouts.noneTitle")}
          </Text>
          <Text style={s.subtle}>
            {restricted
              ? t("wallet.payouts.restrictedSub")
              : pending
              ? t("wallet.payouts.pendingSub")
              : t("wallet.payouts.noneSub")}
          </Text>
        </View>
      </View>

      {/* Naming what Stripe is actually waiting on beats a generic "incomplete" —
          without it a driver has no idea whether they are blocked or just waiting. */}
      {requirementsDue.length > 0 && (
        <View style={s.reqList}>
          {requirementsDue.slice(0, 4).map((req) => (
            <View key={req} style={s.reqRow}>
              <Ionicons name="ellipse" size={5} color={C.muted} />
              <Text style={s.reqText}>{req}</Text>
            </View>
          ))}
          {requirementsDue.length > 4 && (
            <Text style={s.reqMore}>
              {t("wallet.payouts.moreRequirements", { count: requirementsDue.length - 4 })}
            </Text>
          )}
        </View>
      )}

      <TouchableOpacity
        style={[s.cta, busy && { opacity: 0.6 }]}
        onPress={restricted ? onManage : onSetup}
        disabled={busy}
        activeOpacity={0.75}
      >
        {busy ? (
          <ActivityIndicator size="small" color={C.purpleLight} />
        ) : (
          <Ionicons name="open-outline" size={15} color={C.purpleLight} />
        )}
        <Text style={s.ctaText}>
          {restricted
            ? t("wallet.payouts.fixCta")
            : pending
            ? t("wallet.payouts.finishCta")
            : t("wallet.payouts.startCta")}
        </Text>
      </TouchableOpacity>

      {/* Only once an account actually exists. A restricted or half-finished
          account is precisely when a driver wants to scrap it and start again. */}
      {status !== "none" && (
        <TouchableOpacity onPress={onDisconnect} disabled={busy} hitSlop={8} style={s.disconnectLink}>
          <Text style={s.disconnectText}>{t("wallet.payouts.disconnect")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap:       { backgroundColor: "rgba(137,56,213,0.06)", borderRadius: 16, padding: 14, borderWidth: 1, gap: 12 },
  headerRow:  { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap:   { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(137,56,213,0.12)" },
  title:      { color: C.text, fontSize: 14, fontWeight: "600" },
  subtle:     { color: C.muted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  reqList:    { gap: 6, paddingLeft: 46 },
  reqRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  reqText:    { color: C.muted, fontSize: 12, flex: 1 },
  reqMore:    { color: C.muted, fontSize: 11, fontStyle: "italic", marginTop: 2 },
  cta:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(137,56,213,0.10)", borderRadius: 14, paddingVertical: 12, borderWidth: 1, borderColor: C.border },
  ctaText:    { color: C.purpleLight, fontSize: 14, fontWeight: "600" },
  readyRow:   { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(52,211,153,0.06)", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "rgba(52,211,153,0.25)" },
  readyTitle: { color: C.text, fontSize: 14, fontWeight: "600" },
  // TEST-ONLY — delete these two with the test payout surface.
  testCashoutBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.gold, borderRadius: 14, paddingVertical: 12 },
  testCashoutText: { color: "#2b0a0a", fontSize: 13, fontWeight: "800" },
  manageBtn:  { paddingHorizontal: 10, paddingVertical: 6 },
  manageText: { color: C.purpleLight, fontSize: 13, fontWeight: "600" },
  pendingRow:   { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(251,191,36,0.07)", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "rgba(251,191,36,0.25)" },
  pendingTitle: { color: C.text, fontSize: 13, fontWeight: "600" },
  blockedHint:  { color: C.muted, fontSize: 12, textAlign: "center", paddingVertical: 4 },
  removeBtn:      { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(248,113,113,0.1)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(248,113,113,0.2)" },
  disconnectLink: { alignSelf: "center", paddingVertical: 4 },
  disconnectText: { color: C.muted, fontSize: 12, textDecorationLine: "underline" },
});
