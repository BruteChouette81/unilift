import { useDebouncedValue } from "@/hooks/use-debounced-value";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Location from "expo-location";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useLanguage } from "@/context/LanguageContext";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { createRide, geoSuggestion } from "../services/rideServices";

// ─── Design Tokens ──────────────────────────────────────────────────────────
const C = {
  bg:          "#0a0618",
  surface:     "#110d22",
  surfaceAlt:  "#160f2e",
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  blue:        "#FD165A",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
  gold:        "#fbbf24",
  success:     "#34d399",
};

const HEADER_GRADIENT = ["#2d0015", "#1c0038"] as const;
const CARD_GRADIENT   = ["#1e1b4b", "#0d1224"] as const;
const BTN_GRADIENT    = ["#FD165A", "#8938D5"] as const;
const BTN_GREEN       = ["#059669", "#34d399"] as const;

// ─── Section Header ──────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={sh.row}>
      <View style={sh.iconDot}>
        <Text style={{fontSize: 12}}>{icon}</Text>
      </View>
      <Text style={sh.title}>{title}</Text>
    </View>
  );
}

const sh = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, marginTop: 22 },
  iconDot: { width: 26, height: 26, borderRadius: 7, backgroundColor: "rgba(167,139,250,0.12)", alignItems: "center", justifyContent: "center" },
  title:   { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
});

