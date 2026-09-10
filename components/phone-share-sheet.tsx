import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import {
  autoFormatPhoneInput,
  formatPhoneForDisplay,
  parsePhoneInput,
} from "@/utils/phoneNumber";

const C = {
  surface:     P.surface,
  border:      "rgba(137, 56, 213, 0.30)",
  gold:        P.warning,
  success:     P.success,
  text:        P.text,
  muted:       P.textMuted,
  dim:         P.textDim,
  danger:      P.danger,
  purpleLight: P.accentLight,
  inputBg:     "rgba(255, 255, 255, 0.05)",
  inputBorder: "rgba(137, 56, 213, 0.22)",
  inputFocus:  "rgba(137, 56, 213, 0.7)",
};

const ICON_GRADIENT = ["#FD165A", "#8938D5"] as const;

type Props = {
  visible: boolean;
  /** The driver's first name, when known — the copy is warmer with it. */
  driverName?: string | null;
  /** Existing number (E.164) when the passenger is editing rather than adding. */
  currentPhone?: string | null;
  /** Called with the E.164 number. Should resolve false if the save failed. */
  onSave: (e164: string) => Promise<boolean>;
  /** Dismissed without sharing. Always a valid outcome. */
  onSkip: () => void;
};

/**
 * Asks a passenger for a phone number so the driver on their way can reach them.
 *
 * The three bullet points are not decoration — a phone number is personal
 * information, and this sheet is where the purpose, the audience and the
 * duration are disclosed. Shortening that list turns a consent sheet back into
 * a form, so it stays even when the layout is tight.
 *
 * Skipping is a first-class outcome. A passenger who declines still rides; their
 * driver simply sees "no number shared".
 */
export default function PhoneShareSheet({
  visible, driverName, currentPhone, onSave, onSkip,
}: Props) {
  const { t } = useLanguage();
  const [value, setValue] = useState(() =>
    currentPhone ? formatPhoneForDisplay(currentPhone) : "");
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seed each time it opens: the passenger may have added a number from
  // their profile since it was last shown. Done during render rather than in an
  // effect — React's own "adjust state when a prop changes" pattern — so the
  // first frame after opening already shows the right value instead of
  // rendering stale state and then correcting it.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setValue(currentPhone ? formatPhoneForDisplay(currentPhone) : "");
      setError(false);
      setSaving(false);
    }
  }

  const e164 = parsePhoneInput(value);
  const canSubmit = e164 !== "" && !saving;

  const submit = async () => {
    if (saving) return;
    if (!e164) { setError(true); return; }
    setSaving(true);
    const ok = await onSave(e164);
    setSaving(false);
    if (!ok) setError(true);
  };

  const points = [t("phoneShare.point1"), t("phoneShare.point2"), t("phoneShare.point3")];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip} statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.card}>
          <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.blur}>
            <LinearGradient
              colors={ICON_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.iconCircle}
            >
              <Ionicons name="call" size={28} color="#fff" />
            </LinearGradient>

            <Text style={styles.title} maxFontSizeMultiplier={FONT_CAP.display}>
              {t("phoneShare.title")}
            </Text>

            <View style={styles.headlinePill}>
              <Ionicons name="lock-closed" size={13} color={C.gold} />
              <Text style={styles.headline} maxFontSizeMultiplier={FONT_CAP.chrome}>
                {t("phoneShare.highlight")}
              </Text>
            </View>

            <Text style={styles.body} maxFontSizeMultiplier={FONT_CAP.body}>
              {driverName
                ? t("phoneShare.bodyWithName", { name: driverName })
                : t("phoneShare.body")}
            </Text>

            {/* Input */}
            <Text style={styles.label} maxFontSizeMultiplier={FONT_CAP.chrome}>
              {t("phoneShare.inputLabel")}
            </Text>
            <View style={[
              styles.inputRow,
              focused && styles.inputRowFocused,
              error && styles.inputRowError,
            ]}>
              <Ionicons name="call-outline" size={16} color={C.muted} style={styles.inputIcon} />
              <TextInput
                style={styles.textInput}
                value={value}
                onChangeText={(v) => { setValue(autoFormatPhoneInput(v)); setError(false); }}
                placeholder={t("phoneShare.placeholder")}
                placeholderTextColor={C.dim}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                maxLength={14}
                returnKeyType="done"
                onSubmitEditing={() => void submit()}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                editable={!saving}
              />
            </View>
            {error && (
              <Text style={styles.errorText} maxFontSizeMultiplier={FONT_CAP.chrome}>
                {t("phoneShare.invalid")}
              </Text>
            )}

            {/* The disclosure. Who sees it, for how long, and where it never appears. */}
            <View style={styles.points}>
              {points.map((point) => (
                <View key={point} style={styles.pointRow}>
                  <Ionicons name="checkmark-circle" size={15} color={C.success} />
                  <Text style={styles.pointText} maxFontSizeMultiplier={FONT_CAP.chrome}>
                    {point}
                  </Text>
                </View>
              ))}
            </View>

            <Pressable
              onPress={() => void submit()}
              disabled={!canSubmit}
              style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#2d0015" />
              ) : (
                <Text style={styles.primaryText} maxFontSizeMultiplier={FONT_CAP.action}>
                  {currentPhone ? t("phoneShare.update") : t("phoneShare.share")}
                </Text>
              )}
            </Pressable>

            <Pressable onPress={onSkip} hitSlop={8} style={styles.skipBtn} disabled={saving}>
              <Text style={styles.skipText} maxFontSizeMultiplier={FONT_CAP.body}>
                {t("phoneShare.skip")}
              </Text>
            </Pressable>
          </BlurView>
        </View>
      </KeyboardAvoidingView>
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
  body: { color: C.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 20 },

  label: {
    alignSelf: "flex-start", color: C.muted, fontSize: 12, fontWeight: "600",
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
  },
  inputRow: {
    alignSelf: "stretch", flexDirection: "row", alignItems: "center",
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.inputBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  inputRowFocused: { borderColor: C.inputFocus },
  inputRowError: { borderColor: "rgba(248,113,113,0.7)" },
  inputIcon: { marginRight: 10 },
  textInput: { flex: 1, color: C.text, fontSize: 16, fontWeight: "600", padding: 0 },
  errorText: { alignSelf: "flex-start", color: C.danger, fontSize: 12, marginTop: 6 },

  points: { alignSelf: "stretch", gap: 8, marginTop: 18, marginBottom: 22 },
  pointRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  pointText: { flex: 1, color: C.muted, fontSize: 12.5, lineHeight: 18 },

  primaryBtn: {
    alignSelf: "stretch", height: 52, borderRadius: 15,
    alignItems: "center", justifyContent: "center", backgroundColor: C.purpleLight,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryText: { color: "#2d0015", fontWeight: "800", fontSize: 16 },
  skipBtn: { paddingVertical: 14, marginTop: 4 },
  skipText: { color: C.muted, fontSize: 14, fontWeight: "600" },
});
