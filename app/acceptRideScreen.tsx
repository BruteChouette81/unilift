import { acceptRideRequest } from "@/services/driverSessionService";
import { fetchRideRequestById } from "@/services/rideRequestService";
import { fetchPublicProfile, type PublicProfile } from "@/services/publicProfileService";
import { getMultiWaypointRoute } from "@/services/routeService";
import CertBadges from "@/components/cert-badges";
import { DriverRideMapView } from "@/components/mapview";
import { useLanguage } from "@/context/LanguageContext";
import { haversineKm } from "@/hooks/use-ride-recommendations";
import type { LocationPoint } from "@/types/models";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { devAwareCurrentPosition } from "@/utils/dev-location";
import { isDev } from "@/constants/runtime-config";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsive } from "@/hooks/use-responsive";
import { FONT_CAP } from "@/constants/typography";
import { P } from "@/constants/palette";

// The cross-user view of a person is `users/{uid}/public/profile` — see
// services/publicProfileService.ts. The local type and decoder that used to live
// here read `users/{uid}` directly, which is now owner-only: it carried the other
// person's email and birth date into a screen that only ever rendered their name,
// avatar, rating and badges.
type PassengerProfile = PublicProfile;


const C = {
  bg:          P.bg,
  border:      "rgba(137, 56, 213, 0.30)",
  purple:      P.accent,
  purpleLight: P.accentLight,
  text:        P.text,
  muted:       P.textMuted,
  dim:         P.textDim,
  danger:      P.danger,
  success:     P.success,
};

/** Format cents as fr-CA: 525 → "+5,25 $" */
function formatFrCA(cents: number): string {
  return `+${(cents / 100).toFixed(2).replace(".", ",")} $`;
}

