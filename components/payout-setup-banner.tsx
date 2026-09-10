// Nudge shown to a driver who has earnings but no working payout account.
//
// The wallet's Payouts card is where setup actually happens; this exists because
// a driver deciding to go online is the moment the message lands.
//
// The copy deliberately does NOT say the money is waiting or blocked. Earnings
// already pay for that driver's own rides through monthly netting, with no
// Connect account at all — implying otherwise pushes people into a KYC flow they
// may not need. Connect is only for moving money out to a bank.
//
// Renders nothing unless there is genuinely something to say, so it can be
// dropped into any driver screen without becoming noise.
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { P } from "@/constants/palette";
import { formatCentsAsDollars } from "@/constants/pricing";
import { useLanguage } from "@/context/LanguageContext";
import { useWallet } from "@/context/WalletContext";

export default function PayoutSetupBanner() {
  const { t } = useLanguage();
  const router = useRouter();
  const { pendingEarningsCents, connect } = useWallet();

  // Only when there is money to collect AND no working payout account. A driver
  // who is already set up, or who has not earned yet, sees nothing.
  if (pendingEarningsCents <= 0 || connect.status === "ready") return null;

  return (
    <TouchableOpacity
      style={s.wrap}
      onPress={() => router.push("/(tabs)/wallet")}
      activeOpacity={0.8}
    >
      <View style={s.iconWrap}>
        <Ionicons name="cash-outline" size={18} color={P.warning} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>
          {t("wallet.payouts.bannerTitle", {
            amount: formatCentsAsDollars(pendingEarningsCents),
          })}
        </Text>
        <Text style={s.sub}>{t("wallet.payouts.bannerSub")}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={P.textMuted} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  wrap:     { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(251,191,36,0.08)", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "rgba(251,191,36,0.28)", marginBottom: 14 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(251,191,36,0.14)" },
  title:    { color: P.text, fontSize: 13, fontWeight: "700" },
  sub:      { color: P.textMuted, fontSize: 11, marginTop: 2 },
});
