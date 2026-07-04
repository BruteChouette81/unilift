import { authColors } from "@/constants/auth-theme";
import { useCountdownRemoteConfig } from "@/constants/countdown-config";
import { useLanguage } from "@/context/LanguageContext";
import { useCountdown } from "@/hooks/use-countdown";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function Pill({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillValue}>{String(value).padStart(2, "0")}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

export default function CountdownScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const { endMs, endDate } = useCountdownRemoteConfig();
  const { days, hours, minutes, seconds } = useCountdown(endMs);
  const { bottom: safeBottom } = useSafeAreaInsets();

  const launchDate = new Date(endDate).toLocaleDateString(
    language === "fr" ? "fr-CA" : "en-CA",
    { day: "numeric", month: "long", year: "numeric" },
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: safeBottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={["#2d0015", "#1c0038"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.wordmark}>{t("countdown.wordmark")}</Text>
          <View style={styles.launchRow}>
            <Ionicons name="hourglass-outline" size={14} color={authColors.purpleLight} />
            <Text style={styles.launchText}>
              {t("countdown.launchOn", { date: launchDate })}
            </Text>
          </View>
        </LinearGradient>

        <View style={styles.body}>
          <Text style={styles.tagline}>{t("countdown.tagline")}</Text>
          <Text style={styles.subTagline}>{t("countdown.subTagline")}</Text>

          <View style={styles.pillsRow}>
            <Pill value={days} label={t("countdown.daysLabel")} />
            <Pill value={hours} label={t("countdown.hoursLabel")} />
            <Pill value={minutes} label={t("countdown.minutesLabel")} />
            <Pill value={seconds} label={t("countdown.secondsLabel")} />
          </View>

          <Pressable
            onPress={() => router.push("/(auth)/signup")}
            style={styles.ctaWrap}
          >
            <LinearGradient
              colors={["#FD165A", "#8938D5"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.cta}
            >
              <Text style={styles.ctaText}>{t("countdown.createAccount")}</Text>
            </LinearGradient>
          </Pressable>

          <Pressable
            onPress={() => router.push("/(auth)/login")}
            hitSlop={8}
            style={styles.secondaryLinkWrap}
          >
            <Text style={styles.secondaryLink}>
              {t("countdown.alreadySignedUp")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: authColors.screenBackground,
  },
  scroll: {
    flexGrow: 1,
  },
  header: {
    alignItems: "center",
    paddingTop: 80,
    paddingBottom: 36,
  },
  logo: {
    width: 84,
    height: 84,
    marginBottom: 12,
  },
  wordmark: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 1,
    textAlign: "center",
  },
  launchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(224, 154, 247, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(224, 154, 247, 0.3)",
  },
  launchText: {
    color: authColors.purpleLight,
    fontSize: 12,
    fontWeight: "600",
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  tagline: {
    color: authColors.title,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  subTagline: {
    color: authColors.muted,
    fontSize: 14,
    textAlign: "center",
    marginBottom: 28,
    lineHeight: 20,
  },
  pillsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 32,
  },
  pill: {
    flex: 1,
    backgroundColor: authColors.cardBackground,
    borderWidth: 1,
    borderColor: authColors.cardBorder,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  pillValue: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1,
  },
  pillLabel: {
    color: authColors.purpleLight,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 4,
    textTransform: "uppercase",
  },
  ctaWrap: {
    marginTop: 4,
  },
  cta: {
    height: 52,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  secondaryLinkWrap: {
    alignItems: "center",
    marginTop: 18,
  },
  secondaryLink: {
    color: authColors.purpleLight,
    fontSize: 14,
    fontWeight: "600",
  },
});
