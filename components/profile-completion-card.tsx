import ProfileCompletionMeter from "@/components/profile-completion-meter";
import { useLanguage } from "@/context/LanguageContext";
import { useProfileCompletion } from "@/hooks/use-profile-completion";
import { type ProfileTaskKey } from "@/utils/profile-completion";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

const C = {
  border:      "rgba(137, 56, 213, 0.30)",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  success:     "#34d399",
};

const CARD_GRADIENT = ["#1c0b2a", "#0d0518"] as const;

type Props = {
  /** Opens the image picker (owned by the profile screen's useProfileAvatar). */
  onPickAvatar: () => void;
};

/**
 * "Complete your profile" card for the profile screen.
 *
 * Once every task is done it stays visible but switches to a compact success
 * state — confirming the profile is trusted rather than silently vanishing.
 *
 * Each task routes to the surface that actually owns it: the avatar is
 * uploaded in place via the image picker, name/school live on profileSettings,
 * verification on the certification screen, the home address in settings, and
 * the payment card in the wallet tab.
 */
export default function ProfileCompletionCard({ onPickAvatar }: Props) {
  const { t } = useLanguage();
  const router = useRouter();
  const { completion, userData, ready } = useProfileCompletion();

  // Hide until the profile AND wallet have loaded — otherwise the wallet's
  // in-flight `hasPaymentMethod: false` would under-count the score.
  if (!ready || !userData) return null;

  // Complete: compact success row, no checklist.
  if (completion.isComplete) {
    return (
      <LinearGradient colors={CARD_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardDone}>
        <View style={styles.doneIconWrap}>
          <Ionicons name="checkmark-circle" size={18} color={C.success} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("profileCompletion.completeTitle")}</Text>
          <Text style={styles.subtitle}>{t("profileCompletion.completeSubtitle")}</Text>
        </View>
        <Text style={styles.donePct}>
          {t("profileCompletion.progressLabel", {
            completed: completion.completed,
            total: completion.total,
          })}
        </Text>
      </LinearGradient>
    );
  }

  const openProfileSettings = () => {
    const qs =
      `name=${encodeURIComponent(userData.name ?? "")}` +
      `&birthDate=${encodeURIComponent(userData.birthDate ?? "")}` +
      `&school=${encodeURIComponent(userData.school ?? "")}`;
    router.push(`/profileSettings?${qs}`);
  };

  const handleTaskPress = (key: ProfileTaskKey) => {
    switch (key) {
      case "avatar":       onPickAvatar(); break;
      case "name":
      case "school":       openProfileSettings(); break;
      case "verification": router.push("/certificationScreen"); break;
      // The home address field lives in the settings screen.
      case "homeAddress":  router.push("/settingsScreen"); break;
      case "payment":      router.push("/(tabs)/wallet"); break;
    }
  };

  return (
    <LinearGradient colors={CARD_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles" size={15} color={C.purpleLight} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("profileCompletion.cardTitle")}</Text>
          <Text style={styles.subtitle}>{t("profileCompletion.cardSubtitle")}</Text>
        </View>
      </View>

      <ProfileCompletionMeter completion={completion} onTaskPress={handleTaskPress} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18, padding: 16, marginTop: 16, gap: 14,
    borderWidth: 1, borderColor: C.border,
  },
  header:   { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  iconWrap: {
    width: 28, height: 28, borderRadius: 8, marginTop: 1,
    backgroundColor: "rgba(224,154,247,0.10)",
    borderWidth: 1, borderColor: "rgba(224,154,247,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  title:    { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
  subtitle: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },

  // ── Complete (success) state ──────────────────────────────────────────────
  cardDone: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 18, padding: 14, marginTop: 16,
    borderWidth: 1, borderColor: "rgba(52,211,153,0.25)",
  },
  doneIconWrap: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: "rgba(52,211,153,0.10)",
    borderWidth: 1, borderColor: "rgba(52,211,153,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  donePct: { color: C.success, fontSize: 12, fontWeight: "800" },
});
