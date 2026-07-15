import ProfileCompletionMeter from "@/components/profile-completion-meter";
import { useLanguage } from "@/context/LanguageContext";
import type { ProfileCompletion } from "@/utils/profile-completion";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

const C = {
  surface:     "#0f0f1e",
  border:      "rgba(137, 56, 213, 0.30)",
  gold:        "#fbbf24",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
};

const BTN_GRADIENT = ["#FD165A", "#8938D5"] as const;

type Props = {
  visible: boolean;
  completion: ProfileCompletion;
  /** "Complete now" — send the user to fix their profile; the ride is dropped. */
  onCompleteNow: () => void;
  /** "Later" — dismiss and let the pending ride request go through. */
  onLater: () => void;
};

/**
 * Soft, dismissible nudge shown once per session when an incomplete-profile
 * passenger requests a ride. Encourages without blocking: "Later" always
 * proceeds with the ride.
 */
export default function ProfileCompletionSheet({ visible, completion, onCompleteNow, onLater }: Props) {
  const { t } = useLanguage();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onLater} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.blur}>
            <LinearGradient colors={BTN_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconCircle}>
              <Ionicons name="person-circle-outline" size={30} color="#fff" />
            </LinearGradient>

            <Text style={styles.title}>{t("profileCompletion.sheetTitle")}</Text>

            <View style={styles.headlinePill}>
              <Ionicons name="trending-up" size={14} color={C.gold} />
              <Text style={styles.headline}>{t("profileCompletion.sheetHighlight")}</Text>
            </View>

            <Text style={styles.body}>{t("profileCompletion.sheetBody")}</Text>

            {/* Read-only checklist — fixing happens on the profile screen. */}
            <View style={styles.meterWrap}>
              <ProfileCompletionMeter completion={completion} />
            </View>

            <Pressable onPress={onCompleteNow} style={{ width: "100%" }}>
              <LinearGradient colors={BTN_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                <Text style={styles.primaryText}>{t("profileCompletion.completeNow")}</Text>
              </LinearGradient>
            </Pressable>

            <Pressable onPress={onLater} hitSlop={8} style={styles.laterBtn}>
              <Text style={styles.laterText}>{t("profileCompletion.later")}</Text>
            </Pressable>
          </BlurView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%", maxWidth: 380, borderRadius: 26, overflow: "hidden",
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  blur: { padding: 24, alignItems: "center" },
  iconCircle: {
    width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 16,
    shadowColor: "#8938D5", shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  title: { color: C.text, fontSize: 21, fontWeight: "800", textAlign: "center", marginBottom: 12 },
  headlinePill: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center",
    backgroundColor: "rgba(251,191,36,0.12)", borderWidth: 1, borderColor: "rgba(251,191,36,0.35)",
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 14,
  },
  headline: { color: C.gold, fontSize: 13.5, fontWeight: "800", flexShrink: 1, textAlign: "center" },
  body: { color: C.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 18 },
  meterWrap: { alignSelf: "stretch", marginBottom: 22 },
  primaryBtn: { height: 52, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  laterBtn: { paddingVertical: 14, marginTop: 4 },
  laterText: { color: C.muted, fontSize: 14, fontWeight: "600" },
});
