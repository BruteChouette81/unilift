import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Field from "@/components/flow/field";
import StepFrame, { type StepPageProps } from "@/components/flow/step-frame";
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { useLanguage } from "@/context/LanguageContext";
import { autoFormatPhoneInput } from "@/utils/phoneNumber";

/**
 * The phone page. The number is optional; storing it is not optional about
 * consent.
 *
 * The policy text and the consent line come from the same `phoneCard.*` keys
 * the profile card uses, so the promise made here is word-for-word the promise
 * made there. What is *not* borrowed is the card itself: `PhoneNumberCard` and
 * `phone-parts` wear the electric cyan the palette reserves for contact
 * surfaces, which earns its keep on a screen full of purple but would make this
 * one page look like it wandered in from another app.
 */
export default function PhoneStep({
  width,
  height,
  topInset,
  reduceMotion,
  value,
  onChangeText,
  consent,
  onConsentChange,
  error,
  valid,
  editable,
}: StepPageProps & {
  value: string;
  onChangeText: (next: string) => void;
  consent: boolean;
  onConsentChange: (next: boolean) => void;
  error?: string | null;
  valid?: boolean;
  editable?: boolean;
}) {
  const { t } = useLanguage();

  const points = [
    t("phoneCard.disclosurePoint1"),
    t("phoneCard.disclosurePoint2"),
    t("phoneCard.disclosurePoint3"),
  ];

  return (
    <StepFrame
      width={width}
      height={height}
      topInset={topInset}
      ask={t("auth.signup.phoneAsk")}
      aside={t("auth.signup.phoneAside")}
    >
      <Field
        label={t("auth.signup.phoneLabel")}
        value={value}
        onChangeText={(next) => onChangeText(autoFormatPhoneInput(next))}
        placeholder={t("auth.signup.phonePlaceholder")}
        error={error}
        valid={valid}
        editable={editable}
        reduceMotion={reduceMotion}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
      />

      <Text style={styles.policyTitle} maxFontSizeMultiplier={FONT_CAP.chrome}>
        {t("phoneCard.policyTitle")}
      </Text>
      {points.map((point) => (
        <View key={point} style={styles.point}>
          <View style={styles.bullet} />
          <Text style={styles.pointText} maxFontSizeMultiplier={FONT_CAP.body}>
            {point}
          </Text>
        </View>
      ))}

      <Pressable
        onPress={() => onConsentChange(!consent)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent }}
        style={styles.consent}
      >
        <View style={[styles.box, consent && styles.boxOn]}>
          {consent ? <Ionicons name="checkmark" size={13} color={P.bg} /> : null}
        </View>
        <Text
          style={[styles.consentText, consent && styles.consentTextOn]}
          maxFontSizeMultiplier={FONT_CAP.body}
        >
          {t("phoneCard.consentLabel")}
        </Text>
      </Pressable>
    </StepFrame>
  );
}

const styles = StyleSheet.create({
  policyTitle: {
    marginTop: 6,
    color: P.text,
    fontSize: 12.5,
    fontWeight: "700",
  },
  point: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 10 },
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: P.accentLight,
    marginTop: 8,
  },
  pointText: { flex: 1, color: P.textMuted, fontSize: 13, lineHeight: 19 },
  consent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 22,
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: P.accentLight, borderColor: P.accentLight },
  consentText: { flex: 1, color: P.textMuted, fontSize: 13, lineHeight: 19 },
  consentTextOn: { color: P.text },
});
