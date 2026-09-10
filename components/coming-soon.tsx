import { P } from "@/constants/palette";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * The standard "this feature isn't live yet" body.
 *
 * The visual is lifted verbatim from the production branch of
 * `app/rewardsScreen.tsx` — a centered gradient card with a large emoji, an
 * uppercase COMING SOON label, a title, a subtitle, and an optional list of
 * teaser rows. Extracting it on its second use site keeps the two screens
 * identical instead of letting them drift.
 *
 * Renders the body only — the caller keeps its own screen chrome (safe-area
 * padding, header, back button) so the screen still looks and navigates like
 * itself. Drop it into the `false` branch of a feature flag:
 *
 *     {FEATURE_ENABLED ? <RealFeature /> : <ComingSoon ... />}
 *
 * `rewardsScreen` can adopt this later; it is deliberately left untouched for
 * now so this component's introduction stays reviewable.
 */

const C = {
  border: "rgba(137, 56, 213, 0.22)",
  purpleLight: P.accentLight,
  text: P.text,
  muted: P.textMuted,
};

export type ComingSoonFeature = {
  /** Leading emoji for the row. */
  icon: string;
  label: string;
};

type ComingSoonProps = {
  /** Large emoji in the rounded tile at the top of the card. */
  emoji: string;
  /** Small uppercase eyebrow, e.g. "Coming Soon". */
  label: string;
  /** Feature name. */
  title: string;
  /** One or two sentences on what it will do and why it's not here yet. */
  subtitle: string;
  /** Optional teaser rows. Omitted entirely when absent. */
  features?: ComingSoonFeature[];
};

export default function ComingSoon({
  emoji,
  label,
  title,
  subtitle,
  features,
}: ComingSoonProps) {
  return (
    <View style={styles.center}>
      <LinearGradient colors={["#1c0038", "#08001a"]} style={styles.card}>
        <View style={styles.iconWrap}>
          <Text style={{ fontSize: 48 }}>{emoji}</Text>
        </View>
        <Text style={styles.comingSoonLabel}>{label}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {features && features.length > 0 ? (
          <View style={styles.featureList}>
            {features.map((f) => (
              <View key={f.label} style={styles.featureRow}>
                <Text style={{ fontSize: 16 }}>{f.icon}</Text>
                <Text style={styles.featureText}>{f.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    gap: 12,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "rgba(137,56,213,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 4,
  },
  comingSoonLabel: {
    color: C.purpleLight,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  title: {
    color: C.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: C.muted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  featureList: {
    marginTop: 8,
    width: "100%",
    gap: 10,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  featureText: {
    color: C.text,
    fontSize: 14,
    fontWeight: "600",
  },
});