// ─── Main Component ──────────────────────────────────────────────────────────
export default function CreateRideScreen(props: { cancelCreate: () => void }) {
  const { t, language } = useLanguage();
  const [destination, setDestination]         = useState("");
  const [date, setDate]                       = useState(new Date());
  const [showPicker, setShowPicker]           = useState(false);
  const [seats, setSeats]                     = useState("1");
  const [suggestions, setSuggestions]         = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [liveRide, setLiveRide]               = useState(true);
  const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lng: number }>();
  const suppressSuggestionsRef = useRef(false);
  const debouncedDestination = useDebouncedValue(destination, 450);

  const onDestinationChange = (text: string) => {
    suppressSuggestionsRef.current = false;
    setDestination(text);
    setShowSuggestions(false);
  };

  async function getUserLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") throw new Error("Location permission denied");
    const pos = await Location.getCurrentPositionAsync({});
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  }

  async function handleSubmit() {
    if (!destination || !seats) {
      Alert.alert(t("createRide.missingFieldsTitle"), t("createRide.missingFieldsMsg"));
      return;
    }
    try {
      const loc = await getUserLocation();
      const resjson = await createRide({
        destination,
        date: date.toISOString(),
        seatsAvailable: parseInt(seats),
        geopoint: { latitude: loc.latitude, longitude: loc.longitude },
        destinationCoords: { lat: destinationCoords?.lat, lng: destinationCoords?.lng },
        started: liveRide,
      });
      console.log(resjson);
      const rideId = resjson.name.split("/").pop();

      if (liveRide) {
        Alert.alert(t("createRide.successTitle"), t("createRide.rideCreated"));
        router.replace(
          `/riderScreen?rideId=${rideId}&maxSeat=${seats}&Originlat=${loc.latitude}&OriginLng=${loc.longitude}&Destination=${encodeURIComponent(destination)}&DestinationLat=${destinationCoords?.lat ?? 0}&DestinationLng=${destinationCoords?.lng ?? 0}`,
        );
      } else {
        Alert.alert(t("createRide.successTitle"), t("createRide.ridePlanned"));
        props.cancelCreate();
      }
    } catch (err) {
      console.error(err);
      Alert.alert(t("createRide.failedTitle"), t("createRide.failedMsg"));
    }
  }

  const onSelectSuggestion = (value: string, lat: number, lng: number) => {
    suppressSuggestionsRef.current = true;
    const destString = value.split(",")[0] + " " + value.split(",")[1];
    setDestination(destString);
    setDestinationCoords({ lat, lng });
    setShowSuggestions(false);
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (suppressSuggestionsRef.current) {
        suppressSuggestionsRef.current = false;
        return;
      }
      if (debouncedDestination.length < 2) {
        setShowSuggestions(false);
        return;
      }
      const results = await geoSuggestion(debouncedDestination.trim());
      if (cancelled) return;
      setSuggestions(results ?? []);
      setShowSuggestions((results?.length ?? 0) > 0);
    };
    void run();
    return () => { cancelled = true; };
  }, [debouncedDestination]);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <LinearGradient colors={HEADER_GRADIENT} style={styles.header}>
        <View style={styles.headerContent}>
          <LinearGradient colors={CARD_GRADIENT} style={styles.headerIcon}>
            <Text style={{fontSize: 20}}>🚗</Text>
          </LinearGradient>
          <View>
            <Text style={styles.headerTitle}>{t("createRide.headerTitle")}</Text>
            <Text style={styles.headerSub}>{t("createRide.headerSub")}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.body}>
        {/* ── Destination ───────────────────────────────────────────────────── */}
        <SectionHeader icon="📍" title={t("createRide.destination")} />
        <View style={styles.card}>
          {/* Origin row */}
          <View style={styles.inputRow}>
            <View style={styles.dotGreen} />
            <Text style={styles.originLabel}>{t("createRide.currentLocation")}</Text>
          </View>
          <View style={styles.routeLine} />

          {/* Destination input */}
          <View style={styles.inputRow}>
            <View style={styles.dotPurple} />
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder={t("createRide.destinationPlaceholder")}
                placeholderTextColor={C.dim}
                value={destination}
                onChangeText={onDestinationChange}
              />
              {destination.length > 0 && (
                <TouchableOpacity onPress={() => { setDestination(""); setShowSuggestions(false); }}>
                  <Text style={{fontSize: 14}}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Suggestions */}
          {showSuggestions && suggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {suggestions.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  onPress={() => onSelectSuggestion(item?.displayName, item?.lat, item?.lon)}
                  style={[styles.suggestionItem, index === suggestions.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <Text style={[{fontSize: 12}, { marginRight: 8 }]}>📍</Text>
                  <Text style={styles.suggestionText} numberOfLines={1}>{item?.displayName}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* ── Seats ────────────────────────────────────────────────────────── */}
        <SectionHeader icon="👥" title={t("createRide.availableSeats")} />
        <View style={styles.card}>
          <View style={styles.seatsRow}>
            <TouchableOpacity
              style={styles.seatBtn}
              onPress={() => setSeats(s => String(Math.max(1, parseInt(s) - 1)))}
            >
              <Text style={styles.seatBtnText}>−</Text>
            </TouchableOpacity>

            <View style={styles.seatDisplay}>
              <Text style={styles.seatNumber}>{seats}</Text>
              <Text style={styles.seatLabel}>{t("rides.seat", { count: parseInt(seats) })}</Text>
            </View>

            <TouchableOpacity
              style={styles.seatBtn}
              onPress={() => setSeats(s => String(Math.min(7, parseInt(s) + 1)))}
            >
              <Text style={styles.seatBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          {/* ── Car visual ────────────────────────────────────────────────── */}
          <View style={styles.carWrap}>
            {/* Windshield */}
            <View style={styles.carWindshield} />
            <View style={styles.carBody}>
              {/* Front row: driver (always filled) + seat 1 */}
              <View style={styles.carRow}>
                <View style={[styles.carSeat, styles.carSeatDriver]}>
                  <Text style={styles.carSeatIcon}>🧑</Text>
                  <Text style={styles.carSeatDriverLabel}>You</Text>
                </View>
                <View style={[styles.carSeat, parseInt(seats) >= 1 && styles.carSeatFilled]}>
                  {parseInt(seats) >= 1
                    ? <Text style={styles.carSeatIcon}>💺</Text>
                    : <View style={styles.carSeatEmpty} />}
                </View>
              </View>
              {/* Back rows: seats 2-3, 4-5, 6-7 */}
              {([[2,3],[4,5],[6,7]] as [number,number][]).map(([a, b]) => (
                <View key={a} style={styles.carRow}>
                  {[a, b].map(n => (
                    <View key={n} style={[styles.carSeat, parseInt(seats) >= n && styles.carSeatFilled]}>
                      {parseInt(seats) >= n
                        ? <Text style={styles.carSeatIcon}>💺</Text>
                        : <View style={styles.carSeatEmpty} />}
                    </View>
                  ))}
                </View>
              ))}
            </View>
            {/* Boot */}
            <View style={styles.carBoot} />
          </View>
        </View>

        {/* ── Ride Type ─────────────────────────────────────────────────────── */}
        <SectionHeader icon="⚡" title={t("createRide.rideType")} />
        <View style={styles.card}>
          <View style={styles.rideTypeRow}>
            <TouchableOpacity
              onPress={() => setLiveRide(true)}
              activeOpacity={0.8}
              style={[styles.rideTypeOption, liveRide && styles.rideTypeActiveLive]}
            >
              <Text style={{fontSize: 18}}>📡</Text>
              <Text style={[styles.rideTypeLabel, liveRide && { color: C.success }]}>{t("createRide.live")}</Text>
              <Text style={styles.rideTypeSub}>{t("createRide.liveStart")}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setLiveRide(false)}
              activeOpacity={0.8}
              style={[styles.rideTypeOption, !liveRide && styles.rideTypeActivePlanned]}
            >
              <Text style={{fontSize: 18}}>📅</Text>
              <Text style={[styles.rideTypeLabel, !liveRide && { color: C.purpleLight }]}>{t("createRide.planned")}</Text>
              <Text style={styles.rideTypeSub}>{t("createRide.plannedSchedule")}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Date & Time (planned only) ────────────────────────────────────── */}
        {!liveRide && (
          <>
            <SectionHeader icon="⏱" title={t("createRide.dateTime")} />
            <View style={styles.card}>
              <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.dateButton}>
                <View style={styles.dateIconWrap}>
                  <Text style={{fontSize: 14}}>📅</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dateLabel}>{t("createRide.departure")}</Text>
                  <Text style={styles.dateValue}>
                    {date.toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA")} — {date.toLocaleTimeString(language === "fr" ? "fr-CA" : "en-CA", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
                <Text style={{fontSize: 14, color: C.muted}}>›</Text>
              </TouchableOpacity>

              {showPicker && (
                <DateTimePicker
                  value={date}
                  mode="datetime"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  onChange={(event, selectedDate) => {
                    if (event.type === "dismissed") { setShowPicker(false); return; }
                    if (selectedDate) {
                      const cleanDate = new Date(selectedDate);
                      cleanDate.setMinutes(0);
                      cleanDate.setSeconds(0);
                      setDate(cleanDate);
                    }
                    if (Platform.OS === "android") setShowPicker(false);
                  }}
                />
              )}

              {Platform.OS === "ios" && showPicker && (
                <TouchableOpacity onPress={() => setShowPicker(false)} style={styles.doneButton}>
                  <Text style={styles.doneText}>{t("createRide.done")}</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        {/* ── Actions ───────────────────────────────────────────────────────── */}
        <TouchableOpacity onPress={handleSubmit} style={styles.submitBtn} activeOpacity={0.85}>
          <LinearGradient
            colors={liveRide ? BTN_GREEN : BTN_GRADIENT}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.submitGrad}
          >
            <Text style={{fontSize: 16}}>{liveRide ? "🟢" : "📅"}</Text>
            <Text style={styles.submitText}>{liveRide ? t("createRide.startRideNow") : t("createRide.planRide")}</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity onPress={props.cancelCreate} style={styles.cancelBtn} activeOpacity={0.8}>
          <Text style={styles.cancelText}>{t("createRide.cancel")}</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: { paddingTop: 56, paddingBottom: 24, paddingHorizontal: 20 },
  headerContent: { flexDirection: "row", alignItems: "center", gap: 14 },
  headerIcon: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.border,
  },
  headerTitle: { color: C.text, fontSize: 22, fontWeight: "800" },
  headerSub:   { color: "rgba(255,255,255,0.55)", fontSize: 13, marginTop: 2 },

  // ── Body ────────────────────────────────────────────────────────────────────
  body: { paddingHorizontal: 16, paddingBottom: 20 },

  // ── Card ────────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.borderFaint,
  },

  // ── Route rows ──────────────────────────────────────────────────────────────
  inputRow:    { flexDirection: "row", alignItems: "center", gap: 10 },
  routeLine:   { width: 2, height: 14, backgroundColor: C.border, marginLeft: 6, marginVertical: 4 },
  dotGreen:    { width: 12, height: 12, borderRadius: 6, backgroundColor: C.success, borderWidth: 2, borderColor: "rgba(52,211,153,0.3)" },
  dotPurple:   { width: 12, height: 12, borderRadius: 6, backgroundColor: C.purple, borderWidth: 2, borderColor: C.border },
  originLabel: { color: C.muted, fontSize: 14, fontStyle: "italic" },

  // ── Input ───────────────────────────────────────────────────────────────────
  inputWrapper: {
    flex: 1, flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.09)",
    borderRadius: 10, paddingHorizontal: 12,
  },
  input: { flex: 1, paddingVertical: 10, fontSize: 14, color: C.text },

  // ── Suggestions ─────────────────────────────────────────────────────────────
  suggestionsContainer: {
    marginTop: 10,
    backgroundColor: C.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.borderFaint,
    overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 11, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: C.borderFaint,
  },
  suggestionText: { color: C.text, fontSize: 13, flex: 1 },

  // ── Ride Type Toggle ────────────────────────────────────────────────────────
  rideTypeRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rideTypeOption: {
    flex: 1, borderRadius: 12, padding: 12, gap: 3,
    borderWidth: 1, borderColor: "transparent",
  },
  rideTypeActive: { borderColor: C.border },
  rideTypeLabel:  { color: C.dim, fontSize: 13, fontWeight: "700" },
  rideTypeSub:    { color: C.dim, fontSize: 11 },

  // ── Date Picker ─────────────────────────────────────────────────────────────
  dateButton: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.09)",
  },
  dateIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: "rgba(167,139,250,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  dateLabel: { color: C.muted, fontSize: 11, marginBottom: 2 },
  dateValue: { color: C.text, fontSize: 14, fontWeight: "600" },
  doneButton: {
    marginTop: 12, alignSelf: "flex-end",
    backgroundColor: C.purple, borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 16,
  },
  doneText: { color: "#fff", fontSize: 14, fontWeight: "600" },

  // ── Seats ───────────────────────────────────────────────────────────────────
  seatsRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  seatBtn: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: "rgba(124,58,237,0.12)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.border,
  },
  seatDisplay: { alignItems: "center" },
  seatNumber:  { color: C.text, fontSize: 28, fontWeight: "800" },
  seatLabel:   { color: C.muted, fontSize: 12, marginTop: -2 },

  // ── Submit ──────────────────────────────────────────────────────────────────
  submitBtn:  { marginTop: 28, borderRadius: 14, overflow: "hidden" },
  submitGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 16,
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  // ── Cancel ──────────────────────────────────────────────────────────────────
  cancelBtn: {
    marginTop: 12, paddingVertical: 14, borderRadius: 14,
    alignItems: "center", borderWidth: 1, borderColor: "rgba(248,113,113,0.25)",
    backgroundColor: "rgba(248,113,113,0.06)",
  },
  cancelText: { color: C.danger, fontSize: 15, fontWeight: "600" },

  // ── Seat buttons ────────────────────────────────────────────────────────────
  seatBtnText: { color: C.purpleLight, fontSize: 22, fontWeight: "700", lineHeight: 26 },

  // ── Car visual ──────────────────────────────────────────────────────────────
  carWrap: {
    alignItems: "center",
    marginTop: 20,
    marginBottom: 4,
  },
  carWindshield: {
    width: 80,
    height: 18,
    backgroundColor: "rgba(137,56,213,0.18)",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderBottomWidth: 0,
  },
  carBody: {
    backgroundColor: "rgba(137,56,213,0.10)",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 8,
    gap: 6,
    width: 110,
  },
  carRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 6,
  },
  carSeat: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  carSeatDriver: {
    backgroundColor: "rgba(52,211,153,0.15)",
    borderColor: "rgba(52,211,153,0.35)",
  },
  carSeatFilled: {
    backgroundColor: "rgba(137,56,213,0.2)",
    borderColor: "rgba(137,56,213,0.45)",
  },
  carSeatEmpty: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderStyle: "dashed",
  },
  carSeatIcon: { fontSize: 16 },
  carSeatDriverLabel: {
    fontSize: 9,
    color: C.success,
    fontWeight: "700",
    marginTop: 1,
  },
  carBoot: {
    width: 60,
    height: 12,
    backgroundColor: "rgba(137,56,213,0.18)",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderTopWidth: 0,
  },

  // ── Ride type active states ──────────────────────────────────────────────────
  rideTypeActiveLive: {
    borderColor: "rgba(52,211,153,0.5)",
    backgroundColor: "rgba(52,211,153,0.07)",
  },
  rideTypeActivePlanned: {
    borderColor: C.border,
    backgroundColor: "rgba(137,56,213,0.07)",
  },
});
