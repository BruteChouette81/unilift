import { rewardProgress, type Reward } from "@/constants/rewards";
import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const C = {
  purple: "#8938D5",
  purpleLight: "#e09af7",
  gold: "#fbbf24",
  text: "#f3f4f6",
  muted: "#cbd5e1",
  dim: "#9ca3af",
  success: "#34d399",
  border: "rgba(255,255,255,0.09)",
};

const XP_BAR_GRADIENT = ["#7C3AED", "#2563eb"] as const;

/** A single reward, shared by the sponsor modal (compact) and the Rewards
 *  screen (full). Locked rewards show a progress bar toward their unlock level;
 *  unlocked rewards show a Redeem button. */
export default function RewardCard({
  reward,
  xp,
  onRedeem,
  compact = false,
}: {
  reward: Reward;
  xp: number;
  onRedeem?: (reward: Reward) => void;
  compact?: boolean;
}) {
  const { t, language } = useLanguage();
  const isFr = language === "fr";
  const [logoFailed, setLogoFailed] = useState(false);

  const title = isFr ? reward.titleFr : reward.title;
  const description = isFr ? reward.descriptionFr : reward.description;
  const { unlocked, pct } = rewardProgress(reward, xp);
  const showLogo = !!reward.logoUrl && !logoFailed;

  return (
    <View style={[styles.card, !unlocked && styles.cardLocked, compact && styles.cardCompact]}>
      {/* Logo / emoji */}
      <View style={[styles.logoWrap, compact && styles.logoWrapCompact]}>
        {showLogo ? (
          <Image
            source={{ uri: reward.logoUrl }}
            style={compact ? styles.logoImgCompact : styles.logoImg}
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <Text style={{ fontSize: compact ? 20 : 26 }}>{reward.icon}</Text>
        )}
      </View>

      {/* Middle: title, value chip, status/progress */}
      <View style={styles.middle}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={1}>{title}</Text>
          <View style={styles.valueChip}>
            <Text style={styles.valueText}>{reward.value}</Text>
          </View>
        </View>

        {!compact && description ? (
          <Text style={styles.desc} numberOfLines={1}>{description}</Text>
        ) : null}

        {unlocked ? (
          <View style={styles.unlockedRow}>
            <Ionicons name="checkmark-circle" size={13} color={C.success} />
            <Text style={styles.unlockedText}>{t("rewards.unlocked")}</Text>
          </View>
        ) : (
          <View style={styles.lockedWrap}>
            <View style={styles.lockedTop}>
              <Ionicons name="lock-closed" size={11} color={C.dim} />
              <Text style={styles.lockedText}>{t("rewards.levelRequired", { level: reward.level })}</Text>
            </View>
            <View style={styles.track}>
              <LinearGradient
                colors={XP_BAR_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.fill, { width: `${pct}%` }]}
              />
            </View>
          </View>
        )}
      </View>

      {/* Redeem (unlocked only) */}
      {unlocked && onRedeem ? (
        <TouchableOpacity onPress={() => onRedeem(reward)} activeOpacity={0.85} style={styles.redeemBtn}>
          <Text style={styles.redeemText}>{t("rewards.redeemBtn")}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 12,
  },
  cardCompact: { padding: 10, borderRadius: 12 },
  cardLocked: { opacity: 0.75 },

  logoWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  logoWrapCompact: { width: 40, height: 40, borderRadius: 10 },
  logoImg: { width: 44, height: 44, borderRadius: 10 },
  logoImgCompact: { width: 36, height: 36, borderRadius: 8 },

  middle: { flex: 1, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: C.text, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  titleCompact: { fontSize: 14 },
  valueChip: {
    backgroundColor: "rgba(251,191,36,0.15)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.4)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  valueText: { color: C.gold, fontSize: 11, fontWeight: "900", letterSpacing: 0.3 },
  desc: { color: C.dim, fontSize: 12 },

  unlockedRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  unlockedText: { color: C.success, fontSize: 12, fontWeight: "700" },

  lockedWrap: { gap: 5, marginTop: 2 },
  lockedTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  lockedText: { color: C.dim, fontSize: 12, fontWeight: "600" },
  track: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.1)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 2 },

  redeemBtn: {
    backgroundColor: C.purple,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  redeemText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});
