import { useLanguage } from "@/context/LanguageContext";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// ─── Design Tokens (aligned with profile/home glass UI) ─────────────────────────
const C = {
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#6b7280",
  purpleLight: "#e09af7",
  success:     "#34d399",
  danger:      "#f87171",
};

// ─── Platform identifiers ───────────────────────────────────────────────────────
export type SocialPlatform = "facebook" | "instagram" | "tiktok" | "spotify";

/** Per-platform connection snapshot. Wire these from Firestore when backend lands. */
export interface SocialConnection {
  connected: boolean;
  /** Display handle / name once connected, e.g. "@thomas". */
  handle?: string | null;
  /** Shows a spinner on the row while a connect/disconnect call is in flight. */
  loading?: boolean;
}

export type SocialConnections = Partial<Record<SocialPlatform, SocialConnection>>;

interface ConnectSocialsProps {
  connections?: SocialConnections;
  /** Called when an unconnected platform's tile is pressed. */
  onConnect?: (platform: SocialPlatform) => void;
  /** Called when a connected platform's tile is pressed. */
  onDisconnect?: (platform: SocialPlatform) => void;
}

// ─── Static brand metadata ──────────────────────────────────────────────────────
// `icon` names map to FontAwesome5 *brand* glyphs (verified present in the bundle).
type BrandMeta = {
  key: SocialPlatform;
  label: string;
  icon: string;
  /** Solid brand color used for borders / glow accents. */
  accent: string;
  /** Icon-chip background. A gradient for Instagram, solid otherwise. */
  chip: readonly [string, string, ...string[]];
  iconColor: string;
};

const BRANDS: BrandMeta[] = [
  {
    key: "instagram",
    label: "Instagram",
    icon: "instagram",
    accent: "#dc2743",
    chip: ["#f09433", "#dc2743", "#bc1888"],
    iconColor: "#ffffff",
  },
  {
    key: "tiktok",
    label: "TikTok",
    icon: "tiktok",
    accent: "#25F4EE",
    chip: ["#0b0b0f", "#1a1a22"],
    iconColor: "#ffffff",
  },
  {
    key: "spotify",
    label: "Spotify",
    icon: "spotify",
    accent: "#1DB954",
    chip: ["#1DB954", "#119c45"],
    iconColor: "#ffffff",
  },
  {
    key: "facebook",
    label: "Facebook",
    icon: "facebook",
    accent: "#1877F2",
    chip: ["#2b8bff", "#0a5dc2"],
    iconColor: "#ffffff",
  },
];

// ─── Single glass tile ──────────────────────────────────────────────────────────
function SocialTile({
  brand,
  connection,
  connectLabel,
  notLinkedLabel,
  connectedLabel,
  onPress,
}: {
  brand: BrandMeta;
  connection: SocialConnection;
  connectLabel: string;
  notLinkedLabel: string;
  connectedLabel: string;
  onPress: () => void;
}) {
  const { connected, handle, loading } = connection;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={loading}
      style={[
        s.tile,
        { borderColor: connected ? `${brand.accent}55` : "rgba(255,255,255,0.07)" },
      ]}
    >
      <BlurView intensity={28} tint="dark" style={s.tileBlur}>
        <View
          style={[
            s.tileInner,
            connected && { backgroundColor: `${brand.accent}14` },
          ]}
        >
          {/* Brand logo chip */}
          <LinearGradient
            colors={brand.chip}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[s.chip, { shadowColor: brand.accent }]}
          >
            <FontAwesome5 name={brand.icon} brand size={20} color={brand.iconColor} />
          </LinearGradient>

          {/* Name + status */}
          <View style={s.tileText}>
            <Text style={s.tileLabel}>{brand.label}</Text>
            <View style={s.statusRow}>
              {connected ? (
                <>
                  <Ionicons name="checkmark-circle" size={12} color={C.success} />
                  <Text style={[s.statusText, { color: C.success }]} numberOfLines={1}>
                    {handle || connectedLabel}
                  </Text>
                </>
              ) : (
                <Text style={s.statusText} numberOfLines={1}>
                  {notLinkedLabel}
                </Text>
              )}
            </View>
          </View>

          {/* Action */}
          {loading ? (
            <ActivityIndicator size="small" color={brand.accent} />
          ) : connected ? (
            <View style={s.manageBtn}>
              <Ionicons name="ellipsis-horizontal" size={16} color={C.muted} />
            </View>
          ) : (
            <View style={[s.connectBtn, { borderColor: `${brand.accent}55` }]}>
              <Text style={[s.connectText, { color: brand.accent }]}>{connectLabel}</Text>
            </View>
          )}
        </View>
      </BlurView>
    </TouchableOpacity>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────────
export default function ConnectSocials({
  connections = {},
  onConnect,
  onDisconnect,
}: ConnectSocialsProps) {
  const { t } = useLanguage();

  const handlePress = (platform: SocialPlatform, connected: boolean) => {
    if (connected) onDisconnect?.(platform);
    else onConnect?.(platform);
  };

  return (
    <View style={s.wrap}>
      {BRANDS.map((brand) => {
        const connection = connections[brand.key] ?? { connected: false };
        return (
          <SocialTile
            key={brand.key}
            brand={brand}
            connection={connection}
            connectLabel={t("profile.socials.connect")}
            notLinkedLabel={t("profile.socials.notLinked")}
            connectedLabel={t("profile.socials.connected")}
            onPress={() => handlePress(brand.key, connection.connected)}
          />
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 9 },

  tile: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
  },
  tileBlur: {
    borderRadius: 16,
    overflow: "hidden",
  },
  tileInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 12,
    paddingHorizontal: 13,
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  chip: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },

  tileText: { flex: 1, gap: 3 },
  tileLabel: { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  statusText: { color: C.dim, fontSize: 12, fontWeight: "500", flexShrink: 1 },

  connectBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 11,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  connectText: { fontSize: 12.5, fontWeight: "700", letterSpacing: 0.2 },

  manageBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
});