export default function AcceptRideScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isNarrow, shouldStack, panelMaxHeight } = useResponsive();
  const { t } = useLanguage();
  const params = useLocalSearchParams<{
    requestId: string;
    riderId: string;
    destination: string;
    fare: string;
    origin: string;
    rideKm: string;
    seats: string;
    driverDest: string;
    driverDestLat: string;
    driverDestLng: string;
  }>();

  const [riderName, setRiderName] = useState<string | null>(null);
  const [riderAvatar, setRiderAvatar] = useState<string | null>(null);
  // Full passenger profile for the extended view the driver can open before
  // committing to (or starting) the ride.
  const [profile, setProfile] = useState<PassengerProfile | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [accepting, setAccepting] = useState(false);
  // Verify the request is still claimable on open (handles a deep link tapped
  // after the request was already taken/cancelled, incl. cold start).
  const [unavailable, setUnavailable] = useState(false);

  // Map coords: passenger pickup + drop-off (fetched) and the driver's own start
  // (live GPS). With these three points we can plot the trip on the map and show
  // the total distance driver → pickup → drop-off.
  const [pickup, setPickup] = useState<LocationPoint | null>(null);
  const [dropoff, setDropoff] = useState<LocationPoint | null>(null);
  const [driverOrigin, setDriverOrigin] = useState<LocationPoint | null>(null);
  const [totalKm, setTotalKm] = useState<number | null>(null);
  const [routePolyline, setRoutePolyline] = useState<string | undefined>(undefined);

  const fareCents = parseInt(params.fare ?? "0", 10);
  // The push carries only COARSE labels — it goes to every eligible user, and a
  // passenger's street address should not land on 500 lock screens. The precise
  // labels come from the request document, fetched below: it is readable while
  // the request is open, so only a driver who actually opens this screen sees
  // where the passenger is and where they are going.
  //
  // The passenger's client also resolves a "Home"/"Maison" label to the real
  // address when it creates the request, so what arrives here is already the
  // label to show. Reading their homeAddress from their user document — which is
  // what this used to do — is now denied by the rules, and was always more of
  // their PII than a driver needs.
  const [preciseDestination, setPreciseDestination] = useState<string | null>(null);
  const [preciseOrigin, setPreciseOrigin] = useState<string | null>(null);
  const destination = preciseDestination ?? params.destination ?? "";
  const origin = preciseOrigin ?? params.origin ?? "";
  const seats = parseInt(params.seats ?? "", 10) || 0;
  const driverDest = params.driverDest ?? "";
  const driverDestLat = parseFloat(params.driverDestLat ?? "");
  const driverDestLng = parseFloat(params.driverDestLng ?? "");

  // Fetch rider profile for name + avatar
  useEffect(() => {
    if (!params.riderId) return;
    const load = async () => {
      try {
        const p = await fetchPublicProfile(params.riderId);
        if (p) {
          setRiderName(p.name || null);
          setRiderAvatar(p.avatar);
          setProfile(p);
        }
      } catch { /* show fallback */ }
    };
    void load();
  }, [params.riderId]);

  // Re-validate the request when the screen opens (cold start / late tap) and
  // capture the passenger pickup + drop-off coords for the map (the push payload
  // only carries labels, so these come from the request doc).
  useEffect(() => {
    if (!params.requestId) return;
    let active = true;
    fetchRideRequestById(params.requestId)
      .then((r) => {
        if (!active) return;
        if (!r || r.status !== "open") setUnavailable(true);
        if (r?.origin) setPickup(r.origin);
        if (r?.destinationCoords) setDropoff(r.destinationCoords);
        if (r?.destination) setPreciseDestination(r.destination);
        if (r?.originLabel) setPreciseOrigin(r.originLabel);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [params.requestId]);

  // Capture the driver's own location on mount so the map + total distance start
  // from where they actually are. Falls back to the pickup if GPS is denied.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let granted = (await Location.getForegroundPermissionsAsync()).status === "granted";
        if (!granted) {
          granted = (await Location.requestForegroundPermissionsAsync()).status === "granted";
        }
        if (!granted) return;
        const pos = await devAwareCurrentPosition({ accuracy: Location.Accuracy.Balanced });
        if (active) setDriverOrigin({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      } catch { /* map falls back to pickup-centred */ }
    })();
    return () => { active = false; };
  }, []);

  // Total trip distance (driver start → pickup → drop-off): instant haversine
  // estimate first, then refined with the road distance + polyline for the map.
  useEffect(() => {
    if (!pickup || !dropoff) return;
    const start = driverOrigin ?? pickup;
    const estimate =
      haversineKm(start.latitude, start.longitude, pickup.latitude, pickup.longitude) +
      haversineKm(pickup.latitude, pickup.longitude, dropoff.latitude, dropoff.longitude);
    if (Number.isFinite(estimate)) setTotalKm(estimate);

    let active = true;
    getMultiWaypointRoute([start, pickup, dropoff])
      .then((route) => {
        if (!active || !route) return;
        if (Number.isFinite(route.total.distanceKm)) setTotalKm(route.total.distanceKm);
        if (route.overviewPolyline) setRoutePolyline(route.overviewPolyline);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [pickup, dropoff, driverOrigin]);

  const handleAccept = async () => {
    if (accepting || !params.requestId) return;
    setAccepting(true);
    try {
      // Capture live GPS so a Ride Mode (offline) accept has a driver origin.
      let gps: { lat: number; lng: number } | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await devAwareCurrentPosition({ accuracy: Location.Accuracy.Balanced });
          gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
      } catch { /* may rely on an online session instead */ }

      const fallback =
        gps && Number.isFinite(driverDestLat) && Number.isFinite(driverDestLng)
          ? {
              origin: gps,
              destination: driverDest,
              destinationCoords: { lat: driverDestLat, lng: driverDestLng },
              seats: seats || undefined,
            }
          : gps
          ? { origin: gps, seats: seats || undefined }
          : undefined;

      const ride = await acceptRideRequest(params.requestId, fallback);
      // Do NOT auto-start: the passenger must first swipe to confirm this driver
      // (mutual match). Land in driver mode "planned/waiting" — the Start button
      // on riderScreen is gated on pendingConfirmation and unlocks once the
      // passenger confirms. Auto-starting here would hit the server's 428 gate.
      // Forward the passenger's own pickup/dropoff (the server returns them) so
      // the driver map plots the passenger on the first frame. Without this the
      // driver stares at a map with no passenger on it until the ride-doc
      // snapshot lands — which is a second or two of "where is my rider?".
      const paxParams =
        ride.passengerId && ride.passengerOriginLat != null && ride.passengerOriginLng != null
          ? `&PaxId=${ride.passengerId}&PaxLat=${ride.passengerOriginLat}&PaxLng=${ride.passengerOriginLng}` +
            (ride.passengerDestLat != null && ride.passengerDestLng != null
              ? `&PaxDestLat=${ride.passengerDestLat}&PaxDestLng=${ride.passengerDestLng}`
              : "")
          : "";
      router.replace(
        `/riderScreen?rideId=${ride.rideId}&maxSeat=${ride.maxSeat}&Originlat=${ride.originLat}&OriginLng=${ride.originLng}&Destination=${encodeURIComponent(ride.destination ?? "")}&DestinationLat=${ride.destinationLat}&DestinationLng=${ride.destinationLng}&started=false${paxParams}` as never,
      );
    } catch (err: any) {
      if (err?.code === "ALREADY_TAKEN") {
        Alert.alert(t("acceptRide.takenTitle"), t("acceptRide.takenMsg"));
        router.back();
      } else {
        // throwFetchError embeds the status + response body (which now carries a
        // `reason`) in the message. Surface it in dev so a failed accept names the
        // branch that refused instead of the generic "try again"; production keeps
        // the friendly copy.
        Alert.alert(
          t("acceptRide.failedTitle"),
          isDev && err?.message
            ? `${t("acceptRide.failedMsg")}\n\n${String(err.message)}`
            : t("acceptRide.failedMsg"),
        );
      }
    } finally {
      setAccepting(false);
    }
  };

  const mapOrigin = driverOrigin ?? pickup;
  return (
    <View style={styles.root}>
      {/* Map background: driver start → passenger pickup → passenger drop-off */}
      {pickup && dropoff ? (
        <View style={StyleSheet.absoluteFill}>
          <DriverRideMapView
            origin={mapOrigin ?? pickup}
            destination={dropoff}
            passengers={undefined}
            passengerPickups={params.riderId ? { [params.riderId]: pickup } : undefined}
            frozenPolyline={routePolyline}
          />
        </View>
      ) : null}

      {/* Back — the map is now interactive, so tap-to-dismiss is replaced by this. */}
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + 8 }]}
        onPress={() => router.back()}
        activeOpacity={0.8}
        hitSlop={10}
      >
        <Ionicons name="chevron-back" size={22} color={C.text} />
      </TouchableOpacity>

      {/* Bottom sheet — box-none lets touches fall through to the map above it. */}
      <View style={styles.sheetWrap} pointerEvents="box-none">
      <View style={[styles.sheet, { maxHeight: panelMaxHeight(0.82) }]}>
        <BlurView
          intensity={80}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={[
            styles.blur,
            {
              paddingBottom: Math.max(insets.bottom, 16) + 16,
              paddingHorizontal: isNarrow ? 16 : 22,
            },
          ]}
        >

          {/* Drag handle */}
          <View style={styles.dragZone}>
            <View style={styles.handle} />
          </View>

          {/* Rider + route + stats scroll; the CTAs below stay pinned. Without
              this the sheet's maxHeight simply clipped the Accept button off. */}
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >

          {/* Eyebrow */}
          <Text style={styles.eyebrow} maxFontSizeMultiplier={FONT_CAP.chrome}>{t("acceptRide.eyebrow")}</Text>

          {/* Rider info — tap to open the extended profile before deciding. */}
          <TouchableOpacity
            style={styles.riderRow}
            onPress={() => profile && setShowProfile(true)}
            activeOpacity={0.75}
            disabled={!profile}
          >
            {riderAvatar ? (
              <ExpoImage
                source={{ uri: riderAvatar }}
                style={styles.avatar}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={riderAvatar}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Ionicons name="person" size={22} color={C.purpleLight} />
              </View>
            )}
            <View style={styles.riderTextGroup}>
              <View style={styles.riderNameRow}>
                <Text style={styles.riderName} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP.display}>
                  {riderName ?? t("acceptRide.passenger")}
                </Text>
                <CertBadges certifications={profile?.certifications} size="compact" hideWhenEmpty />
              </View>
              <Text style={styles.riderSub} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.chrome}>
                {profile ? t("driverInbox.viewProfile") : t("acceptRide.seeking")}
              </Text>
            </View>
            {profile ? <Ionicons name="chevron-forward" size={20} color={C.muted} /> : null}
          </TouchableOpacity>

          {/* Route */}
          <View style={styles.routeCard}>
            <View style={styles.routeRow}>
              <Ionicons name="radio-button-on" size={14} color={C.success} />
              <Text style={styles.routeText} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.body}>{origin || t("acceptRide.passenger")}</Text>
            </View>
            <View style={styles.routeDivider} />
            <View style={styles.routeRow}>
              <Ionicons name="location-sharp" size={14} color={C.purpleLight} />
              <Text style={styles.routeText} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.body}>{destination}</Text>
            </View>
          </View>

          {/* Stats: return / capacity / trip distance */}
          <View style={styles.earningsCard}>
            <LinearGradient
              colors={["rgba(137,56,213,0.18)", "rgba(99,102,241,0.10)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.statsGradient, shouldStack && styles.statsGradientStacked]}
            >
              <View style={[styles.statCol, shouldStack && styles.statColStacked]}>
                <Text style={styles.statValue} maxFontSizeMultiplier={FONT_CAP.display}>{formatFrCA(fareCents)}</Text>
                <Text style={styles.statLabel} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.chrome}>{t("acceptRide.return")}</Text>
              </View>
              <View style={shouldStack ? styles.statDividerH : styles.statDivider} />
              <View style={[styles.statCol, shouldStack && styles.statColStacked]}>
                <Text style={styles.statValue} maxFontSizeMultiplier={FONT_CAP.display}>{seats || "—"}</Text>
                <Text style={styles.statLabel} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.chrome}>{t("acceptRide.capacity")}</Text>
              </View>
              <View style={shouldStack ? styles.statDividerH : styles.statDivider} />
              <View style={[styles.statCol, shouldStack && styles.statColStacked]}>
                <Text style={styles.statValue} maxFontSizeMultiplier={FONT_CAP.display}>{totalKm != null ? `${totalKm.toFixed(1)} km` : "—"}</Text>
                <Text style={styles.statLabel} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.chrome}>{t("acceptRide.totalTrip")}</Text>
              </View>
            </LinearGradient>
          </View>

          </ScrollView>

          {/* Accept CTA */}
          <TouchableOpacity
            style={[styles.ctaWrap, (accepting || unavailable) && { opacity: 0.6 }]}
            onPress={handleAccept}
            activeOpacity={0.85}
            disabled={accepting || unavailable}
          >
            <View style={styles.ctaGradient}>
              {accepting ? (
                <ActivityIndicator color="#2d0015" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#2d0015" />
                  <Text style={styles.ctaText} maxFontSizeMultiplier={FONT_CAP.action}>
                    {unavailable ? t("acceptRide.expiredTitle") : t("acceptRide.accept")}
                  </Text>
                </>
              )}
            </View>
          </TouchableOpacity>

          {/* Ignore */}
          <TouchableOpacity style={styles.ignoreBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Text style={styles.ignoreText} maxFontSizeMultiplier={FONT_CAP.action}>{t("acceptRide.ignore")}</Text>
          </TouchableOpacity>

        </BlurView>
      </View>
      </View>

      {/* Extended passenger profile */}
      <Modal
        visible={showProfile}
        transparent
        animationType="fade"
        onRequestClose={() => setShowProfile(false)}
      >
        <TouchableOpacity
          style={styles.profileBackdrop}
          activeOpacity={1}
          onPress={() => setShowProfile(false)}
        >
          <TouchableOpacity activeOpacity={1} style={[styles.profileSheet, { maxHeight: panelMaxHeight(0.85) }]}>
            {profile ? (
              <ScrollView
                contentContainerStyle={styles.profileScrollContent}
                bounces={false}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.profileAvatarWrap}>
                  {profile.avatar ? (
                    <ExpoImage
                      source={{ uri: profile.avatar }}
                      style={styles.profileAvatar}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={profile.avatar}
                    />
                  ) : (
                    <View style={[styles.profileAvatar, styles.profileAvatarFallback]}>
                      <Ionicons name="person" size={32} color={C.purpleLight} />
                    </View>
                  )}
                </View>
                <Text style={styles.profileName} maxFontSizeMultiplier={FONT_CAP.display}>{profile.name}</Text>
                <View style={{ alignItems: "center", marginTop: 8 }}>
                  <CertBadges certifications={profile.certifications} size="full" />
                </View>
                <View style={styles.profileXpRow}>
                  <Text style={styles.profileXpText} maxFontSizeMultiplier={FONT_CAP.chrome}>⚡ {profile.xp} XP</Text>
                  {profile.rating > 0 && (
                    <Text style={styles.profileRatingText} maxFontSizeMultiplier={FONT_CAP.chrome}>⭐ {profile.rating.toFixed(1)}</Text>
                  )}
                </View>
                <View style={styles.profileStatsRow}>
                  <View style={styles.profileStat}>
                    <Text style={styles.profileStatVal} maxFontSizeMultiplier={FONT_CAP.display}>{profile.ridesCompleted}</Text>
                    <Text style={styles.profileStatLabel} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.chrome}>{t("driverRide.profileRides")}</Text>
                  </View>
                </View>
                <View style={styles.profileInfoList}>
                  {profile.school ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon} allowFontScaling={false}>🎓</Text>
                      <Text style={styles.profileInfoText} maxFontSizeMultiplier={FONT_CAP.body}>{profile.school}</Text>
                    </View>
                  ) : null}
                  {profile.age ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon} allowFontScaling={false}>🎂</Text>
                      <Text style={styles.profileInfoText} maxFontSizeMultiplier={FONT_CAP.body}>{t("driverRide.profileAge", { age: profile.age })}</Text>
                    </View>
                  ) : null}
                  {profile.instagramHandle ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon} allowFontScaling={false}>📷</Text>
                      <Text style={styles.profileInfoText} maxFontSizeMultiplier={FONT_CAP.body}>@{profile.instagramHandle}</Text>
                    </View>
                  ) : null}
                </View>
                <TouchableOpacity style={styles.profileCloseBtn} onPress={() => setShowProfile(false)}>
                  <Text style={styles.profileCloseBtnText} maxFontSizeMultiplier={FONT_CAP.action}>{t("common.close")}</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  sheetWrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
  },
  backBtn: {
    position: "absolute",
    left: 14,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,8,16,0.72)",
    borderWidth: 1,
    borderColor: C.border,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: C.border,
    shadowColor: C.purple,
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  blur: {
    flexShrink: 1,
  },
  // flexShrink lets the scroll region yield height to the pinned CTAs once the
  // sheet hits its maxHeight.
  sheetScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  sheetScrollContent: {
    paddingBottom: 4,
  },
  dragZone: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 14,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(137,56,213,0.45)",
  },
  eyebrow: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginBottom: 16,
  },
  riderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 20,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: C.border,
  },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 16,
    flexShrink: 0,
    backgroundColor: "rgba(137,56,213,0.15)",
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  riderTextGroup: {
    flex: 1,
  },
  riderNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  riderName: {
    flexShrink: 1,
    color: C.text,
    fontSize: 20,
    fontWeight: "800",
  },
  riderSub: {
    color: C.muted,
    fontSize: 13,
    marginTop: 2,
  },
  routeCard: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  routeText: {
    color: C.text,
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  routeDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.07)",
    marginLeft: 24,
  },
  earningsCard: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 20,
  },
  earningsGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 18,
    gap: 16,
  },
  statsGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  // Large text: three narrow columns can't hold "Trajet total" side by side.
  statsGradientStacked: {
    flexDirection: "column",
    alignItems: "stretch",
    paddingHorizontal: 18,
    gap: 12,
  },
  statCol: { flex: 1, alignItems: "center", gap: 3 },
  statColStacked: { flex: 0 },
  // stretch, not a fixed 34pt, so the rule matches however tall the columns get.
  statDivider: { width: 1, alignSelf: "stretch", minHeight: 34, backgroundColor: "rgba(255,255,255,0.10)" },
  statDividerH: { height: 1, alignSelf: "stretch", backgroundColor: "rgba(255,255,255,0.10)" },
  statValue: { color: C.text, fontSize: 19, fontWeight: "800" },
  statLabel: { color: C.muted, fontSize: 11, fontWeight: "500", textAlign: "center" },
  earningsIcon: {
    width: 52,
    height: 52,
    borderRadius: 15,
    backgroundColor: "rgba(137,56,213,0.18)",
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  earningsAmount: {
    color: C.text,
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 38,
  },
  earningsLabel: {
    color: C.muted,
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  ctaWrap: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12,
  },
  ctaGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 12,
    gap: 8,
    minHeight: 54,
    backgroundColor: "#e09af7",
  },
  ctaText: {
    flexShrink: 1,
    textAlign: "center",
    color: "#2d0015",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  ignoreBtn: {
    alignItems: "center",
    paddingVertical: 12,
  },
  ignoreText: {
    color: C.dim,
    fontSize: 14,
    fontWeight: "600",
  },

  // ── Extended passenger profile modal ──────────────────────────────────────
  profileBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  profileSheet: {
    width: "100%",
    backgroundColor: "#13132a",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.3)",
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  profileAvatarWrap: { marginBottom: 4 },
  profileAvatar: { width: 80, height: 80, borderRadius: 40 },
  profileScrollContent: { alignItems: "center", gap: 12 },
  profileAvatarFallback: {
    backgroundColor: "rgba(137,56,213,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: { color: C.text, fontSize: 18, fontWeight: "700", textAlign: "center" },
  profileXpRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  profileXpText: { color: "#a78bfa", fontSize: 13, fontWeight: "600" },
  profileRatingText: { color: "#fbbf24", fontSize: 13, fontWeight: "600" },
  profileStatsRow: {
    flexDirection: "row",
    gap: 20,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    width: "100%",
    justifyContent: "center",
  },
  profileStat: { alignItems: "center", gap: 2 },
  profileStatVal: { color: C.text, fontSize: 18, fontWeight: "700" },
  profileStatLabel: { color: C.muted, fontSize: 11 },
  profileInfoList: { width: "100%", gap: 8 },
  profileInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  profileInfoIcon: { fontSize: 15 },
  profileInfoText: { color: "#d1d5db", fontSize: 13, fontWeight: "500", flex: 1 },
  profileCloseBtn: {
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.4)",
    backgroundColor: "rgba(137,56,213,0.1)",
  },
  profileCloseBtnText: { color: "#a78bfa", fontSize: 14, fontWeight: "600" },
});
