import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import StepFrame, { type StepPageProps } from "@/components/flow/step-frame";
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { useLanguage } from "@/context/LanguageContext";

/**
 * The terms page.
 *
 * There is no checkbox here on purpose. Acceptance lives inside
 * `LegalTermsModal`, which keeps its tick box locked until you have scrolled to
 * the end — so "accepted" means "read". Duplicating the box on this page would
 * offer a way to accept without ever opening the text.
 */
export default function TermsStep({
  width,
  height,
  topInset,
  accepted,
  onOpen,
  error,
}: StepPageProps & {
  accepted: boolean;
  onOpen: () => void;
  error?: string | null;
}) {
  const { t } = useLanguage();

  return (
    <StepFrame
      width={width}
      height={height}
      topInset={topInset}
      ask={t("auth.signup.termsAsk")}
      aside={t("auth.signup.termsAside")}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.open,
          accepted && styles.openAccepted,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={accepted ? "checkmark-circle" : "document-text-outline"}
          size={20}
          color={accepted ? P.success : P.accentLight}
        />
        <Text
          style={[styles.openText, accepted && styles.openTextAccepted]}
          maxFontSizeMultiplier={FONT_CAP.action}
        >
          {accepted ? t("auth.signup.termsAccepted") : t("auth.signup.viewTerms")}
        </Text>
        {accepted ? null : (
          <Ionicons name="chevron-forward" size={18} color={P.textMuted} />
        )}
      </Pressable>

      <View style={styles.messageSlot}>
        {error ? (
          <Text
            style={styles.error}
            accessibilityLiveRegion="polite"
            maxFontSizeMultiplier={FONT_CAP.chrome}
          >
            {error}
          </Text>
        ) : (
          <Text style={styles.hint} maxFontSizeMultiplier={FONT_CAP.chrome}>
            {t("auth.signup.termsScrollHint")}
          </Text>
        )}
      </View>
    </StepFrame>
  );
}

const styles = StyleSheet.create({
  open: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  openAccepted: {
    borderColor: "rgba(52,211,153,0.4)",
    backgroundColor: "rgba(52,211,153,0.08)",
  },
  pressed: { opacity: 0.75 },
  openText: { flex: 1, color: P.text, fontSize: 15, fontWeight: "600" },
  openTextAccepted: { color: P.success },
  messageSlot: { minHeight: 23, marginTop: 10 },
  hint: { color: P.textDim, fontSize: 12.5, lineHeight: 17 },
  error: { color: P.danger, fontSize: 12.5, lineHeight: 17, fontWeight: "600" },
});
