import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "@/context/LanguageContext";
import type { Language } from "@/constants/translations";

interface Props {
  permissionDenied: boolean;
  requesting: boolean;
  onEnable: () => Promise<void>;
  onOpenSettings: () => Promise<void>;
}

const BENEFIT_ICONS: ("car-outline" | "flash-outline" | "wallet-outline")[] = [
  "car-outline",
  "flash-outline",
  "wallet-outline",
];

const LANGUAGES: { code: Language; label: string }[] = [
  { code: "fr", label: "FR" },
  { code: "en", label: "EN" },
];

export default function NotificationGateScreen({
  permissionDenied,
  requesting,
  onEnable,
  onOpenSettings,
}: Props) {
  const { top, bottom } = useSafeAreaInsets();
  const { t, language, changeLanguage } = useLanguage();

  const handlePrimary = permissionDenied ? onOpenSettings : onEnable;
  const primaryLabel = permissionDenied
    ? t("notifGate.openSettingsBtn")
    : t("notifGate.enableBtn");

  const benefits = [
    t("notifGate.benefit1"),
    t("notifGate.benefit2"),
    t("notifGate.benefit3"),
  ];

  return (
    <View style={[styles.root, { paddingTop: top, paddingBottom: bottom + 24 }]}>
      <LinearGradient
        colors={["#3b0764", "#1e3a8a", "#080810"]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Language switcher */}
      <View style={[styles.langRow, { top: top + 12 }]}>
        {LANGUAGES.map((l) => (
          <TouchableOpacity
            key={l.code}
            onPress={() => void changeLanguage(l.code)}
            style={[styles.langBtn, language === l.code && styles.langBtnActive]}
            activeOpacity={0.7}
          >
            <Text style={[styles.langText, language === l.code && styles.langTextActive]}>
              {l.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Hero icon */}
      <View style={styles.heroWrap}>
        <LinearGradient colors={["#7C3AED", "#2563eb"]} style={styles.heroCircle}>
          <Ionicons name="notifications" size={44} color="#fff" />
        </LinearGradient>
        <View style={styles.heroGlow} />
      </View>

      <Text style={styles.headline}>{t("notifGate.headline")}</Text>
      <Text style={styles.subhead}>{t("notifGate.subhead")}</Text>

      {/* Benefit bullets */}
      <View style={styles.bullets}>
        {benefits.map((text, i) => (
          <View key={i} style={styles.bullet}>
            <View style={styles.bulletIcon}>
              <Ionicons name={BENEFIT_ICONS[i]} size={18} color="#a78bfa" />
            </View>
            <Text style={styles.bulletText}>{text}</Text>
          </View>
        ))}
      </View>

      {/* Denied explanation */}
      {permissionDenied && (
        <View style={styles.deniedBox}>
          <Ionicons name="information-circle-outline" size={16} color="#fbbf24" />
          <Text style={styles.deniedText}>{t("notifGate.deniedHint")}</Text>
        </View>
      )}

      {/* Primary CTA */}
      <TouchableOpacity
        style={styles.btn}
        activeOpacity={0.8}
        onPress={handlePrimary}
        disabled={requesting}
      >
        <LinearGradient
          colors={["#7C3AED", "#2563eb"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.btnGrad}
        >
          {requesting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons
                name={permissionDenied ? "settings-outline" : "notifications-outline"}
                size={18}
                color="#fff"
              />
              <Text style={styles.btnText}>{primaryLabel}</Text>
            </>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#080810",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  langRow: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    gap: 6,
  },
  langBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.3)",
  },
  langBtnActive: {
    backgroundColor: "rgba(124,58,237,0.35)",
    borderColor: "#a78bfa",
  },
  langText: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(167,139,250,0.6)",
  },
  langTextActive: {
    color: "#a78bfa",
  },
  heroWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
  },
  heroCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  heroGlow: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(124, 58, 237, 0.25)",
  },
  headline: {
    fontSize: 28,
    fontWeight: "800",
    color: "#f3f4f6",
    textAlign: "center",
    letterSpacing: 0.3,
    marginBottom: 12,
  },
  subhead: {
    fontSize: 15,
    color: "rgba(243,244,246,0.65)",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  bullets: {
    width: "100%",
    gap: 14,
    marginBottom: 28,
  },
  bullet: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  bulletIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(124,58,237,0.18)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: "rgba(243,244,246,0.8)",
    lineHeight: 20,
    paddingTop: 8,
  },
  deniedBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(251,191,36,0.1)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.3)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    width: "100%",
  },
  deniedText: {
    flex: 1,
    fontSize: 13,
    color: "#fbbf24",
    lineHeight: 18,
  },
  btn: {
    width: "100%",
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 4,
  },
  btnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
