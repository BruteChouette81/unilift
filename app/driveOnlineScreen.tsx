import InfoButton from "@/components/info-button";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchHistory } from "@/hooks/use-search-history";
import { patchUserField } from "@/components/userHelper";
import { goOnline } from "@/services/driverSessionService";
import {
  registerForPushNotifications,
  savePushTokenToFirestore,
} from "@/services/notificationService";
import { geoSuggestion } from "@/services/rideServices";
import { WEEKDAY_KEYS } from "@/types/models";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { BlurView } from "expo-blur";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getAuth } from "firebase/auth";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  bg: "#080810", surface: "#0f0f1e", surfaceAlt: "#13132a",
  border: "rgba(137, 56, 213, 0.30)", borderFaint: "rgba(255, 255, 255, 0.06)",
  purple: "#8938D5", purpleLight: "#e09af7", pink: "#FD165A", blue: "#60a5fa",
  gold: "#fbbf24", text: "#f3f4f6", muted: "#9ca3af", dim: "#4b5563",
  success: "#34d399", inputBg: "rgba(15, 15, 30, 0.55)",
};
const GO_GRADIENT = ["#059669", "#34d399"] as const;

type SuggestionKind = "geo" | "home" | "favorite" | "history";
type Suggestion = { displayName: string; lat: string; lon: string; kind: SuggestionKind };

function suggestionIcon(kind: SuggestionKind): { name: "home-outline" | "star" | "time-outline" | "location-outline"; color: string } {
  switch (kind) {
    case "home":     return { name: "home-outline",     color: C.blue };
    case "favorite": return { name: "star",             color: C.gold };
    case "history":  return { name: "time-outline",     color: C.muted };
    default:         return { name: "location-outline", color: C.purpleLight };
  }
}

