import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Field from "@/components/flow/field";
import StepFrame, { type StepPageProps } from "@/components/flow/step-frame";
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { useLanguage } from "@/context/LanguageContext";
import {
  getPasswordRequirements,
  type PasswordRequirementKey,
} from "@/utils/passwordPolicy";

const REQ_LABEL_KEYS: Record<PasswordRequirementKey, string> = {
  minLength: "auth.signup.passwordReqMinLength",
  upper: "auth.signup.passwordReqUpper",
  lower: "auth.signup.passwordReqLower",
  number: "auth.signup.passwordReqNumber",
  special: "auth.signup.passwordReqSpecial",
};

/**
 * The password page.
 *
 * The checklist is always visible here, unlike the old form where it appeared
 * on focus and disappeared again. With nothing else on the page there is no
 * reason to hide it, and showing the target before someone starts typing beats
 * telling them afterwards that they missed it.
 */
export default function PasswordStep({
  width,
  height,
  topInset,
  reduceMotion,
  value,
  onChangeText,
  error,
  valid,
  editable,
}: StepPageProps & {
  value: string;
  onChangeText: (next: string) => void;
  error?: string | null;
  valid?: boolean;
  editable?: boolean;
}) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  const requirements = getPasswordRequirements(value);

  return (
    <StepFrame
      width={width}
      height={height}
      topInset={topInset}
      ask={t("auth.signup.passwordAsk")}
      aside={t("auth.signup.passwordAside")}
    >
      <Field
        label={t("auth.signup.passwordLabel")}
        value={value}
        onChangeText={onChangeText}
        error={error}
        valid={valid}
        editable={editable}
        reduceMotion={reduceMotion}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
        trailing={
          <Pressable
            onPress={() => setVisible((v) => !v)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t(
              visible ? "auth.signup.passwordHide" : "auth.signup.passwordShow",
            )}
          >
            <Ionicons
              name={visible ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={P.textMuted}
            />
          </Pressable>
        }
      />

      <View style={styles.list} accessibilityLabel={t("auth.signup.passwordReqTitle")}>
        {requirements.map((req) => (
          <View key={req.key} style={styles.row}>
            <Ionicons
              name={req.met ? "checkmark-circle" : "ellipse-outline"}
              size={15}
              color={req.met ? P.success : P.textDim}
            />
            <Text
              style={[styles.text, req.met && styles.textMet]}
              maxFontSizeMultiplier={FONT_CAP.chrome}
            >
              {t(REQ_LABEL_KEYS[req.key])}
            </Text>
          </View>
        ))}
      </View>
    </StepFrame>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 4, gap: 9 },
  row: { flexDirection: "row", alignItems: "center", gap: 9 },
  text: { color: P.textDim, fontSize: 13, fontWeight: "500", flexShrink: 1 },
  textMet: { color: P.textMuted },
});
