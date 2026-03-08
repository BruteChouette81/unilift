import { useAuth } from "@/context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import FavoriteRouteCard from "@/components/favorite-rides";
import FavoriteRouteForm from "@/components/favoriteForm";
import { PlannedRidesList } from "@/components/profile/planned-rides-list";

import { normalizeAuthError } from "@/services/authService";

import { useProfileAvatar } from "@/hooks/use-profile-avatar";
import { useProfileData } from "@/hooks/use-profile-data";
import { useProfileFavorites } from "@/hooks/use-profile-favorites";
import { useProfileRides } from "@/hooks/use-profile-rides";
import type { FavoriteRoute, UserProfile } from "@/types/models";

WebBrowser.maybeCompleteAuthSession();

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(124, 58, 237, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#7C3AED",
  purpleLight: "#a78bfa",
  blue:        "#1D4ED8",
  blueLight:   "#60a5fa",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
  gold:        "#fbbf24",
  success:     "#34d399",
};

const BANNER_GRADIENT  = ["#3b0764", "#1e3a8a"] as const;
const CARD_GRADIENT    = ["#1e1b4b", "#0d1224"] as const;
const XP_BAR_GRADIENT  = ["#7C3AED", "#2563eb"] as const;
const STAT_BG_GRADIENT = ["#1a1040", "#0f1730"] as const;

const MAX_XP = 600;

