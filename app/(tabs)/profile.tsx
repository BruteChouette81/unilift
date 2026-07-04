import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";

import FavoriteRouteCard from "@/components/favorite-rides";
import InfoButton from "@/components/info-button";
import { PassengerRidesList } from "@/components/profile/passenger-rides-list";
import { PlannedRidesList } from "@/components/profile/planned-rides-list";
import { InterestedEventsList } from "@/components/profile/interested-events-list";

import { useProfileAvatar } from "@/hooks/use-profile-avatar";
import { useProfileData } from "@/hooks/use-profile-data";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { useProfileRides } from "@/hooks/use-profile-rides";
import type { FavoriteRoute, StartRidePayload, UserProfile } from "@/types/models";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  blue:        "#FD165A",
  blueLight:   "#ff6b9d",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
  gold:        "#fbbf24",
  success:     "#34d399",
};

const CARD_GRADIENT    = ["#1c0b2a", "#0d0518"] as const;
const XP_BAR_GRADIENT  = ["#FD165A", "#8938D5"] as const;

// ─── Section Header Component ──────────────────────────────────────────────────
function SectionHeader({
  icon,
  title,
  action,
  onAction,
  infoTitle,
  infoBody,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  action?: string;
  onAction?: () => void;
  infoTitle?: string;
  infoBody?: string;
}) {
  return (
    <View style={sh.row}>
      <View style={sh.left}>
        <View style={sh.iconDot}>
          <Ionicons name={icon} size={13} color={C.purpleLight} />
        </View>
        <Text style={sh.title}>{title}</Text>
        {infoTitle && infoBody && (
          <InfoButton title={infoTitle} body={infoBody} />
        )}
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
  iconDot:   { width: 26, height: 26, borderRadius: 7, backgroundColor: "rgba(224,154,247,0.12)", alignItems: "center", justifyContent: "center" },
  title:     { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
  actionBtn: { backgroundColor: "rgba(137,56,213,0.18)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: C.border },
  actionText:{ color: C.purpleLight, fontSize: 12, fontWeight: "600" },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────
const ProfileScreen = () => {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const { userData, rides, refreshing, onRefresh } = useProfileData(user);
  const [cardExpanded, setCardExpanded] = useState(false);

  // Re-sync profile + rides when returning to the tab or foregrounding the app.
  useLiveRefresh(onRefresh);

  const toggleCard = () => {
    LayoutAnimation.configureNext({
      duration: 260,
      create:  { type: "easeInEaseOut", property: "opacity" },
      update:  { type: "spring", springDamping: 0.85 },
      delete:  { type: "easeInEaseOut", property: "opacity" },
    });
    setCardExpanded(prev => !prev);
  };

  const { pickImage, uploading } = useProfileAvatar({
    user,
    onUploaded: async () => {
      alert(t("profile.avatarUpdated"));
      await onRefresh();
    },
  });

  const router = useRouter();

  const { cancelRide } = useProfileRides({
    user,
    onRefresh,
    onRideStarted: () => {},
  });

  const manageRide = useCallback(
    (rideId: string, payload: StartRidePayload) => {
      router.push(
        `/riderScreen?rideId=${rideId}&Originlat=${payload.originLat}&OriginLng=${payload.originLng}&Destination=${encodeURIComponent(payload.destination)}&DestinationLat=${payload.destinationLat}&DestinationLng=${payload.destinationLng}`,
      );
    },
    [router],
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={C.purpleLight} />
        <Text style={styles.loadingText}>{t("profile.loading")}</Text>
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

  return (
    <View style={styles.shell}>
      <Modal transparent visible={uploading} animationType="fade">
        <View style={styles.uploadingOverlay}>
          <View style={styles.uploadingCard}>
            <ActivityIndicator size="large" color={C.purpleLight} />
            <Text style={styles.uploadingText}>{t("profile.uploadingAvatar")}</Text>
          </View>
        </View>
      </Modal>

      {/* ── Floating Settings Button ─────────────────────────────────────────── */}
      <View style={styles.settingsBtnRow} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push("/settingsScreen")}
          activeOpacity={0.7}
        >
          <Ionicons name="settings-outline" size={20} color={C.purpleLight} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.purpleLight} />
        }
      >
        <View style={styles.content}>

          {/* ── Floating Profile Glass Card ──────────────────────────────────── */}
          <Pressable onPress={toggleCard} style={styles.glassCard}>
            <LinearGradient
              colors={["rgba(38,12,62,0.97)", "rgba(11,4,22,0.96)"]}
              style={styles.glassCardInner}
            >
              {/* Header row: avatar + identity + chevron */}
              <View style={styles.cardHeader}>
                <TouchableOpacity onPress={pickImage} style={styles.avatarWrap} hitSlop={8}>
                  <Image
                    source={{
                      uri:
                        safeUserData.avatar ||
                        "https://www.macfcu.org/wp-content/uploads/2024/02/Windows_10_Default_Profile_Picture.svg.png",
                    }}
                    style={styles.avatar}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                  <View style={styles.avatarCamera}>
                    <Ionicons name="camera" size={9} color="#fff" />
                  </View>
                </TouchableOpacity>

                <View style={styles.identityBlock}>
                  <View style={styles.nameRow}>
                    <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>
                    {safeUserData.facebookId ? (
                      <Ionicons name="checkmark-circle" size={16} color="#34d399" />
                    ) : null}
                  </View>
                  <Text style={styles.emailText} numberOfLines={1}>{email}</Text>
                  <View style={styles.levelPill}>
                    <Ionicons name="flash" size={10} color={C.gold} />
                    <Text style={styles.levelPillText}>{t("profile.level", { level })}</Text>
                  </View>
                </View>

                <Ionicons
                  name={cardExpanded ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={C.purpleLight}
                  style={styles.cardChevron}
                />
              </View>

              {/* Stats row (always visible) */}
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{ridesCompleted}</Text>
                  <Text style={styles.statLabel}>{t("profile.stats.rides")}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: C.gold }]}>
                    {typeof rating === "number" ? rating.toFixed(1) : rating}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                    <Text style={styles.statLabel}>{t("profile.stats.rating")}</Text>
                    <InfoButton
                      title={t("profile.info.rating.title")}
                      body={t("profile.info.rating.body")}
                    />
                  </View>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: C.purpleLight }]}>{xp}</Text>
                  <Text style={styles.statLabel}>{t("profile.stats.totalXp")}</Text>
                </View>
              </View>

              {/* Expanded content */}
              {cardExpanded && (
                <View style={styles.expandedContent}>
                  <View style={styles.expandDivider} />

                  {/* XP Progress */}
                  <View style={styles.xpSection}>
                    <View style={styles.xpTop}>
                      <View>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <Text style={styles.xpTitle}>{t("profile.level", { level })}</Text>
                          <InfoButton
                            title={t("profile.info.xp.title")}
                            body={t("profile.info.xp.body")}
                            style={{ marginLeft: 6 }}
                          />
                        </View>
                        <Text style={styles.xpSub}>{t("profile.xpToNext", { xp: 100 - levelXp, next: level + 1 })}</Text>
                      </View>
                      <View style={styles.xpBadge}>
                        <Ionicons name="trophy" size={12} color={C.gold} />
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
                      <Text style={styles.xpFooterText}>{t("profile.levelShort", { level })}</Text>
                      <Text style={styles.xpFooterText}>{t("profile.xpProgress", { current: levelXp })}</Text>
                      <Text style={styles.xpFooterText}>{t("profile.levelShort", { level: level + 1 })}</Text>
                    </View>
                  </View>

                  {/* Rewards banner */}
                  <Pressable
                    onPress={() => router.push("/rewardsScreen")}
                    style={styles.rewardsBanner}
                  >
                    <LinearGradient
                      colors={["rgba(45,15,10,0.9)", "rgba(22,5,30,0.9)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.rewardsBannerGrad}
                    >
                      <View style={styles.rewardsBannerLeft}>
                        <View style={styles.rewardsTrophyWrap}>
                          <Ionicons name="trophy" size={20} color={C.gold} />
                        </View>
                        <View>
                          <Text style={styles.rewardsBannerTitle}>{t("rewards.bannerTitle")}</Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={C.purpleLight} />
                    </LinearGradient>
                  </Pressable>
                </View>
              )}

              {/* Bottom accent line */}
              <LinearGradient
                colors={["#FD165A", "#8938D5"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.cardAccentLine}
              />
            </LinearGradient>
          </Pressable>

          {/* ── Driver Mode Glass Card ───────────────────────────────────────── */}
          {(() => {
            const driverOn = !!(safeUserData.driverDays && safeUserData.driverDays.length > 0);
            const accent   = driverOn ? "#4ade80" : "#6b7280";
            const accentFaint = driverOn ? "rgba(74,222,128,0.18)" : "rgba(107,114,128,0.12)";
            const accentBorder = driverOn ? "rgba(74,222,128,0.3)" : "rgba(107,114,128,0.22)";
            const bgGrad = driverOn
              ? ["rgba(18,32,14,0.97)", "rgba(8,14,6,0.96)"] as const
              : ["rgba(18,18,22,0.97)", "rgba(8,8,12,0.96)"] as const;
            const accentGrad = driverOn
              ? ["#4ade80", "#16a34a"] as const
              : ["#4b5563", "#374151"] as const;
            return (
              <Pressable
                onPress={() => router.push("/driverModeScreen")}
                style={[styles.driverCard, { borderColor: accentBorder, shadowColor: accent }]}
              >
                <LinearGradient colors={bgGrad} style={styles.driverCardInner}>
                  <View style={styles.driverCardRow}>
                    <View style={[styles.driverIconWrap, { backgroundColor: accentFaint, borderColor: driverOn ? "rgba(74,222,128,0.25)" : "rgba(107,114,128,0.2)" }]}>
                      <Ionicons name="car-outline" size={22} color={accent} />
                    </View>
                    <View style={styles.driverInfo}>
                      <Text style={styles.driverTitle}>{t("profile.settings.driverMode")}</Text>
                      <Text style={[styles.driverStatus, { color: driverOn ? "rgba(74,222,128,0.8)" : "#6b7280" }]}>
                        {driverOn
                          ? t("driverMode.activeDays", { count: safeUserData.driverDays!.length })
                          : t("driverMode.off")}
                      </Text>
                    </View>
                    <View style={[styles.driverBadge, driverOn && styles.driverBadgeActive]}>
                      <Text style={[styles.driverBadgeText, driverOn && styles.driverBadgeTextActive]}>
                        {driverOn ? "ON" : "OFF"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={driverOn ? "rgba(74,222,128,0.5)" : "rgba(107,114,128,0.5)"} style={{ marginLeft: 6 }} />
                  </View>
                  <LinearGradient
                    colors={accentGrad}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.driverAccentLine}
                  />
                </LinearGradient>
              </Pressable>
            );
          })()}

          {/* ── My Drives (as driver) ─────────────────────────────────────────── */}
          {rides && rides.some((r) => r.driverId === user?.uid && r.status === "planned") && (
            <>
              <SectionHeader icon="car-outline" title={t("rides.myDrives")} />
              <PlannedRidesList
                rides={rides}
                onManageRide={manageRide}
                onCancelRide={cancelRide}
                driverId={user?.uid}
              />
            </>
          )}

          {/* ── My Rides (ride history as passenger) ─────────────────────────── */}
          {user && (
            <>
              <SectionHeader icon="bag-outline" title={t("rides.myRides")} />
              <PassengerRidesList
                rides={rides ?? []}
                userId={user.uid}
              />
            </>
          )}

          {/* ── Interested Events ────────────────────────────────────────────── */}
          <SectionHeader icon="flame-outline" title={t("hypeEvent.savedTitle")} />
          <InterestedEventsList />

          {/* ── Favorites ────────────────────────────────────────────────────── */}
          <SectionHeader
            icon="star-outline"
            title={t("profile.sections.favorites")}
            action={t("profile.favorites.new")}
            onAction={() => router.push("/favoriteScreen")}
            infoTitle={t("profile.info.favorites.title")}
            infoBody={t("profile.info.favorites.body")}
          />

          {safeUserData.favorite && safeUserData.favorite.length > 0 ? (
            safeUserData.favorite.map((route: FavoriteRoute, index: number) => (
              <FavoriteRouteCard
                key={index}
                destination={route.destination}
                onPress={() =>
                  router.push(
                    `/favoriteScreen?id=${index}&endAddress=${encodeURIComponent(route.destination)}&endLat=${route.destinationGeo.lat}&endLon=${route.destinationGeo.lon}`,
                  )
                }
              />
            ))
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="star" size={24} color={C.purpleLight} />
              </View>
              <Text style={styles.emptyTitle}>{t("profile.favorites.empty")}</Text>
              <Text style={styles.emptySubtext}>{t("profile.favorites.emptySub")}</Text>
              <Pressable
                style={styles.emptyAction}
                onPress={() => router.push("/favoriteScreen")}
              >
                <Text style={styles.emptyActionText}>{t("profile.favorites.addFirst")}</Text>
              </Pressable>
            </View>
          )}

          <View style={{ height: 100 }} />
        </View>
      </ScrollView>
    </View>
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
  shell:     { flex: 1, backgroundColor: C.bg },
  container: { flex: 1 },
  content:   { paddingHorizontal: 16, paddingTop: 64, paddingBottom: 20 },

  // ── Floating Settings Button ──────────────────────────────────────────────
  settingsBtnRow: {
    position: "absolute",
    top: 14,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingRight: 18,
  },
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(8,8,16,0.55)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.35)",
  },

  // ── Glass Profile Card ────────────────────────────────────────────────────
  glassCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.4)",
    overflow: "hidden",
    marginTop: 4,
    marginBottom: 4,
    shadowColor: "#8938D5",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 22,
    elevation: 14,
  },
  glassCardInner: {
    padding: 18,
  },

  // Card header row
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 16,
  },
  avatarWrap:   { position: "relative" },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: "rgba(137, 56, 213, 0.5)",
  },
  avatarCamera: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.purple,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(38,12,62,1)",
  },
  identityBlock: { flex: 1 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  displayName: { color: C.text, fontSize: 19, fontWeight: "700", flexShrink: 1 },
  emailText:   { color: C.muted, fontSize: 11, marginBottom: 7 },
  levelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: "rgba(251,191,36,0.1)",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.28)",
  },
  levelPillText: { color: C.gold, fontWeight: "700", fontSize: 11 },
  cardChevron:   { marginLeft: "auto" },

  // Stats row
  statsRow: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  statItem:    { flex: 1, alignItems: "center" },
  statDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.08)" },
  statValue:   { color: C.text, fontSize: 18, fontWeight: "700" },
  statLabel:   { color: C.muted, fontSize: 9, marginTop: 2, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.5 },

  // Expanded content
  expandedContent: {},
  expandDivider: {
    height: 1,
    backgroundColor: "rgba(137, 56, 213, 0.18)",
    marginVertical: 16,
  },

  // XP section
  xpSection: { marginBottom: 14 },
  xpTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  xpTitle: { color: C.text, fontSize: 15, fontWeight: "700" },
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
    height: 6,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 3,
    overflow: "hidden",
  },
  xpFill:       { height: "100%", borderRadius: 3 },
  xpFooter:     { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  xpFooterText: { color: C.dim, fontSize: 10 },

  // Rewards banner inside card
  rewardsBanner: { borderRadius: 12, overflow: "hidden" },
  rewardsBannerGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.22)",
    borderRadius: 12,
  },
  rewardsBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  rewardsTrophyWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(251,191,36,0.1)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.2)",
  },
  rewardsBannerTitle: { color: C.text, fontSize: 13, fontWeight: "700", marginBottom: 1 },
  rewardsBannerSub:   { color: C.muted, fontSize: 11, lineHeight: 15 },

  // Bottom accent line
  cardAccentLine: {
    height: 2,
    borderRadius: 1,
    marginTop: 16,
    marginHorizontal: -18,
  },

  // ── Driver Mode Card ─────────────────────────────────────────────────────
  driverCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.3)",
    overflow: "hidden",
    marginTop: 10,
    marginBottom: 4,
    shadowColor: "#4ade80",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  driverCardInner: { paddingVertical: 14, paddingHorizontal: 18 },
  driverCardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  driverIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(74,222,128,0.1)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.25)",
  },
  driverInfo:  { flex: 1 },
  driverTitle: { color: "#f3f4f6", fontSize: 14, fontWeight: "700" },
  driverStatus:{ color: "rgba(74,222,128,0.7)", fontSize: 12, marginTop: 2 },
  driverBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  driverBadgeActive: {
    backgroundColor: "rgba(74,222,128,0.12)",
    borderColor: "rgba(74,222,128,0.35)",
  },
  driverBadgeText:       { color: "#6b7280", fontSize: 11, fontWeight: "700" },
  driverBadgeTextActive: { color: "#4ade80" },
  driverAccentLine: {
    height: 2,
    borderRadius: 1,
    marginTop: 14,
    marginHorizontal: -18,
  },

  // ── Sections ─────────────────────────────────────────────────────────────
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
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    color: C.text,
  },
  errorText: { color: C.danger, fontSize: 12, marginTop: 6, marginLeft: 2 },

  primaryBtn:     { marginTop: 10, borderRadius: 10, overflow: "hidden" },
  primaryBtnGrad: { paddingVertical: 12, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

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
    backgroundColor: "rgba(137,56,213,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyTitle:      { color: C.text, fontSize: 14, fontWeight: "600" },
  emptySubtext:    { color: C.dim, fontSize: 12, textAlign: "center", paddingHorizontal: 32 },
  emptyAction: {
    marginTop: 8,
    backgroundColor: "rgba(137,56,213,0.18)",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyActionText: { color: C.purpleLight, fontSize: 13, fontWeight: "600" },

  // ── Upload Overlay ────────────────────────────────────────────────────────
  uploadingOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadingCard: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 28,
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: C.border,
    minWidth: 180,
  },
  uploadingText: { color: C.text, fontSize: 14, fontWeight: "600" },

  // ── Facebook / Suggestions (unused stubs kept for type-safety) ────────────
  fbConnectBtn:          { borderRadius: 12, overflow: "hidden" },
  fbConnectGrad:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 20 },
  fbConnectText:         { color: "#fff", fontSize: 14, fontWeight: "700" },
  fbConnectGradDisabled: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 20, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  fbConnectTextDisabled: { color: "rgba(255,255,255,0.35)", fontSize: 14, fontWeight: "700" as const },
  fbSoonBadge:           { backgroundColor: "rgba(137,56,213,0.35)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  fbSoonText:            { color: "#c084fc", fontSize: 11, fontWeight: "700" as const },
  fbConnectedRow:        { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(24,119,242,0.08)", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "rgba(24,119,242,0.25)" },
  fbIconWrap:            { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  fbNameRow:             { flexDirection: "row", alignItems: "center", gap: 6 },
  fbName:                { color: C.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  fbVerifiedBadge:       { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(52,211,153,0.12)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  fbVerifiedText:        { color: "#34d399", fontSize: 10, fontWeight: "700" },
  fbConnectedLabel:      { color: "rgba(24,119,242,0.8)", fontSize: 11, marginTop: 2 },
  fbDisconnectBtn:       { padding: 6 },
  suggestionsContainer: {
    marginTop: 6,
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    overflow: "hidden",
    marginBottom: 4,
  },
  suggestionItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
  },
  suggestionText: {
    color: C.text,
    fontSize: 14,
    flex: 1,
  },
});

export default ProfileScreen;
