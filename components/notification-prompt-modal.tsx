import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import React from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

const C = {
  surface:     "#0f0f1e",
  border:      "rgba(137, 56, 213, 0.30)",
  purpleLight: "#e09af7",
  gold:        "#fbbf24",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
};

type Props = {
  visible: boolean;
  enabling: boolean;
  onEnable: () => void;
  onDismiss: () => void;
  /** When true, OS permission was already denied — button opens Settings instead. */
  permissionDenied?: boolean;
};

export default function NotificationPromptModal({ visible, enabling, onEnable, onDismiss, permissionDenied = false }: Props) {
  const { t } = useLanguage();

  const benefits = [
    { icon: "notifications-outline" as const, text: t("notifPrompt.benefit1") },
    { icon: "flash-outline" as const,         text: t("notifPrompt.benefit2") },
    { icon: "wallet-outline" as const,        text: t("notifPrompt.benefit3") },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.blur}>
            {/* Hero icon */}
            <View style={styles.iconCircle}>
              <Ionicons name="notifications" size={30} color="#2d0015" />
            </View>

            <Text style={styles.title}>{t("notifPrompt.title")}</Text>

            <View style={styles.headlinePill}>
              <Ionicons name="trending-up" size={16} color={C.gold} />
              <Text style={styles.headline}>{t("notifPrompt.headline")}</Text>
            </View>

            <Text style={styles.body}>{t("notifPrompt.body")}</Text>

            <View style={styles.benefits}>
              {benefits.map((b) => (
                <View key={b.icon} style={styles.benefitRow}>
                  <Ionicons name={b.icon} size={18} color={C.purpleLight} />
                  <Text style={styles.benefitText}>{b.text}</Text>
                </View>
              ))}
            </View>

            <Pressable
              onPress={onEnable}
              disabled={enabling}
              style={[{ width: "100%" }, styles.enableBtn, enabling && { opacity: 0.7 }]}
            >
              {enabling ? (
                <ActivityIndicator color="#2d0015" />
              ) : (
                <Text style={styles.enableText}>
                  {permissionDenied ? t("notifPrompt.goToSettings") : t("notifPrompt.enable")}
                </Text>
              )}
            </Pressable>

            <Pressable onPress={onDismiss} disabled={enabling} hitSlop={8} style={styles.laterBtn}>
              <Text style={styles.laterText}>{t("notifPrompt.later")}</Text>
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
    backgroundColor: C.purpleLight,
    shadowColor: "#8938D5", shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  title: { color: C.text, fontSize: 21, fontWeight: "800", textAlign: "center", marginBottom: 12 },
  headlinePill: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center",
    backgroundColor: "rgba(251,191,36,0.12)", borderWidth: 1, borderColor: "rgba(251,191,36,0.35)",
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 14,
  },
  headline: { color: C.gold, fontSize: 14, fontWeight: "800", flexShrink: 1, textAlign: "center" },
  body: { color: C.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 18 },
  benefits: { alignSelf: "stretch", gap: 12, marginBottom: 22 },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  benefitText: { color: C.text, fontSize: 14, flex: 1, lineHeight: 19 },
  enableBtn: { height: 52, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: C.purpleLight },
  enableText: { color: "#2d0015", fontWeight: "800", fontSize: 16 },
  laterBtn: { paddingVertical: 14, marginTop: 4 },
  laterText: { color: C.muted, fontSize: 14, fontWeight: "600" },
});
