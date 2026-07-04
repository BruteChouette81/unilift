import { acceptRideRequest } from "@/services/driverSessionService";
import { fetchRideRequestById } from "@/services/rideRequestService";
import { fetchUserDocument } from "@/services/userService";
import { calculateAgeFromBirthDate } from "@/components/userHelper";
import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getAuth } from "firebase/auth";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type PassengerProfile = {
  uid: string;
  name: string;
  xp: number;
  rating: number;
  avatar: string | null;
  ridesCompleted: number;
  school?: string;
  age?: number;
  instagramHandle?: string;
};

function extractPassengerProfile(uid: string, doc: { fields?: Record<string, unknown> }): PassengerProfile {
  const fields = doc?.fields ?? {};
  const str = (key: string): string => {
    const v = fields[key] as Record<string, unknown> | undefined;
    return typeof v?.stringValue === "string" ? v.stringValue : "";
  };
  const num = (key: string): number => {
    const v = fields[key] as Record<string, unknown> | undefined;
    return Number(v?.integerValue ?? v?.doubleValue ?? 0);
  };
  const email = str("email");
  const name = str("name") || email.split("@")[0] || "Passenger";
  const birthDate = str("birthDate");
  const storedAge = num("age");
  const age = birthDate ? calculateAgeFromBirthDate(birthDate) : (storedAge > 0 ? storedAge : undefined);
  return {
    uid,
    name,
    xp: num("xp"),
    rating: num("rating"),
    avatar: str("avatar") || null,
    ridesCompleted: num("ridesCompleted"),
    school: str("school") || undefined,
    age: typeof age === "number" && age > 0 ? age : undefined,
    instagramHandle: str("instagramHandle") || undefined,
  };
}

const C = {
  bg:          "#080810",
  border:      "rgba(137, 56, 213, 0.30)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
  success:     "#34d399",
};

const SHEET_MAX_HEIGHT = Dimensions.get("window").height * 0.82;

/** Format cents as fr-CA: 525 → "+5,25 $" */
function formatFrCA(cents: number): string {
  return `+${(cents / 100).toFixed(2).replace(".", ",")} $`;
}

