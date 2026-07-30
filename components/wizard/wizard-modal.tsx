import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const C = {
  surface:     "#0f0f1e",
  border:      "rgba(137, 56, 213, 0.30)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  gold:        "#fbbf24",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
};

const BTN_GRADIENT  = ["#FD165A", "#8938D5"] as const;
const ICON_GRADIENT = ["#FD165A", "#8938D5"] as const;

export type WizardStep = {
  /** Ionicons name for the hero circle. */
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body: string;
  /** Optional short highlighted pill under the title (e.g. a key benefit). */
  highlight?: string;
};

type Props = {
  visible: boolean;
  steps: WizardStep[];
  /** Called when the wizard is skipped or dismissed (persist "seen" here). */
  onDone: () => void;
  /**
   * Called when the user taps the final-step primary button. Defaults to
   * `onDone`. Use this when the final CTA should also trigger an action
   * (e.g. open the Stripe card sheet) while skipping should not.
   */
  onComplete?: () => void;
  /**
   * Called once the modal has *fully* finished dismissing. Anything that
   * presents a native view controller (e.g. the Stripe payment sheet) must wait
   * for this — starting it from `onComplete` presents from a modal that is still
   * on screen, which UIKit refuses without ever calling back.
   */
  onDismissed?: () => void;
  /** Label for the final step's primary button. Defaults to common.done. */
  finalLabel?: string;
};

/**
 * A first-run card-carousel wizard. Multi-step, with step dots, Back / Next,
 * and a Skip affordance. Styled from the app's purple→pink glass tokens.
 * Persistence lives in the caller (via useFirstRun) — this is purely presentational.
 */
export default function WizardModal({ visible, steps, onDone, onComplete, onDismissed, finalLabel }: Props) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);

  // Kept in a ref so the dismissal effect below can stay keyed on `visible`
  // alone — callers pass an inline arrow, so depending on it would re-run (and
  // cancel) the pending callback on every render.
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;
  const wasVisible = useRef(visible);

  // Reset to the first slide whenever the wizard is (re)opened.
  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  // `Modal.onDismiss` is iOS-only, so everywhere else we synthesise the
  // "fully dismissed" signal once the hide transition has settled.
  useEffect(() => {
    const was = wasVisible.current;
    wasVisible.current = visible;
    if (Platform.OS === "ios" || visible || !was) return;
    const task = InteractionManager.runAfterInteractions(() => onDismissedRef.current?.());
    return () => task.cancel();
  }, [visible]);

  if (steps.length === 0) return null;

  const step = steps[Math.min(index, steps.length - 1)];
  const isFirst = index === 0;
  const isLast = index >= steps.length - 1;

  const next = () => {
    if (isLast) (onComplete ?? onDone)();
    else setIndex((i) => i + 1);
  };
  const back = () => setIndex((i) => Math.max(0, i - 1));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDone}
      onDismiss={Platform.OS === "ios" ? onDismissed : undefined}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <BlurView intensity={90} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.blur}>
            {/* Skip (top-right) */}
            <TouchableOpacity onPress={onDone} hitSlop={10} style={styles.skipBtn}>
              <Text style={styles.skipText}>{t("wizard.skip")}</Text>
            </TouchableOpacity>

            {/* Hero icon */}
            <LinearGradient colors={ICON_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconCircle}>
              <Ionicons name={step.icon} size={30} color="#fff" />
            </LinearGradient>

            <Text style={styles.title}>{step.title}</Text>

            {step.highlight ? (
              <View style={styles.headlinePill}>
                <Ionicons name="sparkles" size={14} color={C.gold} />
                <Text style={styles.headline}>{step.highlight}</Text>
              </View>
            ) : null}

            <Text style={styles.body}>{step.body}</Text>

            {/* Step dots */}
            {steps.length > 1 && (
              <View style={styles.dotsRow}>
                {steps.map((_, i) => (
                  <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
                ))}
              </View>
            )}

            {/* Primary button */}
            <Pressable onPress={next} style={{ width: "100%" }}>
              <LinearGradient colors={BTN_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
                <Text style={styles.primaryText}>
                  {isLast ? (finalLabel ?? t("common.done")) : t("wizard.next")}
                </Text>
              </LinearGradient>
            </Pressable>

            {/* Back (only after the first step) */}
            {!isFirst && (
              <Pressable onPress={back} hitSlop={8} style={styles.backBtn}>
                <Text style={styles.backText}>{t("wizard.back")}</Text>
              </Pressable>
            )}
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
  blur: { padding: 24, paddingTop: 40, alignItems: "center" },
  skipBtn: { position: "absolute", top: 14, right: 16, paddingHorizontal: 6, paddingVertical: 4, zIndex: 2 },
  skipText: { color: C.muted, fontSize: 13, fontWeight: "600" },
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
  body: { color: C.muted, fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 20 },
  dotsRow: { flexDirection: "row", gap: 7, marginBottom: 22 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.22)" },
  dotActive: { backgroundColor: C.purpleLight, width: 20 },
  primaryBtn: { height: 52, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  backBtn: { paddingVertical: 12, marginTop: 2 },
  backText: { color: C.muted, fontSize: 14, fontWeight: "600" },
});
