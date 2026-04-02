import { REWARDS, type Reward } from "@/constants/rewards";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
    bg:          "#080810",
  surface:     "#0f0f1e",
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  gold:        "#fbbf24",
  goldFaint:   "rgba(251,191,36,0.12)",
  goldBorder:  "rgba(251,191,36,0.3)",
  success:     "#34d399",
};

const CARD_GRADIENT    = ["#1c0b2a", "#0d0518"] as const;
const XP_BAR_GRADIENT  = ["#FD165A", "#8938D5"] as const;
const REDEEM_GRADIENT  = ["#4b5563", "#374151"] as const;

// ─── Category colours ─────────────────────────────────────────────────────────
const CATEGORY_COLOR: Record<string, string> = {
  food:          "#f97316",
  gas:           "#34d399",
  entertainment: "#a78bfa",
  transport:     "#60a5fa",
};

export default function RewardsScreen() {
  const router   = useRouter();
  const { t, language } = useLanguage();
  const { userData } = useUserProfile();

  const xp       = userData?.xp ?? 0;
  const level    = Math.floor(xp / 100) + 1;
  const levelXp  = xp % 100;
  const progress = Math.min((levelXp / 100) * 100, 100);

  const renderReward = (reward: Reward) => {
    const isUnlocked = level >= reward.level;
    const title      = language === "fr" ? reward.titleFr       : reward.title;
    const desc       = language === "fr" ? reward.descriptionFr : reward.description;
    const catColor   = CATEGORY_COLOR[reward.category] ?? C.purpleLight;

    return (
      <View
        key={reward.id}
        style={[styles.rewardCard, !isUnlocked && styles.rewardCardLocked]}
      >
        {/* Top row: level badge + value */}
        <View style={styles.rewardTop}>
          <View style={[
            styles.levelBadge,
            isUnlocked ? styles.levelBadgeUnlocked : styles.levelBadgeLocked,
          ]}>
            <Text style={{ fontSize: 10 }}>{isUnlocked ? "🔓" : "🔒"}</Text>
            <Text style={[
              styles.levelBadgeText,
              { color: isUnlocked ? C.gold : C.dim },
            ]}>
              {t("rewards.levelRequired", { level: reward.level })}
            </Text>
          </View>

          <View style={[styles.valueBadge, { borderColor: isUnlocked ? catColor + "55" : C.borderFaint, backgroundColor: isUnlocked ? catColor + "18" : "rgba(255,255,255,0.03)" }]}>
            <Text style={[styles.valueText, { color: isUnlocked ? catColor : C.dim }]}>
              {reward.value}
            </Text>
          </View>
        </View>

        {/* Logo / icon + title + description */}
        <View style={styles.rewardBody}>
          <View style={[
            styles.rewardLogoWrap,
            { borderColor: isUnlocked ? catColor + "40" : C.borderFaint },
          ]}>
            {reward.logoUrl ? (
              <Image
                source={{ uri: reward.logoUrl }}
                style={[styles.rewardLogo, !isUnlocked && styles.iconLocked]}
                resizeMode="contain"
              />
            ) : (
              <Text style={[styles.rewardIcon, !isUnlocked && styles.iconLocked]}>
                {reward.icon}
              </Text>
            )}
            {/* Category emoji badge in corner */}
            {reward.logoUrl && (
              <View style={[styles.emojiBadge, { backgroundColor: isUnlocked ? catColor + "22" : "rgba(255,255,255,0.06)" }]}>
                <Text style={{ fontSize: 10 }}>{reward.icon}</Text>
              </View>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rewardTitle, !isUnlocked && styles.textLocked]}>
              {title}
            </Text>
            <Text style={[styles.rewardDesc, !isUnlocked && styles.textLocked]}>
              {desc}
            </Text>
          </View>
        </View>

        {/* Redeem button (always disabled) */}
        <Pressable style={styles.redeemBtn} disabled>
          <LinearGradient
            colors={isUnlocked ? ["#8938D5", "#FD165A"] : REDEEM_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.redeemGrad, !isUnlocked && styles.redeemGradLocked]}
          >
            <Text style={styles.redeemText}>
              {t("rewards.redeemBtn")}
            </Text>
            <View style={styles.comingSoonPill}>
              <Text style={styles.comingSoonText}>{t("rewards.comingSoon")}</Text>
            </View>
          </LinearGradient>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("rewards.title")}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Your Level Card ───────────────────────────────────────────────── */}
        <LinearGradient colors={CARD_GRADIENT} style={styles.levelCard}>
          <View style={styles.levelCardTop}>
            <View>
              <Text style={styles.yourLevelLabel}>{t("rewards.yourLevel")}</Text>
              <Text style={styles.yourLevelValue}>Level {level}</Text>
            </View>
            <View style={styles.xpBadge}>
              <Text style={{ fontSize: 12 }}>🏆</Text>
              <Text style={styles.xpBadgeText}>{xp} XP</Text>
            </View>
          </View>
          <View style={styles.xpTrack}>
            <LinearGradient
              colors={XP_BAR_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.xpFill, { width: `${progress}%` }]}
            />
          </View>
          <View style={styles.xpFooter}>
            <Text style={styles.xpFooterText}>Lvl {level}</Text>
            <Text style={styles.xpFooterText}>{levelXp}/100 XP</Text>
            <Text style={styles.xpFooterText}>Lvl {level + 1}</Text>
          </View>
        </LinearGradient>

        {/* ── Unlock legend ─────────────────────────────────────────────────── */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: C.gold }]} />
            <Text style={styles.legendText}>{t("rewards.unlocked")}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: C.dim }]} />
            <Text style={styles.legendText}>{t("rewards.locked")}</Text>
          </View>
        </View>

        {/* ── Reward Cards ──────────────────────────────────────────────────── */}
        {REWARDS.map(renderReward)}

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
    paddingHorizontal: 16,
    paddingTop:        Platform.OS === "ios" ? 56 : 20,
    paddingBottom:     14,
    backgroundColor:   C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: "rgba(137,56,213,0.2)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.border,
  },
  backArrow: { color: C.purpleLight, fontSize: 26, lineHeight: 30, fontWeight: "300" },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: "700" },
  headerSpacer: { width: 38 },

  // ── Content ────────────────────────────────────────────────────────────────
  content: { paddingHorizontal: 16, paddingTop: 20, gap: 12 },

  // ── Level card ─────────────────────────────────────────────────────────────
  levelCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 4,
  },
  levelCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  yourLevelLabel: { color: C.muted, fontSize: 12, fontWeight: "500", marginBottom: 3 },
  yourLevelValue: { color: C.text, fontSize: 22, fontWeight: "800" },
  xpBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(251,191,36,0.1)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(251,191,36,0.22)",
  },
  xpBadgeText: { color: C.gold, fontWeight: "700", fontSize: 13 },
  xpTrack: {
    height: 7, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 4, overflow: "hidden",
  },
  xpFill:   { height: "100%", borderRadius: 4 },
  xpFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 7 },
  xpFooterText: { color: C.dim, fontSize: 10 },

  // ── Legend ─────────────────────────────────────────────────────────────────
  legend: {
    flexDirection: "row", gap: 16, paddingHorizontal: 4, marginBottom: 4,
  },
  legendItem:  { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot:   { width: 8, height: 8, borderRadius: 4 },
  legendText:  { color: C.muted, fontSize: 12 },

  // ── Reward Card ────────────────────────────────────────────────────────────
  rewardCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.goldBorder,
    padding: 16,
    gap: 12,
  },
  rewardCardLocked: {
    opacity: 0.5,
    borderColor: C.borderFaint,
  },

  // Top row
  rewardTop: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  levelBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1,
  },
  levelBadgeUnlocked: {
    backgroundColor: C.goldFaint, borderColor: C.goldBorder,
  },
  levelBadgeLocked: {
    backgroundColor: "rgba(255,255,255,0.04)", borderColor: C.borderFaint,
  },
  levelBadgeText: { fontSize: 11, fontWeight: "700" },

  valueBadge: {
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1,
  },
  valueText: { fontSize: 13, fontWeight: "800" },

  // Body
  rewardBody: { flexDirection: "row", alignItems: "center", gap: 12 },
  rewardLogoWrap: {
    width: 60, height: 60, borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
    position: "relative",
    overflow: "visible",
  },
  rewardLogo:  { width: 44, height: 44, borderRadius: 8 },
  rewardIcon:  { fontSize: 26 },
  iconLocked:  { opacity: 0.4 },
  emojiBadge: {
    position: "absolute",
    bottom: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#080810",
  },
  rewardTitle: { color: C.text, fontSize: 15, fontWeight: "700", marginBottom: 3 },
  rewardDesc:  { color: C.muted, fontSize: 12, lineHeight: 17 },
  textLocked:  { color: C.dim },

  // Redeem button
  redeemBtn: { borderRadius: 12, overflow: "hidden" },
  redeemGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    gap: 8,
  },
  redeemGradLocked: { opacity: 0.5 },
  redeemText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  comingSoonPill: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  comingSoonText: { color: "rgba(255,255,255,0.8)", fontSize: 10, fontWeight: "600" },
});
