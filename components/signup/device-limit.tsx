import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { P } from "@/constants/palette";
import { MAX_ACCOUNTS_PER_DEVICE } from "@/constants/security";
import { FONT_CAP } from "@/constants/typography";
import { useLanguage } from "@/context/LanguageContext";
import { useResponsive } from "@/hooks/use-responsive";

const SUPPORT_EMAIL = "support@unilift.ca";

/**
 * Shown instead of the signup flow when this device has already created its
 * allowance of accounts.
 *
 * Deliberately a dead end with a way out rather than an error: the person
 * reading this is far more likely to be a roommate borrowing a phone, or
 * someone who deleted an account and forgot, than an abuser — and an abuser
 * learns nothing from it they could not learn by trying. So it says what
 * happened, gives the number, and offers a human. It does not accuse.
 */
export default function DeviceLimitScreen({ onBack }: { onBack: () => void }) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { isNarrow } = useResponsive();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <LinearGradient
        colors={["rgba(45,0,21,0.9)", "rgba(28,0,56,0.35)", "rgba(8,8,16,0)"]}
        style={styles.wash}
        pointerEvents="none"
      />

      <View style={[styles.body, { paddingHorizontal: isNarrow ? 22 : 28 }]}>
        <View style={styles.icon}>
          <Ionicons name="shield-half-outline" size={26} color={P.accentLight} />
        </View>

        <Text
          style={[styles.title, isNarrow && styles.titleNarrow]}
          maxFontSizeMultiplier={FONT_CAP.display}
          accessibilityRole="header"
        >
          {t("auth.signup.deviceLimitTitle")}
        </Text>

        <Text style={styles.body_} maxFontSizeMultiplier={FONT_CAP.body}>
          {t("auth.signup.deviceLimitBody", { max: MAX_ACCOUNTS_PER_DEVICE })}
        </Text>
      </View>

      <View style={[styles.actions, { paddingHorizontal: isNarrow ? 22 : 28 }]}>
        <Pressable
          onPress={() => {
            Linking.openURL(
              `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Account limit on my device")}`,
            ).catch(() => {});
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <Text style={styles.ctaText} maxFontSizeMultiplier={FONT_CAP.action}>
            {t("auth.signup.deviceLimitContact")}
          </Text>
        </Pressable>

        <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button">
          <Text style={styles.back} maxFontSizeMultiplier={FONT_CAP.chrome}>
            {t("auth.signup.deviceLimitBackToLogin")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg },
  wash: { position: "absolute", top: 0, left: 0, right: 0, height: 380 },
  body: { flex: 1, justifyContent: "center" },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(137,56,213,0.16)",
    borderWidth: 1,
    borderColor: "rgba(224,154,247,0.3)",
    marginBottom: 26,
  },
  title: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: -0.8,
    color: P.text,
  },
  titleNarrow: { fontSize: 29, lineHeight: 33 },
  body_: {
    marginTop: 14,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    color: P.textMuted,
    maxWidth: 460,
  },
  actions: { gap: 16, alignItems: "center" },
  cta: {
    alignSelf: "stretch",
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: P.accentLight,
  },
  pressed: { opacity: 0.85 },
  ctaText: { color: "#2d0015", fontSize: 16, fontWeight: "700", letterSpacing: 0.3 },
  back: { color: P.textMuted, fontSize: 13, fontWeight: "600" },
});
