import {
  CERT_META,
  UNCERTIFIED,
  earnedTiers,
  type CertTier,
} from "@/constants/certifications";
import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

type CertSize = "compact" | "medium" | "full";

type CertBadgesProps = {
  certifications?: string[] | null;
  /** "compact" → small icon pills (ride cards, name row); "medium" → larger
   *  icon pills (tappable profile badge); "full" → labeled chips (modals). */
  size?: CertSize;
  /** When true, an uncertified user renders nothing instead of a gray chip.
   *  Useful in dense compact contexts. */
  hideWhenEmpty?: boolean;
};

// Per-size dimensions for the icon-only pill sizes.
const DIMS: Record<"compact" | "medium", { box: number; icon: number }> = {
  compact: { box: 22, icon: 12 },
  medium: { box: 30, icon: 17 },
};

/** Renders a user's stacked identity certifications as colored badges. Pure
 *  presentation — all data comes from the shared `constants/certifications`
 *  registry. */
export default function CertBadges({
  certifications,
  size = "compact",
  hideWhenEmpty = false,
}: CertBadgesProps) {
  const { t } = useLanguage();
  const tiers = earnedTiers(certifications);

  if (tiers.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <View style={styles.row}>
        <Badge
          color={UNCERTIFIED.color}
          icon={UNCERTIFIED.icon}
          label={t(UNCERTIFIED.labelKey)}
          size={size}
        />
      </View>
    );
  }

  return (
    <View style={styles.row}>
      {tiers.map((tier: CertTier) => {
        const meta = CERT_META[tier];
        return (
          <Badge
            key={tier}
            color={meta.color}
            icon={meta.icon}
            label={t(meta.labelKey)}
            size={size}
          />
        );
      })}
    </View>
  );
}

function Badge({
  color,
  icon,
  label,
  size,
}: {
  color: string;
  icon: string;
  label: string;
  size: CertSize;
}) {
  const colors = { borderColor: color + "66", backgroundColor: color + "1f" };

  if (size === "full") {
    return (
      <View style={[styles.chipFull, colors]}>
        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={15} color={color} />
        <Text style={[styles.label, { color }]}>{label}</Text>
      </View>
    );
  }

  const dims = DIMS[size];
  return (
    <View
      style={[
        { width: dims.box, height: dims.box, borderRadius: dims.box / 2 },
        styles.chipIcon,
        colors,
      ]}
    >
      <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={dims.icon} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  chipIcon: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chipFull: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
  },
});