export default function DriveOnlineScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { userData, updateUserData } = useUserProfile();
  const { history: searchHistory, addToHistory } = useSearchHistory(user?.uid);
  const params = useLocalSearchParams<{ destName?: string; destLat?: string; destLng?: string }>();

  const paramDestName = params.destName ? decodeURIComponent(params.destName) : undefined;
  const paramDestLat = params.destLat ? parseFloat(params.destLat) : undefined;
  const paramDestLng = params.destLng ? parseFloat(params.destLng) : undefined;
  const hasParamDest = paramDestName && paramDestLat != null && paramDestLng != null &&
    Number.isFinite(paramDestLat) && Number.isFinite(paramDestLng);

  const [destination, setDestination] = useState(
    hasParamDest ? paramDestName : (userData?.driverDefaultDestination ?? ""),
  );
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | undefined>(
    hasParamDest
      ? { lat: paramDestLat!, lng: paramDestLng! }
      : userData?.driverDefaultDestinationCoords
        ? { lat: userData.driverDefaultDestinationCoords.latitude, lng: userData.driverDefaultDestinationCoords.longitude }
        : undefined,
  );
  const [seats, setSeats] = useState(String(3));
  const [matchRadius, setMatchRadius] = useState(userData?.driverDestinationRadiusKm ?? 10);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [destFocused, setDestFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notifSheetVisible, setNotifSheetVisible] = useState(false);
  const pendingGoOnlineRef = useRef(false);

  const suppressRef = useRef(false);
  const debouncedDest = useDebouncedValue(destination, 700);
  const favorites = userData?.favorite ?? [];

  const onDestChange = (text: string) => {
    suppressRef.current = false;
    setDestination(text);
    setDestCoords(undefined);
    setShowSuggestions(false);
  };

  const onSelectSuggestion = (item: Suggestion) => {
    suppressRef.current = true;
    const parts = item.displayName.split(",");
    setDestination((parts[0] + (parts[1] ? " " + parts[1] : "")).trim());
    setDestCoords({ lat: parseFloat(item.lat), lng: parseFloat(item.lon) });
    setShowSuggestions(false);
    if (item.kind === "geo" || item.kind === "favorite" || item.kind === "history") {
      addToHistory({ displayName: item.displayName, lat: item.lat, lon: item.lon });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (suppressRef.current) { suppressRef.current = false; return; }
      const q = debouncedDest.trim().toLowerCase();
      if (q.length === 0) {
        if (searchHistory.length > 0) {
          setSuggestions(searchHistory.map((h) => ({ displayName: h.displayName, lat: h.lat, lon: h.lon, kind: "history" as const })));
          setShowSuggestions(destFocused);
        } else setShowSuggestions(false);
        return;
      }
      const local: Suggestion[] = [];
      if (userData?.homeAddress && (q.includes("home") || q.includes("maison") || userData.homeAddress.toLowerCase().includes(q))) {
        const coords = userData.homeAddressCoords ?? (userData.localisation.latitude && userData.localisation.longitude
          ? { latitude: userData.localisation.latitude, longitude: userData.localisation.longitude } : null);
        if (coords) local.push({ displayName: userData.homeAddress, lat: String(coords.latitude), lon: String(coords.longitude), kind: "home" });
      }
      for (const fav of favorites) {
        if (fav.destination.toLowerCase().includes(q)) {
          local.push({ displayName: fav.destination, lat: String(fav.destinationGeo.lat), lon: String(fav.destinationGeo.lon), kind: "favorite" });
        }
      }
      if (local.length > 0) { setSuggestions(local); setShowSuggestions(true); }
      if (q.length < 2) return;
      const results = await geoSuggestion(debouncedDest.trim());
      if (cancelled) return;
      const geo: Suggestion[] = (results ?? []).map((r) => ({ displayName: r.displayName, lat: r.lat, lon: r.lon, kind: "geo" as const }));
      const combined = [...local, ...geo];
      setSuggestions(combined);
      setShowSuggestions(combined.length > 0);
    };
    void run();
    return () => { cancelled = true; };
  }, [debouncedDest, searchHistory, favorites, userData, destFocused]);

  async function getUserLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") throw new Error("Location permission denied");
    const pos = await Location.getCurrentPositionAsync({});
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  }

  // Request push permission (or nudge to Settings if already denied),
  // then proceed with going online. Shows the pre-permission sheet first
  // when permission is undetermined so drivers see the 70% stat before
  // the native OS dialog appears.
  async function checkNotifThenGoOnline() {
    if (!destination || !destCoords) {
      Alert.alert(t("driveOnline.missingTitle"), t("driveOnline.missingMsg"));
      return;
    }
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "undetermined") {
      // Show our pre-permission sheet — it will call goOnlineAfterPermission
      pendingGoOnlineRef.current = true;
      setNotifSheetVisible(true);
      return;
    }
    if (status === "denied") {
      Alert.alert(
        "Notifications désactivées",
        "Active les notifications dans Réglages pour recevoir 70 % plus de demandes de lift.",
        [
          { text: "Réglages", onPress: () => Linking.openSettings() },
          { text: "Continuer sans", onPress: () => void goOnlineNow() },
        ],
      );
      return;
    }
    // Already granted — proceed immediately
    void goOnlineNow();
  }

  async function goOnlineNow() {
    if (submitting || !user || !destCoords) return;
    setSubmitting(true);
    try {
      const origin = await getUserLocation();

      // Going online implies today is an available day — merge it into the
      // per-day schedule so dispatch (which gates on driverDays) includes us.
      const todayKey = WEEKDAY_KEYS[new Date().getDay()];
      const currentDays = userData?.driverDays ?? [];
      if (!currentDays.includes(todayKey)) {
        const nextDays = [...currentDays, todayKey];
        const token = await user.getIdToken();
        await patchUserField(token, user.uid, {
          driverDays: { arrayValue: { values: nextDays.map((d) => ({ stringValue: d })) } },
        }).catch(() => {});
        updateUserData({ driverDays: nextDays });
      }

      await goOnline({
        origin,
        destination,
        destinationCoords: destCoords,
        seats: parseInt(seats) || 1,
        maxDetourKm: userData?.driverMaxDetourKm ?? 10,
        destinationRadiusKm: matchRadius,
      });
      router.replace("/driverRequestsScreen");
    } catch (err) {
      console.error(err);
      Alert.alert(t("driveOnline.failedTitle"), t("driveOnline.failedMsg"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <View style={styles.backBtnGrad}>
            <Ionicons name="arrow-back" size={18} color="#2d0015" />
          </View>
        </Pressable>
        <Text style={styles.headerTitle}>{t("driveOnline.title")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <LinearGradient colors={["#06281d", "#08120e"]} style={styles.hero}>
          <View style={styles.pulseDot} />
          <Text style={styles.heroTitle}>{t("driveOnline.heroTitle")}</Text>
          <Text style={styles.heroSub}>{t("driveOnline.heroSub")}</Text>
        </LinearGradient>

        {/* Destination */}
        <Text style={styles.label}>{t("driveOnline.destinationLabel")}</Text>
        <View style={[styles.inputRow, destFocused && styles.inputRowFocused]}>
          <Ionicons name="navigate-outline" size={18} color={C.muted} style={{ marginRight: 10 }} />
          <TextInput
            style={styles.textInput}
            placeholder={t("driveOnline.destinationPlaceholder")}
            placeholderTextColor={C.muted}
            value={destination}
            onChangeText={onDestChange}
            onFocus={() => setDestFocused(true)}
            onBlur={() => setDestFocused(false)}
          />
          {destination.length > 0 && (
            <TouchableOpacity onPress={() => { setDestination(""); setDestCoords(undefined); setShowSuggestions(false); }}>
              <Ionicons name="close-circle" size={18} color={C.muted} />
            </TouchableOpacity>
          )}
        </View>
        {showSuggestions && suggestions.length > 0 && (
          <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.suggestions}>
            {suggestions.map((item, i) => {
              const icon = suggestionIcon(item.kind);
              return (
                <TouchableOpacity key={`${item.kind}-${i}`} onPress={() => onSelectSuggestion(item)}
                  style={[styles.suggestionItem, i === suggestions.length - 1 && { borderBottomWidth: 0 }]}>
                  <Ionicons name={icon.name} size={14} color={icon.color} style={{ marginRight: 10 }} />
                  <Text style={styles.suggestionText} numberOfLines={1}>{item.displayName}</Text>
                </TouchableOpacity>
              );
            })}
          </BlurView>
        )}

        {/* Seats */}
        <Text style={[styles.label, { marginTop: 24 }]}>{t("createRide.availableSeats")}</Text>
        <View style={styles.seatsCard}>
          <TouchableOpacity style={styles.seatBtn} onPress={() => setSeats((s) => String(Math.max(1, parseInt(s) - 1)))}>
            <Text style={styles.seatBtnText}>−</Text>
          </TouchableOpacity>
          <View style={styles.seatDisplay}>
            <Text style={styles.seatNumber}>{seats}</Text>
            <Text style={styles.seatLabel}>{t("rides.seat", { count: parseInt(seats) })}</Text>
          </View>
          <TouchableOpacity style={styles.seatBtn} onPress={() => setSeats((s) => String(Math.min(7, parseInt(s) + 1)))}>
            <Text style={styles.seatBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        {/* Destination match radius */}
        <View style={[styles.labelRow, { marginTop: 24 }]}>
          <Text style={styles.label}>{t("createRide.matchRadius")}</Text>
          <InfoButton title={t("createRide.info.matchRadius.title")} body={t("createRide.info.matchRadius.body")} />
        </View>
        <View style={styles.detourCard}>
          <View style={styles.detourValueRow}>
            <Ionicons name="locate-outline" size={18} color={C.purpleLight} />
            <Text style={styles.detourValue}>{matchRadius} {t("createRide.matchRadiusUnit")}</Text>
          </View>
          <Slider
            style={{ width: "100%", height: 36, marginTop: 6 }}
            minimumValue={1} maximumValue={30} step={1} value={matchRadius}
            onValueChange={setMatchRadius}
            minimumTrackTintColor={C.purple} maximumTrackTintColor={C.dim} thumbTintColor={C.purpleLight}
          />
        </View>

        {/* Go online */}
        <Pressable onPress={checkNotifThenGoOnline} disabled={submitting} style={{ marginTop: 30 }}>
          <LinearGradient colors={GO_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.goBtn, submitting && { opacity: 0.7 }]}>
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="radio-outline" size={20} color="#fff" />
                <Text style={styles.goBtnText}>{t("driveOnline.goOnline")}</Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Notification pre-permission sheet ──────────────────────────── */}
      <Modal
        visible={notifSheetVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setNotifSheetVisible(false)}
      >
        <View style={notif.overlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setNotifSheetVisible(false)}
            activeOpacity={1}
          />
          <View style={[notif.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={notif.blur}>

              {/* Handle */}
              <View style={notif.dragZone}>
                <View style={notif.handle} />
              </View>

              {/* Icon */}
              <View style={notif.iconWrap}>
                <View style={notif.iconGrad}>
                  <Ionicons name="notifications" size={28} color="#2d0015" />
                </View>
              </View>

              {/* Stat */}
              <Text style={notif.stat}>+70 %</Text>
              <Text style={notif.statSub}>de chances de trouver un passager</Text>

              {/* Body */}
              <Text style={notif.body}>
                {"Les conducteurs avec les notifications activées reçoivent des demandes de lift en temps réel — dès qu'un passager est à portée."}{"\n\n"}
                {"Sans notifications, tu pourrais manquer des courses pendant que l'app est en arrière-plan."}
              </Text>

              {/* CTA */}
              <TouchableOpacity
                style={notif.ctaWrap}
                activeOpacity={0.85}
                onPress={async () => {
                  setNotifSheetVisible(false);
                  // Request the native OS dialog now that the user is primed
                  try {
                    const token = await registerForPushNotifications();
                    if (token && user) {
                      const idToken = await getAuth().currentUser?.getIdToken();
                      if (idToken) await savePushTokenToFirestore(user.uid, token, idToken);
                    }
                  } catch { /* non-fatal */ }
                  if (pendingGoOnlineRef.current) {
                    pendingGoOnlineRef.current = false;
                    void goOnlineNow();
                  }
                }}
              >
                <View style={notif.ctaGrad}>
                  <Ionicons name="notifications" size={18} color="#2d0015" />
                  <Text style={notif.ctaText}>Activer les notifications</Text>
                </View>
              </TouchableOpacity>

              {/* Skip */}
              <TouchableOpacity
                style={notif.skip}
                onPress={() => {
                  setNotifSheetVisible(false);
                  if (pendingGoOnlineRef.current) {
                    pendingGoOnlineRef.current = false;
                    void goOnlineNow();
                  }
                }}
                activeOpacity={0.7}
              >
                <Text style={notif.skipText}>Continuer sans notifications</Text>
              </TouchableOpacity>

            </BlurView>
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 56 : 20, paddingBottom: 14,
    backgroundColor: "rgba(8,8,16,0.97)", borderBottomWidth: 1, borderBottomColor: "rgba(137,56,213,0.20)",
  },
  backBtn: { borderRadius: 10, overflow: "hidden" },
  backBtnGrad: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: C.purpleLight },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: "700" },
  scroll: { padding: 20 },

  hero: {
    borderRadius: 20, padding: 20, alignItems: "center", gap: 6, marginBottom: 24,
    borderWidth: 1, borderColor: "rgba(52,211,153,0.30)",
  },
  pulseDot: {
    width: 14, height: 14, borderRadius: 7, backgroundColor: C.success, marginBottom: 6,
    shadowColor: C.success, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  heroTitle: { color: C.text, fontSize: 18, fontWeight: "800" },
  heroSub: { color: C.muted, fontSize: 13, textAlign: "center", lineHeight: 18, paddingHorizontal: 8 },

  labelRow: { flexDirection: "row", alignItems: "center" },
  label: { color: C.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },

  inputRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: C.inputBg, borderWidth: 1,
    borderColor: C.border, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 14,
  },
  inputRowFocused: { borderColor: "rgba(137,56,213,0.7)" },
  textInput: { flex: 1, color: C.text, fontSize: 15 },
  suggestions: {
    marginTop: 6, backgroundColor: "rgba(10,10,22,0.88)", borderRadius: 18, borderWidth: 1,
    borderColor: C.border, overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: "rgba(137,56,213,0.12)",
  },
  suggestionText: { color: C.text, fontSize: 14, flex: 1 },

  seatsCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(137,56,213,0.06)", borderWidth: 1, borderColor: C.border, borderRadius: 20, padding: 18,
  },
  seatBtn: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(137,56,213,0.15)",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border,
  },
  seatBtnText: { color: C.purpleLight, fontSize: 22, fontWeight: "700", lineHeight: 26 },
  seatDisplay: { alignItems: "center" },
  seatNumber: { color: C.text, fontSize: 28, fontWeight: "800" },
  seatLabel: { color: C.muted, fontSize: 12, marginTop: -2 },

  detourCard: {
    backgroundColor: "rgba(137,56,213,0.06)", borderWidth: 1, borderColor: C.border, borderRadius: 20, padding: 18,
  },
  detourValueRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detourValue: { color: C.text, fontSize: 20, fontWeight: "800" },

  goBtn: { height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  goBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});

const notif = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.60)",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "rgba(137,56,213,0.30)",
    shadowColor: "#8938D5",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  blur: {
    paddingHorizontal: 24,
    alignItems: "center",
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
  iconWrap: {
    marginTop: 8,
    marginBottom: 20,
    shadowColor: "#8938D5",
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  iconGrad: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.purpleLight,
  },
  stat: {
    color: "#f3f4f6",
    fontSize: 52,
    fontWeight: "900",
    lineHeight: 56,
    letterSpacing: -1,
  },
  statSub: {
    color: "#e09af7",
    fontSize: 15,
    fontWeight: "600",
    marginTop: 4,
    marginBottom: 20,
    textAlign: "center",
  },
  body: {
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 28,
    paddingHorizontal: 4,
  },
  ctaWrap: {
    borderRadius: 16,
    overflow: "hidden",
    width: "100%",
    marginBottom: 12,
  },
  ctaGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
    backgroundColor: C.purpleLight,
  },
  ctaText: {
    color: "#2d0015",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  skip: {
    paddingVertical: 12,
    alignItems: "center",
  },
  skipText: {
    color: "#4b5563",
    fontSize: 13,
    fontWeight: "500",
  },
});
