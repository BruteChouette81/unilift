import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import StepFrame, { type StepPageProps } from "@/components/flow/step-frame";
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { useLanguage } from "@/context/LanguageContext";

/**
 * Page 3: connect a card.
 *
 * Tapping opens Stripe's own sheet, so this page owns nothing but the invitation
 * and the result. Once a card is attached the button becomes a statement rather
 * than staying tappable — there is no second card to add here, and the wallet is
 * where cards are managed.
 */
export default function CardStep({
  width,
  height,
  topInset,
  added,
  brand,
  last4,
  loading,
  onAdd,
}: StepPageProps & {
  added: boolean;
  brand: string | null;
  last4: string | null;
  loading: boolean;
  onAdd: () => void;
}) {
  const { t } = useLanguage();

  return (
    <StepFrame
      width={width}
      height={height}
      topInset={topInset}
      ask={t("onboarding.cardAsk")}
      aside={t("onboarding.cardAside")}
    >
      <Pressable
        onPress={onAdd}
        disabled={added || loading}
        accessibilityRole="button"
        accessibilityState={{ disabled: added }}
        style={({ pressed }) => [
          styles.btn,
          added && styles.btnAdded,
          pressed && styles.pressed,
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={P.accentLight} />
        ) : (
          <Ionicons
            name={added ? "checkmark-circle" : "card-outline"}
            size={20}
            color={added ? P.success : P.accentLight}
          />
        )}
        <Text
          style={[styles.text, added && styles.textAdded]}
          maxFontSizeMultiplier={FONT_CAP.action}
        >
          {added
            ? t("onboarding.cardConnected", {
                brand: (brand ?? "").toUpperCase(),
                last4: last4 ?? "",
              })
            : t("onboarding.addCard")}
        </Text>
      </Pressable>
    </StepFrame>
  );
}

const styles = StyleSheet.create({
  btn: {
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
  btnAdded: {
    borderColor: "rgba(52,211,153,0.4)",
    backgroundColor: "rgba(52,211,153,0.08)",
  },
  pressed: { opacity: 0.75 },
  text: { flex: 1, color: P.text, fontSize: 15, fontWeight: "600" },
  textAdded: { color: P.success },
});