// ─── Section Header Component ──────────────────────────────────────────────────
function SectionHeader({
  icon,
  title,
  action,
  onAction,
}: {
  icon: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={sh.row}>
      <View style={sh.left}>
        <View style={sh.iconDot}>
          <Ionicons name={icon as any} size={14} color={C.purpleLight} />
        </View>
        <Text style={sh.title}>{title}</Text>
      </View>
      {action && (
        <TouchableOpacity style={sh.actionBtn} onPress={onAction}>
          <Text style={sh.actionText}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const sh = StyleSheet.create({
  row:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, marginTop: 24 },
  left:      { flexDirection: "row", alignItems: "center", gap: 8 },
  iconDot:   { width: 26, height: 26, borderRadius: 7, backgroundColor: "rgba(167,139,250,0.12)", alignItems: "center", justifyContent: "center" },
  title:     { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
  actionBtn: { backgroundColor: "rgba(124,58,237,0.18)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: C.border },
  actionText:{ color: C.purpleLight, fontSize: 12, fontWeight: "600" },
});

// ─── Settings Row Component ────────────────────────────────────────────────────
function SettingsRow({
  icon,
  label,
  value,
  onPress,
  danger,
  disabled,
  rightElement,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  rightElement?: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      style={[sr.row, danger && sr.dangerRow, disabled && sr.disabledRow]}
      onPress={disabled ? undefined : (onPress ?? (() => {}))}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <View style={[sr.iconWrap, danger && sr.dangerIcon, disabled && sr.disabledIcon]}>
        <Ionicons name={icon as any} size={17} color={disabled ? C.dim : danger ? C.danger : C.purpleLight} />
      </View>
      <Text style={[sr.label, danger && sr.dangerLabel, disabled && sr.disabledLabel]}>{label}</Text>
      <View style={sr.right}>
        {rightElement ?? (
          <>
            {value && !disabled && <Text style={sr.value}>{value}</Text>}
            {disabled
              ? <Text style={sr.comingSoon}>Soon</Text>
              : <Ionicons name="chevron-forward" size={15} color={danger ? C.danger : C.dim} />
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
  iconWrap:     { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(167,139,250,0.1)", alignItems: "center", justifyContent: "center", marginRight: 12 },
  dangerIcon:   { backgroundColor: "rgba(248,113,113,0.1)" },
  disabledIcon: { backgroundColor: "rgba(255,255,255,0.04)" },
  label:        { flex: 1, color: C.text, fontSize: 14, fontWeight: "500" },
  dangerLabel:  { color: C.danger },
  disabledLabel:{ color: C.muted },
  right:        { flexDirection: "row", alignItems: "center", gap: 5 },
  value:        { color: C.muted, fontSize: 12 },
  comingSoon:   { color: C.dim, fontSize: 11, fontStyle: "italic" },
});

// ─── Quick Action Button ───────────────────────────────────────────────────────
function QuickAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={qa.wrap} onPress={onPress} activeOpacity={0.7}>
      <LinearGradient colors={CARD_GRADIENT} style={qa.icon}>
        <Ionicons name={icon as any} size={20} color={C.purpleLight} />
      </LinearGradient>
      <Text style={qa.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const qa = StyleSheet.create({
  wrap:  { alignItems: "center", flex: 1, gap: 6 },
  icon:  { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  label: { color: C.muted, fontSize: 11, fontWeight: "500" },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────
const ProfileScreen = () => {
  const { user, loading, signOutUser } = useAuth();
  const { userData, rides, refreshing, onRefresh } = useProfileData(user);
  const { pickImage } = useProfileAvatar({
    user,
    onUploaded: async () => {
      alert("Profile picture updated!");
      await onRefresh();
    },
  });

  const router = useRouter();

  const handleLogout = async () => {
    try {
      await signOutUser();
      router.replace("/(auth)/login");
    } catch (err) {
      const authError = normalizeAuthError(err, "Logout failed");
      if (authError.retryable) {
        Alert.alert(authError.title, authError.message, [
          { text: "Cancel", style: "cancel" },
          { text: "Retry", onPress: handleLogout },
        ]);
        return;
      }
      Alert.alert(authError.title, authError.message);
    }
  };

  const { startRide, cancelRide } = useProfileRides({
    user,
    onRefresh,
    onRideStarted: ({ rideId, originLat, originLng, destination }) => {
      router.push(
        `/rideScreen?rideId=${rideId}&Originlat=${originLat}&OriginLng=${originLng}&Destination=${destination}`,
      );
    },
  });

  const {
    modifyFavorite,
    setModifyFavorite,
    initialData,
    setInitialData,
    homeAddress,
    setHomeAddress,
    errors,
    handleNewHomeAddress,
    handleFavoriteSubmit,
    handleFavoriteDelete,
  } = useProfileFavorites({ user, userData, onRefresh });

  // ── Placeholder handlers for upcoming features ────────────────────────────
  const handleEditProfile    = () => Alert.alert("Coming Soon", "Edit profile is under development.");
  const handleShareProfile   = () => Alert.alert("Coming Soon", "Share profile is under development.");
  const handleNotifications  = () => Alert.alert("Coming Soon", "Notification settings are under development.");
  const handlePrivacy        = () => Alert.alert("Coming Soon", "Privacy settings are under development.");
  const handleLinkedAccounts = () => Alert.alert("Coming Soon", "Linked accounts are under development.");
  const handleHelp           = () => Alert.alert("Coming Soon", "Help & Support is under development.");
  const handleRateApp        = () => Alert.alert("Coming Soon", "Rate app feature is under development.");
  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={C.purpleLight} />
        <Text style={styles.loadingText}>Loading profile…</Text>
      </View>
    );
  }

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

  const { name, xp, ridesCompleted, rating, email } = safeUserData;
  const level       = Math.floor(xp / 100) + 1;
  const levelXp     = xp % 100;
  const progress    = Math.min((levelXp / 100) * 100, 100);
  const displayName = name || email?.split("@")[0];

  if (modifyFavorite) {
    return (
      <FavoriteRouteForm
        initialData={initialData}
        onSubmit={handleFavoriteSubmit}
        onCancel={() => setModifyFavorite(false)}
        onDelete={handleFavoriteDelete}
      />
    );
  }

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={C.purpleLight}
        />
      }
    >
      {/* ── Avatar + Info ───────────────────────────────────────────────────── */}
      <View style={styles.avatarSection}>
        <View style={styles.avatarRow}>
          <TouchableOpacity onPress={pickImage} style={styles.avatarWrap}>
            <Image
              source={{
                uri:
                  safeUserData.avatar ||
                  "https://www.macfcu.org/wp-content/uploads/2024/02/Windows_10_Default_Profile_Picture.svg.png",
              }}
              style={styles.avatar}
            />
            <View style={styles.avatarCamera}>
              <Ionicons name="camera" size={11} color="#fff" />
            </View>
          </TouchableOpacity>

          <View style={styles.levelPill}>
            <Ionicons name="flash" size={12} color={C.gold} />
            <Text style={styles.levelPillText}>Level {level}</Text>
          </View>
        </View>

        <View style={styles.nameRow}>
          <Text style={styles.displayName}>{displayName}</Text>
          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={16} color={C.purpleLight} />
          </View>
        </View>
        <Text style={styles.emailText}>{email}</Text>

        {/* Stats */}
        <LinearGradient colors={STAT_BG_GRADIENT} style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{ridesCompleted}</Text>
            <Text style={styles.statLabel}>Rides</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: C.gold }]}>
              {typeof rating === "number" ? rating.toFixed(1) : rating}
            </Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: C.purpleLight }]}>{xp}</Text>
            <Text style={styles.statLabel}>Total XP</Text>
          </View>
        </LinearGradient>
      </View>

      <View style={styles.content}>
        {/* ── XP Progress Card ─────────────────────────────────────────────── */}
        <LinearGradient colors={CARD_GRADIENT} style={styles.xpCard}>
          <View style={styles.xpTop}>
            <View>
              <Text style={styles.xpTitle}>Level {level}</Text>
              <Text style={styles.xpSub}>{100 - levelXp} XP to Level {level + 1}</Text>
            </View>
            <View style={styles.xpBadge}>
              <Ionicons name="trophy-outline" size={14} color={C.gold} />
              <Text style={styles.xpBadgeText}>{xp} XP</Text>
            </View>
          </View>
          <View style={styles.xpTrack}>
            <LinearGradient
              colors={XP_BAR_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.xpFill, { width: `${progress}%` }]}
            />
          </View>
          <View style={styles.xpFooter}>
            <Text style={styles.xpFooterText}>Lv. {level}</Text>
            <Text style={styles.xpFooterText}>{levelXp} / 100 XP</Text>
            <Text style={styles.xpFooterText}>Lv. {level + 1}</Text>
          </View>
        </LinearGradient>

        {/* ── Upcoming Rides ───────────────────────────────────────────────── */}
        {rides && (
          <>
            <SectionHeader icon="car-outline" title="Upcoming Rides" />
            <PlannedRidesList
              rides={rides}
              onStartRide={startRide}
              onCancelRide={cancelRide}
              driverId={user?.uid}
            />
          </>
        )}

        {/* ── Home Address ─────────────────────────────────────────────────── */}
        <SectionHeader icon="home-outline" title="Home Address" />
        <View style={styles.card}>
          <View style={styles.inputWrapper}>
            <Ionicons name="location-outline" size={17} color={C.dim} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={safeUserData.homeAddress ?? "Add your home address…"}
              placeholderTextColor={C.dim}
              value={homeAddress}
              onChangeText={setHomeAddress}
            />
          </View>
          {errors.startAddress && (
            <Text style={styles.errorText}>{errors.startAddress}</Text>
          )}
          {homeAddress ? (
            <Pressable style={styles.primaryBtn} onPress={handleNewHomeAddress}>
              <LinearGradient
                colors={["#7C3AED", "#2563eb"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.primaryBtnGrad}
              >
                <Text style={styles.primaryBtnText}>
                  {safeUserData.homeAddress ? "Update Address" : "Save Address"}
                </Text>
              </LinearGradient>
            </Pressable>
          ) : null}
        </View>

        {/* ── Favorites ────────────────────────────────────────────────────── */}
        <SectionHeader
          icon="star-outline"
          title="Favorites"
          action="+ New"
          onAction={() => {
            setModifyFavorite(true);
            setInitialData(undefined);
          }}
        />

        {safeUserData.favorite && safeUserData.favorite.length > 0 ? (
          safeUserData.favorite.map((route: FavoriteRoute, index: number) => (
            <FavoriteRouteCard
              key={index}
              destination={route.destination}
              onPress={() => {
                setModifyFavorite(true);
                setInitialData({
                  endGeolocation: {
                    lat: route.destinationGeo.lat,
                    lon: route.destinationGeo.lon,
                  },
                  endAddress: route.destination,
                  id: index,
                });
              }}
            />
          ))
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="star-outline" size={26} color={C.purple} />
            </View>
            <Text style={styles.emptyTitle}>No favorites yet</Text>
            <Text style={styles.emptySubtext}>
              Save your go-to destinations for quick access
            </Text>
            <Pressable
              style={styles.emptyAction}
              onPress={() => {
                setModifyFavorite(true);
                setInitialData(undefined);
              }}
            >
              <Text style={styles.emptyActionText}>Add your first favorite</Text>
            </Pressable>
          </View>
        )}

        {/* ── Settings ─────────────────────────────────────────────────────── */}
        <SectionHeader icon="settings-outline" title="Settings" />
        <SettingsRow
          icon="person-outline"
          label="My Profile"
          value={name || undefined}
          onPress={() =>
            router.push(
              `/profileSettings?name=${encodeURIComponent(name ?? "")}&age=${safeUserData.age ?? ""}&school=${encodeURIComponent(safeUserData.school ?? "")}&prefs=${encodeURIComponent((safeUserData.preferences ?? []).join(","))}`,
            )
          }
        />
        <SettingsRow icon="notifications-outline"     label="Notifications"    disabled />
        <SettingsRow icon="lock-closed-outline"       label="Privacy"          disabled />
        <SettingsRow icon="link-outline"              label="Linked Accounts"  disabled />
        <SettingsRow icon="help-circle-outline"       label="Help & Support"   disabled />
        <SettingsRow icon="star-half-outline"         label="Rate Unilift"     disabled />

        {/* ── Account / Logout ─────────────────────────────────────────────── */}
        <SectionHeader icon="person-circle-outline" title="Account" />
        <SettingsRow icon="log-out-outline" label="Log Out" onPress={handleLogout} danger />

        <View style={{ height: 32 }} />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  // ── Loading ──────────────────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { color: C.muted, fontSize: 14 },

  // ── Shell ────────────────────────────────────────────────────────────────
  container: { flex: 1, backgroundColor: C.bg },
  content:   { paddingHorizontal: 16, paddingBottom: 20 },

  // ── Banner ───────────────────────────────────────────────────────────────
  banner: {
    height: 148,
    position: "relative",
  },
  bannerNoise: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  bannerActions: {
    position: "absolute",
    top: 14,
    right: 14,
    flexDirection: "row",
    gap: 8,
  },
  bannerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },

  // ── Avatar Section ───────────────────────────────────────────────────────
  avatarSection: {
    backgroundColor: C.surface,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: C.borderFaint,
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  avatarWrap: { position: "relative" },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: C.surface,
  },
  avatarCamera: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.purple,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.surface,
  },
  levelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(251,191,36,0.1)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.25)",
  },
  levelPillText: { color: C.gold, fontWeight: "700", fontSize: 12 },

  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 3,
  },
  displayName: { color: C.text, fontSize: 21, fontWeight: "700" },
  verifiedBadge: {},
  emailText: { color: C.muted, fontSize: 12, marginBottom: 14 },

  // Stats
  statsCard: {
    flexDirection: "row",
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  statItem:    { flex: 1, alignItems: "center" },
  statDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.08)" },
  statValue:   { color: C.text, fontSize: 19, fontWeight: "700" },
  statLabel:   { color: C.muted, fontSize: 10, marginTop: 2, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.5 },

  // ── XP Card ──────────────────────────────────────────────────────────────
  xpCard: {
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  xpTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  xpTitle: { color: C.text, fontSize: 16, fontWeight: "700" },
  xpSub:   { color: C.muted, fontSize: 12, marginTop: 2 },
  xpBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(251,191,36,0.1)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.22)",
  },
  xpBadgeText: { color: C.gold, fontWeight: "700", fontSize: 12 },
  xpTrack: {
    height: 7,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 4,
    overflow: "hidden",
  },
  xpFill: { height: "100%", borderRadius: 4 },
  xpFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 7,
  },
  xpFooterText: { color: C.dim, fontSize: 10 },

  // ── Quick Actions ─────────────────────────────────────────────────────────
  quickRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
  },

  // ── Card ─────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.borderFaint,
  },

  // ── Input ─────────────────────────────────────────────────────────────────
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
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    color: C.text,
  },
  errorText: { color: C.danger, fontSize: 12, marginTop: 6, marginLeft: 2 },

  // ── Primary Button ────────────────────────────────────────────────────────
  primaryBtn: { marginTop: 10, borderRadius: 10, overflow: "hidden" },
  primaryBtnGrad: { paddingVertical: 12, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  // ── Empty State ───────────────────────────────────────────────────────────
  emptyState: {
    alignItems: "center",
    paddingVertical: 28,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.borderFaint,
    gap: 5,
  },
  emptyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "rgba(124,58,237,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyTitle:   { color: C.text, fontSize: 14, fontWeight: "600" },
  emptySubtext: { color: C.dim, fontSize: 12, textAlign: "center", paddingHorizontal: 32 },
  emptyAction: {
    marginTop: 8,
    backgroundColor: "rgba(124,58,237,0.18)",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyActionText: { color: C.purpleLight, fontSize: 13, fontWeight: "600" },
});

export default ProfileScreen;
