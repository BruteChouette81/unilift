import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import StepFrame, { type StepPageProps } from "@/components/flow/step-frame";
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { useLanguage } from "@/context/LanguageContext";

export type ReviewRow = {
  key: string;
  label: string;
  /** Already resolved for display — see the note on `rows` below. */
  value: string;
  /** Page to jump back to when the row is tapped. */
  step: number;
};

/**
 * The last page: everything you just answered, and the button that commits it.
 *
 * ## `rows` must be derived from the same expression as the payload
 *
 * The phone is the trap. Someone can reach this page, swipe back, type digits
 * without ticking consent, and swipe forward again — the write correctly drops
 * an unconsented number, so a recap built from raw state would promise a number
 * that never gets saved. The shell therefore builds these rows out of the
 * resolved payload, not out of the field values.
 */
export default function ReviewStep({
  width,
  height,
  topInset,
  rows,
  onEdit,
}: StepPageProps & {
  rows: readonly ReviewRow[];
  onEdit: (step: number) => void;
}) {
  const { t } = useLanguage();

  return (
    <StepFrame
      width={width}
      height={height}
      topInset={topInset}
      ask={t("auth.signup.reviewAsk")}
      aside={t("auth.signup.reviewAside")}
    >
      <View style={styles.list}>
        {rows.map((row) => (
          <Pressable
            key={row.key}
            onPress={() => onEdit(row.step)}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}: ${row.value}`}
            accessibilityHint={t("auth.signup.stepBack", { n: row.step + 1 })}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.text}>
              <Text style={styles.label} maxFontSizeMultiplier={FONT_CAP.chrome}>
                {row.label}
              </Text>
              <Text
                style={styles.value}
                numberOfLines={2}
                maxFontSizeMultiplier={FONT_CAP.body}
              >
                {row.value}
              </Text>
            </View>
            <Ionicons name="pencil" size={15} color={P.textMuted} />
          </Pressable>
        ))}
      </View>
    </StepFrame>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: -12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  rowPressed: { opacity: 0.6 },
  text: { flex: 1, gap: 3 },
  label: { color: P.textMuted, fontSize: 12, fontWeight: "600" },
  value: { color: P.text, fontSize: 16, fontWeight: "600" },
});
