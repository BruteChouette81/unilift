import { useLanguage } from "@/context/LanguageContext";
import { useActiveRide } from "@/context/ActiveRideContext";
import { cancelRideRequest } from "@/services/rideRequestService";
import { rideLog } from "@/utils/ride-logger";
import { Ionicons } from "@expo/vector-icons";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
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
  border:      "rgba(137, 56, 213, 0.30)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
};

const SHEET_MAX_HEIGHT = Dimensions.get("window").height * 0.74;

export default function FindingDriverScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { setPendingRequest, clearPendingRequest } = useActiveRide();
  const params = useLocalSearchParams<{
    requestId: string;
    destination?: string;
    destLat?: string;
    destLng?: string;
    originLat?: string;
    originLng?: string;
    notified?: string;
  }>();

  const navigatedRef = useRef(false);

  // Persist the in-progress search so it can auto-resume if the passenger
  // closes the app before a driver accepts (restored from app/_layout.tsx).
  // The record is cleared on match, cancel, or expiry below.
  useEffect(() => {
    if (!params.requestId) return;
    setPendingRequest({
      requestId: params.requestId,
      params: {
        requestId: params.requestId,
        destination: params.destination ?? "",
        destLat: params.destLat ?? "",
        destLng: params.destLng ?? "",
        originLat: params.originLat ?? "",
        originLng: params.originLng ?? "",
        notified: params.notified ?? "0",
      },
    });
  }, [
    params.requestId,
    params.destination,
    params.destLat,
    params.destLng,
    params.originLat,
    params.originLng,
    params.notified,
    setPendingRequest,
  ]);

  // After a while with no match, reassure the passenger it's still searching.
  // The backend sweep auto-expires the request (and this screen listens for
  // that `expired` status below), so they are never left stranded.
  const [slow, setSlow] = React.useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 45000);
    return () => clearTimeout(id);
  }, []);

  // ── Radar pulse ──────────────────────────────────────────────────────────
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.timing(val, {
          toValue: 1, duration: 2200, delay,
          easing: Easing.out(Easing.ease), useNativeDriver: true,
        }),
      );
    const a = loop(pulse1, 0);
    const b = loop(pulse2, 1100);
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [pulse1, pulse2]);

  // ── Live listener for match ───────────────────────────────────────────────
  useEffect(() => {
    if (!params.requestId) return;
    const unsubscribe = onSnapshot(
      doc(db, "rideRequests", params.requestId),
      (snapshot) => {
        if (!snapshot.exists() || navigatedRef.current) return;
        const data = snapshot.data();
        const status = data?.status as string | undefined;
        const matchedRideId = data?.matchedRideId as string | undefined;
        if (status === "matched" && matchedRideId) {
          navigatedRef.current = true;
          // Keep the pending record: the passenger still has to swipe-confirm on
          // matchDriverScreen, and if they pass/expire they resume searching.
          rideLog.transition("request", "open", "matched", { requestId: params.requestId, matchedRideId });
          router.replace(
            `/matchDriverScreen?rideId=${matchedRideId}&requestId=${params.requestId}&originLat=${params.originLat ?? "0"}&originLng=${params.originLng ?? "0"}&destLat=${params.destLat ?? "0"}&destLng=${params.destLng ?? "0"}`,
          );
        } else if (status === "cancelled" || status === "expired") {
          clearPendingRequest();
          rideLog.transition("request", "open", status, { requestId: params.requestId });
          router.back();
        }
      },
      (error) => console.warn("rideRequest listener error", error),
    );
    return () => unsubscribe();
  }, [params.requestId, params.originLat, params.originLng, params.destLat, params.destLng, router, clearPendingRequest]);

  const handleCancel = async () => {
    clearPendingRequest();
    if (params.requestId) await cancelRideRequest(params.requestId).catch(() => {});
    router.back();
  };

  const ringStyle = (val: Animated.Value) => ({
    opacity:   val.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.6] }) }],
  });

  const swipePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 50 || gs.vy > 0.3) void handleCancel();
      },
    }),
  ).current;

  const statusText = slow
    ? t("finding.stillSearching")
    : Number(params.notified) > 0
      ? t("finding.notifiedDrivers", { count: Number(params.notified) })
      : t("finding.searching");

  return (
    <View style={styles.overlay}>
      {/* tap outside to cancel */}
      <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleCancel} activeOpacity={1} />

      <View style={[styles.sheet, { maxHeight: SHEET_MAX_HEIGHT }]}>
        <BlurView
          intensity={80}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={[styles.blur, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
        >

          {/* Drag handle */}
          <View style={styles.dragZone} {...swipePan.panHandlers}>
            <View style={styles.handle} />
          </View>

          {/* Radar */}
          <View style={styles.radarWrap}>
            <Animated.View style={[styles.ring, ringStyle(pulse1)]} />
            <Animated.View style={[styles.ring, ringStyle(pulse2)]} />
            <View style={styles.core}>
              <Ionicons name="car-sport" size={34} color="#2d0015" />
            </View>
          </View>

          {/* Status */}
          <Text style={styles.title}>{t("finding.title")}</Text>
          <Text style={styles.subtitle}>{statusText}</Text>

          {/* Destination chip */}
          {params.destination ? (
            <View style={styles.destChip}>
              <Ionicons name="flag" size={13} color={C.purpleLight} />
              <Text style={styles.destChipText} numberOfLines={1}>{params.destination}</Text>
            </View>
          ) : null}

          {/* Hint */}
          <View style={styles.hintCard}>
            <Ionicons name="information-circle-outline" size={16} color={C.muted} />
            <Text style={styles.hintText}>{t("finding.hint")}</Text>
          </View>

          {/* Cancel */}
          <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} activeOpacity={0.8}>
            <Text style={styles.cancelText}>{t("finding.cancel")}</Text>
          </TouchableOpacity>

        </BlurView>
      </View>
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
    alignItems: "center",
    paddingHorizontal: 24,
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
  radarWrap: {
    width: 190,
    height: 190,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  ring: {
    position: "absolute",
    width: 116,
    height: 116,
    borderRadius: 58,
    backgroundColor: "rgba(137,56,213,0.35)",
    borderWidth: 1,
    borderColor: "rgba(224,154,247,0.4)",
  },
  core: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e09af7",
    shadowColor: C.purple,
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  title: {
    color: C.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: C.muted,
    fontSize: 14,
    marginTop: 6,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  destChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(137,56,213,0.12)",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: "85%",
    marginBottom: 16,
  },
  destChipText: {
    color: C.purpleLight,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  hintCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: "100%",
    marginBottom: 20,
  },
  hintText: {
    color: C.muted,
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  cancelBtn: {
    width: "100%",
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.30)",
    backgroundColor: "rgba(248,113,113,0.08)",
  },
  cancelText: {
    color: C.danger,
    fontSize: 15,
    fontWeight: "700",
  },
});
