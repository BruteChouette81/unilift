import CertBadges from "@/components/cert-badges";
import { useActiveRide } from "@/context/ActiveRideContext";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { db } from "@/firebaseConfig";
import { confirmDriver, rejectDriver } from "@/services/rideServices";
import { dispatchRideRequest } from "@/services/driverSessionService";
import { fetchDriverProfile, type DriverProfile } from "@/services/userService";
import { rideLog } from "@/utils/ride-logger";
import { Ionicons } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  bg:          "#080810",
  card:        "#0f0f1e",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  pink:        "#FD165A",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  gold:        "#fbbf24",
  match:       "#22c55e",
  pass:        "#f87171",
  border:      "rgba(137, 56, 213, 0.30)",
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const CARD_W = Math.min(SCREEN_W - 40, 380);
const CARD_H = Math.min(SCREEN_H * 0.56, 520);
const SWIPE_THRESHOLD = CARD_W * 0.32;
const CONFIRM_WINDOW_MS = 2 * 60 * 1000;

type MatchParams = {
  rideId: string;
  requestId?: string;
  originLat?: string;
  originLng?: string;
  destLat?: string;
  destLng?: string;
};

/** Format a millisecond duration as m:ss. */
function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MatchDriverScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { clearPendingRequest } = useActiveRide();
  const params = useLocalSearchParams<MatchParams>();
  const uid = user?.uid ?? "";

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [phase, setPhase] = useState<"deciding" | "matched" | "expired">("deciding");
  const [msLeft, setMsLeft] = useState<number>(CONFIRM_WINDOW_MS);
  const deadlineRef = useRef<number>(Date.now() + CONFIRM_WINDOW_MS);
  const settledRef = useRef(false);       // guards double-settle (confirm/pass/expire)
  const driverFetchedRef = useRef(false);
  const reduceMotionRef = useRef(false);

  // ── Swipe animation (single card) ─────────────────────────────────────────
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const celebrate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { reduceMotionRef.current = on; }).catch(() => {});
  }, []);

  // Build the coord query shared by the destinations we route to.
  const coordQuery = useMemo(() => {
    const o = params;
    return `Originlat=${o.originLat ?? "0"}&OriginLng=${o.originLng ?? "0"}&DestinationLat=${o.destLat ?? "0"}&DestinationLng=${o.destLng ?? "0"}`;
  }, [params]);

  const goToRide = useCallback(() => {
    // Confirmed — the search is over, so drop the persisted pending-request record.
    clearPendingRequest();
    router.replace(`/rideScreen?rideId=${params.rideId}&${coordQuery}&pending=false` as never);
  }, [router, params.rideId, coordQuery, clearPendingRequest]);

  const goBackToSearch = useCallback(() => {
    if (params.requestId) {
      router.replace(
        `/findingDriverScreen?requestId=${params.requestId}&${coordQuery}&notified=0` as never,
      );
    } else {
      router.replace("/(tabs)" as never);
    }
  }, [router, params.requestId, coordQuery]);

  // ── Live listener: detect confirm-elsewhere, teardown, or cancellation ─────
  useEffect(() => {
    if (!params.rideId) return;
    const unsub = onSnapshot(
      doc(db, "rides", params.rideId),
      (snap) => {
        if (!snap.exists() || settledRef.current) return;
        const data = snap.data();
        const driverId = data?.driverId as string | undefined;
        const pending = (data?.pendingConfirmation as string[] | undefined) ?? [];
        const passengers = (data?.passengers as string[] | undefined) ?? [];
        const status = data?.status as string | undefined;

        // Seed the deadline from the server value once (keeps client honest).
        const deadline = data?.confirmDeadlineAt;
        if (deadline?.toMillis) deadlineRef.current = deadline.toMillis();

        // Fetch the driver's full profile once we know who they are.
        if (driverId && !driverFetchedRef.current) {
          driverFetchedRef.current = true;
          // Seed immediately from denormalized fields so the card shows at once.
          setProfile((prev) => prev ?? {
            uid: driverId,
            name: (data?.driverName as string) || "Driver",
            avatar: (data?.driverAvatar as string) || null,
            xp: 0, rating: 0, ridesCompleted: 0, certifications: [],
          });
          fetchDriverProfile(driverId).then((p) => { if (p) setProfile(p); }).catch(() => {});
        }

        // Ride was cancelled or I'm no longer on it (auto-expire / teardown).
        if (status === "cancelled" || (uid && !passengers.includes(uid))) {
          settledRef.current = true;
          setPhase("expired");
          setTimeout(goBackToSearch, 1400);
          return;
        }

        // I already confirmed (elsewhere, or resumed post-confirmation) → ride.
        if (uid && passengers.includes(uid) && !pending.includes(uid)) {
          settledRef.current = true;
          goToRide();
        }
      },
      (err) => console.warn("matchDriver listener error", err),
    );
    return () => unsub();
  }, [params.rideId, uid, goToRide, goBackToSearch]);

  // ── Countdown ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const left = deadlineRef.current - Date.now();
      setMsLeft(left);
      if (left <= 0 && !settledRef.current) {
        // App is open and the window elapsed — proactively tear down and search.
        settledRef.current = true;
        setPhase("expired");
        rideLog.info("passenger", "match confirm window expired (client)", { rideId: params.rideId });
        rejectDriver(params.rideId).catch(() => {});
        setTimeout(goBackToSearch, 1400);
      }
    }, 500);
    return () => clearInterval(id);
  }, [params.rideId, goBackToSearch]);

  // ── Confirm / Pass ──────────────────────────────────────────────────────────
  const doConfirm = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    rideLog.info("passenger", "confirm driver", { rideId: params.rideId });
    confirmDriver(params.rideId).catch(() => {});

    const finish = () => goToRide();
    if (reduceMotionRef.current) {
      setPhase("matched");
      setTimeout(finish, 600);
      return;
    }
    // Fling the card off-screen right, then play the match flourish.
    Animated.timing(pan, {
      toValue: { x: SCREEN_W * 1.2, y: 40 },
      duration: 260,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      setPhase("matched");
      Animated.timing(celebrate, {
        toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true,
      }).start();
      setTimeout(finish, 1100);
    });
  }, [params.rideId, goToRide, pan, celebrate]);

  const doPass = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    rideLog.info("passenger", "pass driver", { rideId: params.rideId });
    // Free the seat + re-open the request, then re-notify drivers, then search.
    rejectDriver(params.rideId)
      .then(() => { if (params.requestId) return dispatchRideRequest(params.requestId); })
      .catch(() => {})
      .finally(goBackToSearch);

    if (reduceMotionRef.current) return;
    Animated.timing(pan, {
      toValue: { x: -SCREEN_W * 1.2, y: 40 },
      duration: 240,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [params.rideId, params.requestId, goBackToSearch, pan]);

  // ── PanResponder on the card ────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_, g) => {
        if (g.dx > SWIPE_THRESHOLD || g.vx > 0.5) { doConfirm(); return; }
        if (g.dx < -SWIPE_THRESHOLD || g.vx < -0.5) { doPass(); return; }
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 6 }).start();
      },
    }),
  ).current;

  // ── Derived animated styles ──────────────────────────────────────────────────
  const rotate = pan.x.interpolate({
    inputRange: [-CARD_W, 0, CARD_W],
    outputRange: ["-9deg", "0deg", "9deg"],
  });
  const matchStampOpacity = pan.x.interpolate({ inputRange: [0, SWIPE_THRESHOLD], outputRange: [0, 1], extrapolate: "clamp" });
  const passStampOpacity = pan.x.interpolate({ inputRange: [-SWIPE_THRESHOLD, 0], outputRange: [1, 0], extrapolate: "clamp" });
  const glowScale = celebrate.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.4] });
  const glowOpacity = celebrate.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 0.3, 0] });

  const initials = (profile?.name ?? "?").trim().charAt(0).toUpperCase();
  const secondsWarning = msLeft <= 30000;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      {/* Ambient brand glow */}
      <LinearGradient
        colors={["rgba(137,56,213,0.20)", "transparent"]}
        style={styles.ambient}
        pointerEvents="none"
      />

      {phase === "expired" ? (
        <View style={styles.centerFill}>
          <View style={[styles.resultIcon, { borderColor: C.pass }]}>
            <Ionicons name="time-outline" size={40} color={C.pass} />
          </View>
          <Text style={styles.resultTitle}>{t("matchDriver.expiredTitle")}</Text>
          <Text style={styles.resultSub}>{t("matchDriver.expiredSub")}</Text>
        </View>
      ) : phase === "matched" ? (
        <View style={styles.centerFill}>
          <View style={styles.celebrateWrap}>
            <Animated.View
              style={[styles.celebrateGlow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
            />
            <LinearGradient colors={[C.pink, C.purple]} style={styles.resultIconFilled}>
              <Ionicons name="heart" size={40} color="#fff" />
            </LinearGradient>
          </View>
          <Text style={styles.resultTitle}>{t("matchDriver.matchedTitle")}</Text>
          <Text style={styles.resultSub}>{t("matchDriver.matchedSub")}</Text>
        </View>
      ) : (
        <>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.eyebrow}>{t("matchDriver.eyebrow")}</Text>
            <Text style={styles.title}>{t("matchDriver.title")}</Text>
            <View style={[styles.timerPill, secondsWarning && styles.timerPillWarn]}>
              <Ionicons name="time-outline" size={13} color={secondsWarning ? C.pass : C.purpleLight} />
              <Text style={[styles.timerText, secondsWarning && { color: C.pass }]}>
                {t("matchDriver.timeLeft", { time: fmt(msLeft) })}
              </Text>
            </View>
          </View>

          {/* Swipe card */}
          <View style={styles.cardArea}>
            <Animated.View
              {...panResponder.panHandlers}
              style={[
                styles.card,
                { transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] },
              ]}
            >
              {profile?.avatar ? (
                <ExpoImage source={{ uri: profile.avatar }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
              ) : (
                <LinearGradient colors={["#1e1b4b", "#0d1224"]} style={StyleSheet.absoluteFill}>
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarInitial}>{initials}</Text>
                  </View>
                </LinearGradient>
              )}

              {/* Directional stamps */}
              <Animated.View style={[styles.stamp, styles.stampMatch, { opacity: matchStampOpacity }]}>
                <Text style={[styles.stampText, { color: C.match }]}>{t("matchDriver.stampMatch")}</Text>
              </Animated.View>
              <Animated.View style={[styles.stamp, styles.stampPass, { opacity: passStampOpacity }]}>
                <Text style={[styles.stampText, { color: C.pass }]}>{t("matchDriver.stampPass")}</Text>
              </Animated.View>

              {/* Bottom info scrim */}
              <LinearGradient
                colors={["transparent", "rgba(8,8,16,0.55)", "rgba(8,8,16,0.96)"]}
                style={styles.scrim}
              >
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {profile?.name ?? t("matchDriver.loading")}
                    {profile?.age ? <Text style={styles.age}>  {profile.age}</Text> : null}
                  </Text>
                  <CertBadges certifications={profile?.certifications} size="compact" hideWhenEmpty />
                </View>

                {profile?.school ? (
                  <View style={styles.metaRow}>
                    <Ionicons name="school-outline" size={14} color={C.purpleLight} />
                    <Text style={styles.metaText} numberOfLines={1}>{profile.school}</Text>
                  </View>
                ) : null}

                <View style={styles.statsRow}>
                  <View style={styles.stat}>
                    <Ionicons name="star" size={14} color={C.gold} />
                    <Text style={styles.statValue}>{(profile?.rating ?? 0).toFixed(1)}</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.stat}>
                    <Ionicons name="flash" size={14} color={C.purpleLight} />
                    <Text style={styles.statValue}>{profile?.xp ?? 0} {t("matchDriver.xpLabel")}</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.stat}>
                    <Ionicons name="car-sport" size={14} color={C.muted} />
                    <Text style={styles.statValue}>{profile?.ridesCompleted ?? 0} {t("matchDriver.ridesLabel")}</Text>
                  </View>
                </View>
              </LinearGradient>
            </Animated.View>
          </View>

          {/* Subtitle */}
          <Text style={styles.subtitle}>{t("matchDriver.subtitle")}</Text>

          {/* Action buttons (accessible alternative to swiping) */}
          <View style={styles.actions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t("matchDriver.pass")}
              style={[styles.actionBtn, styles.passBtn]}
              onPress={doPass}
              activeOpacity={0.85}
            >
              <Ionicons name="close" size={30} color={C.pass} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t("matchDriver.confirm")}
              style={styles.confirmBtn}
              onPress={doConfirm}
              activeOpacity={0.9}
            >
              <LinearGradient colors={[C.pink, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.confirmGrad}>
                <Ionicons name="heart" size={22} color="#fff" />
                <Text style={styles.confirmText}>{t("matchDriver.confirm")}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20 },
  ambient: { position: "absolute", top: 0, left: 0, right: 0, height: 320 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },

  header: { alignItems: "center", gap: 4, marginTop: 6 },
  eyebrow: {
    color: C.purpleLight, fontSize: 12, fontWeight: "800",
    letterSpacing: 2, textTransform: "uppercase",
  },
  title: { color: C.text, fontSize: 26, fontWeight: "800", textAlign: "center" },
  timerPill: {
    flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6,
    backgroundColor: "rgba(137,56,213,0.14)", borderColor: C.border, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
  },
  timerPillWarn: { backgroundColor: "rgba(248,113,113,0.12)", borderColor: "rgba(248,113,113,0.35)" },
  timerText: { color: C.purpleLight, fontSize: 12, fontWeight: "700" },

  cardArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    width: CARD_W, height: CARD_H, borderRadius: 26, overflow: "hidden",
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    shadowColor: C.purple, shadowOpacity: 0.4, shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 }, elevation: 18,
  },
  avatarFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: C.purpleLight, fontSize: 96, fontWeight: "800" },

  stamp: {
    position: "absolute", top: 26, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 3, borderRadius: 12, backgroundColor: "rgba(8,8,16,0.35)",
  },
  stampMatch: { right: 22, transform: [{ rotate: "14deg" }], borderColor: C.match },
  stampPass: { left: 22, transform: [{ rotate: "-14deg" }], borderColor: C.pass },
  stampText: { fontSize: 26, fontWeight: "900", letterSpacing: 2 },

  scrim: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 18, paddingTop: 44, paddingBottom: 18, gap: 8,
  },
  nameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  name: { color: "#fff", fontSize: 24, fontWeight: "800", flexShrink: 1 },
  age: { color: C.muted, fontSize: 20, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { color: "#e5e7eb", fontSize: 13, fontWeight: "500", flexShrink: 1 },
  statsRow: {
    flexDirection: "row", alignItems: "center", marginTop: 2,
    backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12,
    paddingVertical: 8, paddingHorizontal: 12, gap: 10,
  },
  stat: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1, justifyContent: "center" },
  statValue: { color: C.text, fontSize: 13, fontWeight: "700" },
  statDivider: { width: 1, height: 16, backgroundColor: "rgba(255,255,255,0.12)" },

  subtitle: { color: C.muted, fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 14, paddingHorizontal: 8 },

  actions: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, marginTop: 16 },
  actionBtn: {
    width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5,
  },
  passBtn: { backgroundColor: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.4)" },
  confirmBtn: { borderRadius: 32, overflow: "hidden", flex: 1, maxWidth: 240, shadowColor: C.pink, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  confirmGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 64 },
  confirmText: { color: "#fff", fontSize: 17, fontWeight: "800" },

  celebrateWrap: { alignItems: "center", justifyContent: "center", marginBottom: 4 },
  celebrateGlow: {
    position: "absolute", width: 120, height: 120, borderRadius: 60,
    backgroundColor: "rgba(253,22,90,0.35)",
  },
  resultIcon: {
    width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center",
    borderWidth: 2, backgroundColor: "rgba(255,255,255,0.04)",
  },
  resultIconFilled: { width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center" },
  resultTitle: { color: C.text, fontSize: 24, fontWeight: "800", textAlign: "center", marginTop: 8 },
  resultSub: { color: C.muted, fontSize: 15, textAlign: "center", lineHeight: 21, paddingHorizontal: 30 },
});
