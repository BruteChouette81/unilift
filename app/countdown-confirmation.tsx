import { authColors } from "@/constants/auth-theme";
import { useCountdownRemoteConfig } from "@/constants/countdown-config";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { useCountdown } from "@/hooks/use-countdown";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import React from "react";
import {
  Alert,
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

export default function CountdownConfirmationScreen() {
  const { user, signOutUser, authActionLoading } = useAuth();
  const { userData } = useUserProfile();
  const { t, language } = useLanguage();
  const { endMs, endDate } = useCountdownRemoteConfig();
  const { days, hours, minutes, seconds } = useCountdown(endMs);
  const { bottom: safeBottom } = useSafeAreaInsets();

  const displayName =
    userData?.name ||
    user?.displayName ||
    (user?.email ? user.email.split("@")[0] : "");

  const launchDate = new Date(endDate).toLocaleDateString(
    language === "fr" ? "fr-CA" : "en-CA",
    { day: "numeric", month: "long", year: "numeric" },
  );

  const handleSignOut = () => {
    if (authActionLoading) return;
    Alert.alert(
      t("countdown.signOutConfirmTitle"),
      t("countdown.signOutConfirmMsg"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("countdown.signOut"),
          style: "destructive",
          onPress: () => {
            signOutUser().catch(() => {});
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: safeBottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={["#2d0015", "#1c0038"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.checkCircle}>
            <Ionicons name="checkmark" size={44} color="#fff" />
          </View>
          <Text style={styles.title}>{t("countdown.welcomeTitle")}</Text>
          <Text style={styles.greeting}>
            {t("countdown.welcomeName", { name: displayName })}
          </Text>
        </LinearGradient>

        <View style={styles.body}>
          <Text style={styles.body2}>
            {t("countdown.comeBackBody", { launchDate })}
          </Text>

          <Text style={styles.countdownLabel}>
            {t("countdown.countdownLabel")}
          </Text>
          <View style={styles.pillsRow}>
            <Pill value={days} label={t("countdown.daysLabel")} />
            <Pill value={hours} label={t("countdown.hoursLabel")} />
            <Pill value={minutes} label={t("countdown.minutesLabel")} />
            <Pill value={seconds} label={t("countdown.secondsLabel")} />
          </View>

          <Pressable
            onPress={handleSignOut}
            disabled={authActionLoading}
            style={styles.signOutBtn}
            hitSlop={8}
          >
            <Text style={styles.signOutText}>{t("countdown.signOut")}</Text>
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
    paddingTop: 90,
    paddingBottom: 36,
    paddingHorizontal: 24,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#34d399",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    shadowColor: "#34d399",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  title: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 0.5,
    textAlign: "center",
    marginBottom: 8,
  },
  greeting: {
    color: authColors.purpleLight,
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  body2: {
    color: authColors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 28,
  },
  countdownLabel: {
    color: authColors.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 12,
  },
  pillsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 36,
  },
  pill: {
    flex: 1,
    backgroundColor: authColors.cardBackground,
    borderWidth: 1,
    borderColor: authColors.cardBorder,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  pillValue: {
    color: "#fff",
    fontSize: 24,
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
  signOutBtn: {
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  signOutText: {
    color: authColors.muted,
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