export default function AcceptRideScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  const [riderHomeAddress, setRiderHomeAddress] = useState<string | null>(null);
  // Full passenger profile for the extended view the driver can open before
  // committing to (or starting) the ride.
  const [profile, setProfile] = useState<PassengerProfile | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [accepting, setAccepting] = useState(false);
  // Verify the request is still claimable on open (handles a deep link tapped
  // after the request was already taken/cancelled, incl. cold start).
  const [unavailable, setUnavailable] = useState(false);

  const fareCents = parseInt(params.fare ?? "0", 10);
  const rawDestination = params.destination ?? "";
  const origin = params.origin ?? "";
  // If the passenger requested their home address, show the actual address instead of "Home".
  const isHomeLabel = /^(home|maison)$/i.test(rawDestination.trim());
  const destination = isHomeLabel && riderHomeAddress ? riderHomeAddress : rawDestination;
  const seats = parseInt(params.seats ?? "", 10) || 0;
  const rideKm = parseFloat(params.rideKm ?? "");
  const driverDest = params.driverDest ?? "";
  const driverDestLat = parseFloat(params.driverDestLat ?? "");
  const driverDestLng = parseFloat(params.driverDestLng ?? "");

  // Fetch rider profile for name + avatar
  useEffect(() => {
    if (!params.riderId) return;
    const load = async () => {
      try {
        const idToken = await getAuth().currentUser?.getIdToken();
        const doc = await fetchUserDocument(params.riderId, idToken);
        const fields = doc?.fields as Record<string, any> | undefined;
        const name = fields?.name?.stringValue ?? fields?.email?.stringValue ?? null;
        const avatar = fields?.avatar?.stringValue ?? null;
        const homeAddress = fields?.homeAddress?.stringValue ?? null;
        setRiderName(name);
        setRiderAvatar(avatar);
        setRiderHomeAddress(homeAddress);
        if (doc) setProfile(extractPassengerProfile(params.riderId, doc));
      } catch { /* show fallback */ }
    };
    void load();
  }, [params.riderId]);

  // Re-validate the request when the screen opens (cold start / late tap).
  useEffect(() => {
    if (!params.requestId) return;
    let active = true;
    fetchRideRequestById(params.requestId)
      .then((r) => {
        if (active && (!r || r.status !== "open")) setUnavailable(true);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [params.requestId]);

  const handleAccept = async () => {
    if (accepting || !params.requestId) return;
    setAccepting(true);
    try {
      // Capture live GPS so a Ride Mode (offline) accept has a driver origin.
      let gps: { lat: number; lng: number } | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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
      // Go to the waiting zone so the driver can accept more passengers before starting.
      router.replace(
        `/driverRequestsScreen?readyRideId=${ride.rideId}&readyMaxSeat=${ride.maxSeat}&readyOriginLat=${ride.originLat}&readyOriginLng=${ride.originLng}&readyDest=${encodeURIComponent(ride.destination)}&readyDestLat=${ride.destinationLat}&readyDestLng=${ride.destinationLng}&readyPassengerName=${encodeURIComponent(riderName ?? "")}&readyPassengerAvatar=${encodeURIComponent(riderAvatar ?? "")}&readyPassengerId=${encodeURIComponent(params.riderId ?? "")}` as never,
      );
    } catch (err: any) {
      if (err?.code === "ALREADY_TAKEN") {
        Alert.alert(t("acceptRide.takenTitle"), t("acceptRide.takenMsg"));
        router.back();
      } else {
        Alert.alert(t("acceptRide.failedTitle"), t("acceptRide.failedMsg"));
      }
    } finally {
      setAccepting(false);
    }
  };

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => router.back()} activeOpacity={1} />

      <View style={[styles.sheet, { maxHeight: SHEET_MAX_HEIGHT, paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
        <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.blur}>

          {/* Drag handle */}
          <View style={styles.dragZone}>
            <View style={styles.handle} />
          </View>

          {/* Eyebrow */}
          <Text style={styles.eyebrow}>{t("acceptRide.eyebrow")}</Text>

          {/* Rider info — tap to open the extended profile before deciding. */}
          <TouchableOpacity
            style={styles.riderRow}
            onPress={() => profile && setShowProfile(true)}
            activeOpacity={0.75}
            disabled={!profile}
          >
            {riderAvatar ? (
              <Image source={{ uri: riderAvatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Ionicons name="person" size={22} color={C.purpleLight} />
              </View>
            )}
            <View style={styles.riderTextGroup}>
              <Text style={styles.riderName} numberOfLines={1}>
                {riderName ?? t("acceptRide.passenger")}
              </Text>
              <Text style={styles.riderSub}>
                {profile ? t("driverInbox.viewProfile") : t("acceptRide.seeking")}
              </Text>
            </View>
            {profile ? <Ionicons name="chevron-forward" size={20} color={C.muted} /> : null}
          </TouchableOpacity>

          {/* Route */}
          <View style={styles.routeCard}>
            <View style={styles.routeRow}>
              <Ionicons name="radio-button-on" size={14} color={C.success} />
              <Text style={styles.routeText} numberOfLines={1}>{origin || t("acceptRide.passenger")}</Text>
            </View>
            <View style={styles.routeDivider} />
            <View style={styles.routeRow}>
              <Ionicons name="location-sharp" size={14} color={C.purpleLight} />
              <Text style={styles.routeText} numberOfLines={1}>{destination}</Text>
            </View>
          </View>

          {/* Stats: return / capacity / trip distance */}
          <View style={styles.earningsCard}>
            <LinearGradient
              colors={["rgba(137,56,213,0.18)", "rgba(99,102,241,0.10)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.statsGradient}
            >
              <View style={styles.statCol}>
                <Text style={styles.statValue}>{formatFrCA(fareCents)}</Text>
                <Text style={styles.statLabel}>{t("acceptRide.return")}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCol}>
                <Text style={styles.statValue}>{seats || "—"}</Text>
                <Text style={styles.statLabel}>{t("acceptRide.capacity")}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCol}>
                <Text style={styles.statValue}>{Number.isFinite(rideKm) ? `${rideKm.toFixed(1)} km` : "—"}</Text>
                <Text style={styles.statLabel}>{t("acceptRide.rideDistance")}</Text>
              </View>
            </LinearGradient>
          </View>

          {/* Accept CTA */}
          <TouchableOpacity
            style={[styles.ctaWrap, (accepting || unavailable) && { opacity: 0.6 }]}
            onPress={handleAccept}
            activeOpacity={0.85}
            disabled={accepting || unavailable}
          >
            <LinearGradient
              colors={["#8938D5", "#FD165A"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaGradient}
            >
              {accepting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.ctaText}>
                    {unavailable ? t("acceptRide.expiredTitle") : t("acceptRide.accept")}
                  </Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Ignore */}
          <TouchableOpacity style={styles.ignoreBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <Text style={styles.ignoreText}>{t("acceptRide.ignore")}</Text>
          </TouchableOpacity>

        </BlurView>
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
          <TouchableOpacity activeOpacity={1} style={styles.profileSheet}>
            {profile ? (
              <>
                <View style={styles.profileAvatarWrap}>
                  {profile.avatar ? (
                    <Image source={{ uri: profile.avatar }} style={styles.profileAvatar} />
                  ) : (
                    <View style={[styles.profileAvatar, styles.profileAvatarFallback]}>
                      <Ionicons name="person" size={32} color={C.purpleLight} />
                    </View>
                  )}
                </View>
                <Text style={styles.profileName}>{profile.name}</Text>
                <View style={styles.profileXpRow}>
                  <Text style={styles.profileXpText}>⚡ {profile.xp} XP</Text>
                  {profile.rating > 0 && (
                    <Text style={styles.profileRatingText}>⭐ {profile.rating.toFixed(1)}</Text>
                  )}
                </View>
                <View style={styles.profileStatsRow}>
                  <View style={styles.profileStat}>
                    <Text style={styles.profileStatVal}>{profile.ridesCompleted}</Text>
                    <Text style={styles.profileStatLabel}>{t("driverRide.profileRides")}</Text>
                  </View>
                </View>
                <View style={styles.profileInfoList}>
                  {profile.school ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon}>🎓</Text>
                      <Text style={styles.profileInfoText}>{profile.school}</Text>
                    </View>
                  ) : null}
                  {profile.age ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon}>🎂</Text>
                      <Text style={styles.profileInfoText}>{t("driverRide.profileAge", { age: profile.age })}</Text>
                    </View>
                  ) : null}
                  {profile.instagramHandle ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon}>📷</Text>
                      <Text style={styles.profileInfoText}>@{profile.instagramHandle}</Text>
                    </View>
                  ) : null}
                </View>
                <TouchableOpacity style={styles.profileCloseBtn} onPress={() => setShowProfile(false)}>
                  <Text style={styles.profileCloseBtnText}>{t("common.close")}</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
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
    paddingHorizontal: 22,
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
    borderWidth: 1,
    borderColor: C.border,
  },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(137,56,213,0.15)",
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  riderTextGroup: {
    flex: 1,
  },
  riderName: {
    color: C.text,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 24,
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
  statCol: { flex: 1, alignItems: "center", gap: 3 },
  statDivider: { width: 1, height: 34, backgroundColor: "rgba(255,255,255,0.10)" },
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
    gap: 8,
    minHeight: 54,
  },
  ctaText: {
    color: "#fff",
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
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  profileAvatarWrap: { marginBottom: 4 },
  profileAvatar: { width: 80, height: 80, borderRadius: 40 },
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
