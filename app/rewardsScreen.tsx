import RewardCard from "@/components/reward-card";
import { getRewardGroups, xpToLevel, type Reward } from "@/constants/rewards";
import { isDev } from "@/constants/runtime-config";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  border:      "rgba(137, 56, 213, 0.22)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  gold:        "#fbbf24",
};

export default function RewardsScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const { userData } = useUserProfile();
  const insets = useSafeAreaInsets();

  const xp = userData?.xp ?? 0;
  const level = xpToLevel(xp);
  const groups = getRewardGroups(t("rewards.uniliftRewards"));

  const handleRedeem = (reward: Reward) => {
    Alert.alert(t("rewards.redeemedTitle"), t("rewards.redeemedBody", { title: reward.title }));
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <LinearGradient colors={["#FD165A", "#8938D5"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.backBtnGrad}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("rewards.title")}</Text>
        <View style={{ width: 38 }} />
      </View>

      {isDev ? (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {/* Your level summary */}
          <LinearGradient
            colors={["#1c0038", "#08001a"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.levelCard}
          >
            <View style={styles.levelTrophy}>
              <Ionicons name="trophy" size={22} color={C.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.levelLabel}>{t("rewards.yourLevel")}</Text>
              <Text style={styles.levelValue}>{t("profile.levelShort", { level })}</Text>
            </View>
            <View style={styles.xpBadge}>
              <Ionicons name="flash" size={12} color={C.gold} />
              <Text style={styles.xpBadgeText}>{xp} XP</Text>
            </View>
          </LinearGradient>

          {/* Reward groups by sponsor */}
          {groups.map((group) => (
            <View key={group.key} style={styles.group}>
              <View style={styles.groupHeader}>
                {group.logoUrl ? (
                  <Image source={{ uri: group.logoUrl }} style={styles.groupLogo} />
                ) : (
                  <View style={styles.groupDot} />
                )}
                <Text style={styles.groupTitle}>{group.label}</Text>
              </View>
              <View style={styles.groupRewards}>
                {group.rewards.map((reward) => (
                  <RewardCard key={reward.id} reward={reward} xp={xp} onRedeem={handleRedeem} />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        /* Coming soon content (production) */
        <View style={styles.center}>
          <LinearGradient
            colors={["#1c0038", "#08001a"]}
            style={styles.card}
          >
            <View style={styles.iconWrap}>
              <Text style={{ fontSize: 48 }}>🏆</Text>
            </View>
            <Text style={styles.comingSoonLabel}>{t("rewards.comingSoon")}</Text>
            <Text style={styles.title}>{t("rewards.title")}</Text>
            <Text style={styles.subtitle}>{t("rewards.comingSoonSub")}</Text>

            <View style={styles.featureList}>
              {[
                { icon: "⚡", label: t("rewards.featureXp") },
                { icon: "🎁", label: t("rewards.featureDiscounts") },
                { icon: "🏅", label: t("rewards.featureBadges") },
                { icon: "📊", label: t("rewards.featureLeaderboard") },
              ].map((f) => (
                <View key={f.label} style={styles.featureRow}>
                  <Text style={{ fontSize: 16 }}>{f.icon}</Text>
                  <Text style={styles.featureText}>{f.label}</Text>
                </View>
              ))}
            </View>
          </LinearGradient>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    borderRadius: 10,
    overflow: "hidden",
  },
  backBtnGrad: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: "700",
  },

  // ── Dev list ──────────────────────────────────────────────────────────────
  listContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 20,
  },
  levelCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  levelTrophy: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: "rgba(251,191,36,0.14)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.35)",
  },
  levelLabel: {
    color: C.purpleLight,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  levelValue: {
    color: C.text,
    fontSize: 20,
    fontWeight: "900",
  },
  xpBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(251,191,36,0.14)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.35)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  xpBadgeText: { color: C.gold, fontSize: 13, fontWeight: "800" },

  group: { gap: 12 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  groupLogo: { width: 26, height: 26, borderRadius: 7, backgroundColor: "rgba(255,255,255,0.06)" },
  groupDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.purple, marginHorizontal: 8 },
  groupTitle: { color: C.text, fontSize: 17, fontWeight: "800" },
  groupRewards: { gap: 10 },

  // ── Coming soon (prod) ──────────────────────────────────────────────────────
  center: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    gap: 12,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "rgba(137,56,213,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 4,
  },
  comingSoonLabel: {
    color: C.purpleLight,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  title: {
    color: C.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: C.muted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  featureList: {
    marginTop: 8,
    width: "100%",
    gap: 10,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  featureText: {
    color: C.text,
    fontSize: 14,
    fontWeight: "600",
  },
});
