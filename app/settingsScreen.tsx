import type { Language } from "@/constants/translations";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { normalizeAuthError } from "@/services/authService";
import { registerForPushNotifications, savePushTokenToFirestore, setupNotificationChannel } from "@/services/notificationService";
import NotificationPromptModal from "@/components/notification-prompt-modal";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useProfileData } from "@/hooks/use-profile-data";
import { useProfileFavorites } from "@/hooks/use-profile-favorites";
import type { UserProfile } from "@/types/models";

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
};

// ─── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string }) {
  return (
    <View style={sh.row}>
      <View style={sh.left}>
        <View style={sh.iconDot}>
          <Ionicons name={icon} size={13} color={C.purpleLight} />
        </View>
        <Text style={sh.title}>{title}</Text>
      </View>
    </View>
  );
}

const sh = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "center", marginBottom: 10, marginTop: 24 },
  left:    { flexDirection: "row", alignItems: "center", gap: 8 },
  iconDot: { width: 26, height: 26, borderRadius: 7, backgroundColor: "rgba(224,154,247,0.12)", alignItems: "center", justifyContent: "center" },
  title:   { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
});

// ─── Settings Row ──────────────────────────────────────────────────────────────
function SettingsRow({
  icon, label, value, onPress, danger, disabled, rightElement, soonLabel,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  rightElement?: React.ReactNode;
  soonLabel?: string;
}) {
  return (
    <TouchableOpacity
      style={[sr.row, danger && sr.dangerRow, disabled && sr.disabledRow]}
      onPress={disabled ? undefined : (onPress ?? (() => {}))}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <View style={[sr.iconWrap, danger && sr.dangerIcon, disabled && sr.disabledIcon]}>
        <Ionicons name={icon} size={15} color={danger ? C.danger : disabled ? C.dim : C.purpleLight} />
      </View>
      <Text style={[sr.label, danger && sr.dangerLabel, disabled && sr.disabledLabel]}>{label}</Text>
      <View style={sr.right}>
        {rightElement ?? (
          <>
            {value && !disabled && <Text style={sr.value}>{value}</Text>}
            {disabled
              ? <Text style={sr.comingSoon}>{soonLabel}</Text>
              : <Ionicons name="chevron-forward" size={14} color={C.dim} />
            }
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

const sr = StyleSheet.create({
  row:          { flexDirection: "row", alignItems: "center", paddingVertical: 13, paddingHorizontal: 14, backgroundColor: C.surface, borderRadius: 12, marginBottom: 7, borderWidth: 1, borderColor: C.borderFaint },
  dangerRow:    { backgroundColor: "#130808", borderColor: "rgba(248,113,113,0.18)" },
  disabledRow:  { opacity: 0.45 },
  iconWrap:     { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(224,154,247,0.1)", alignItems: "center", justifyContent: "center", marginRight: 12 },
  dangerIcon:   { backgroundColor: "rgba(248,113,113,0.1)" },
  disabledIcon: { backgroundColor: "rgba(255,255,255,0.04)" },
  label:        { flex: 1, color: C.text, fontSize: 14, fontWeight: "500" },
  dangerLabel:  { color: C.danger },
  disabledLabel:{ color: C.muted },
  right:        { flexDirection: "row", alignItems: "center", gap: 5 },
  value:        { color: C.muted, fontSize: 12 },
  comingSoon:   { color: C.dim, fontSize: 11, fontStyle: "italic" },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const { user, signOutUser } = useAuth();
  const { t, language, changeLanguage } = useLanguage();
  const { userData, onRefresh } = useProfileData(user);
  const router = useRouter();

  const safeUserData: UserProfile = userData ?? {
    email: user?.email ?? "",
    xp: 0,
    rating: 0,
    avatar: null,
    homeAddress: null,
    localisation: { latitude: null, longitude: null },
    ridesCompleted: 0,
    favorite: [],
  };

  const { name } = safeUserData;

  // ── Notification permission state ────────────────────────────────────────────
  const [notifStatus, setNotifStatus] = useState<string>("undetermined");
  const [notifModalVisible, setNotifModalVisible] = useState(false);
  const [notifEnabling, setNotifEnabling] = useState(false);

  useEffect(() => {
    Notifications.getPermissionsAsync()
      .then(({ status }) => setNotifStatus(status))
      .catch(() => {});
  }, []);

  const handleNotificationsPress = async (): Promise<void> => {
    const { status } = await Notifications.getPermissionsAsync();
    setNotifStatus(status);
    if (status === "granted" || status === "denied") {
      if (Platform.OS === "ios") {
        await Linking.openURL("app-settings:");
      }
    } else {
      setNotifModalVisible(true);
    }
  };

  const handleEnableNotifications = async (): Promise<void> => {
    if (!user) return;
    setNotifEnabling(true);
    try {
      setupNotificationChannel();
      const token = await registerForPushNotifications();
      if (token) {
        const idToken = await user.getIdToken();
        await savePushTokenToFirestore(user.uid, token, idToken);
      }
      const { status } = await Notifications.getPermissionsAsync();
      setNotifStatus(status);
    } catch (err) {
      console.warn("Enabling notifications failed:", err);
    } finally {
      setNotifEnabling(false);
      setNotifModalVisible(false);
    }
  };

  const handleDismissNotifModal = (): void => {
    setNotifModalVisible(false);
  };

  const {
    homeAddress,
    onHomeAddressChange,
    onSelectHomeSuggestion,
    homeSuggestions,
    showHomeSuggestions,
    errors,
    handleNewHomeAddress,
  } = useProfileFavorites({ user, userData, onRefresh });

  const handleLogout = async () => {
    try {
      await signOutUser();
      router.replace("/(auth)/login");
    } catch (err) {
      const authError = normalizeAuthError(err, t("profile.account.logoutFailed"));
      if (authError.retryable) {
        Alert.alert(authError.title, authError.message, [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.retry"), onPress: handleLogout },
        ]);
        return;
      }
      Alert.alert(authError.title, authError.message);
    }
  };

  return (
    <View style={styles.shell}>
      {/* Header */}
      <LinearGradient colors={["#1c0b2a", "#080810"]} style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={20} color={C.purpleLight} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Home Address */}
        <SectionHeader icon="home-outline" title={t("profile.sections.homeAddress")} />
        <View style={styles.card}>
          <View style={styles.inputWrapper}>
            <Ionicons name="location-outline" size={15} color={C.muted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={safeUserData.homeAddress ?? t("profile.homeAddress.placeholder")}
              placeholderTextColor={C.dim}
              value={homeAddress}
              onChangeText={onHomeAddressChange}
            />
          </View>
          {showHomeSuggestions && homeSuggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {homeSuggestions.map((item, index) => (
                <TouchableOpacity
                  key={item.placeId ?? index}
                  onPress={() => onSelectHomeSuggestion(item)}
                  style={[styles.suggestionItem, index === homeSuggestions.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <Ionicons name="location-outline" size={12} color={C.muted} style={{ marginRight: 8 }} />
                  <Text style={styles.suggestionText} numberOfLines={1}>{item.displayName}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {errors.startAddress && (
            <Text style={styles.errorText}>{errors.startAddress}</Text>
          )}
          {homeAddress ? (
            <Pressable style={styles.primaryBtn} onPress={handleNewHomeAddress}>
              <LinearGradient
                colors={["#FD165A", "#8938D5"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.primaryBtnGrad}
              >
                <Text style={styles.primaryBtnText}>
                  {safeUserData.homeAddress ? t("profile.homeAddress.updateBtn") : t("profile.homeAddress.saveBtn")}
                </Text>
              </LinearGradient>
            </Pressable>
          ) : null}
        </View>

        {/* Settings */}
        <SectionHeader icon="settings-outline" title={t("profile.sections.settings")} />
        <SettingsRow
          icon="person-outline"
          label={t("profile.settings.myProfile")}
          value={name || undefined}
          onPress={() =>
            router.push(
              `/profileSettings?name=${encodeURIComponent(name ?? "")}&birthDate=${encodeURIComponent(safeUserData.birthDate ?? "")}&school=${encodeURIComponent(safeUserData.school ?? "")}`,
            )
          }
        />
        <SettingsRow
          icon="notifications-outline"
          label={t("profile.settings.notifications")}
          value={
            notifStatus === "granted"
              ? t("profile.settings.notifEnabled")
              : notifStatus === "denied"
                ? t("profile.settings.notifDisabled")
                : undefined
          }
          onPress={() => { void handleNotificationsPress(); }}
        />
        <SettingsRow icon="lock-closed-outline" label={t("profile.settings.privacy")} onPress={() => router.push("/privacyScreen")} />
        <SettingsRow icon="help-circle-outline" label={t("profile.settings.helpSupport")} onPress={() => router.push("/helpSupportScreen")} />
        <SettingsRow icon="star-outline" label={t("profile.settings.rateApp")} disabled soonLabel={t("profile.soonBadge")} />
        <SettingsRow
          icon="globe-outline"
          label={t("profile.settings.language")}
          rightElement={
            <View style={{ flexDirection: "row", gap: 6 }}>
              {(["fr", "en"] as Language[]).map((lang) => (
                <TouchableOpacity
                  key={lang}
                  onPress={() => void changeLanguage(lang)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 8,
                    backgroundColor: language === lang ? "rgba(137,56,213,0.35)" : "rgba(255,255,255,0.06)",
                    borderWidth: 1,
                    borderColor: language === lang ? C.border : C.borderFaint,
                  }}
                >
                  <Text style={{ color: language === lang ? C.purpleLight : C.muted, fontSize: 12, fontWeight: "600" }}>
                    {lang === "fr" ? "FR" : "EN"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          }
        />

        {/* Account */}
        <SectionHeader icon="person-outline" title={t("profile.sections.account")} />
        <SettingsRow icon="log-out-outline" label={t("profile.account.logout")} onPress={handleLogout} danger />

        <View style={{ height: 40 }} />
      </ScrollView>

      <NotificationPromptModal
        visible={notifModalVisible}
        enabling={notifEnabling}
        onEnable={() => { void handleEnableNotifications(); }}
        onDismiss={handleDismissNotifModal}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell:   { flex: 1, backgroundColor: C.bg },
  header:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 56, paddingBottom: 16, paddingHorizontal: 16 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(224,154,247,0.1)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: "700", letterSpacing: 0.3 },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 20 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.borderFaint,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, paddingVertical: 12, fontSize: 14, color: C.text },
  errorText: { color: C.danger, fontSize: 12, marginTop: 6, marginLeft: 2 },
  primaryBtn:     { marginTop: 10, borderRadius: 10, overflow: "hidden" },
  primaryBtnGrad: { paddingVertical: 12, alignItems: "center" as const },
  primaryBtnText: { color: "#fff", fontWeight: "700" as const, fontSize: 14 },
  suggestionsContainer: {
    marginTop: 6,
    backgroundColor: "#13132a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
    marginBottom: 4,
  },
  suggestionItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  suggestionText: { color: C.text, fontSize: 14, flex: 1 },
});
