import DateTimePicker from "@react-native-community/datetimepicker";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLanguage } from "@/context/LanguageContext";
import * as Location from "expo-location";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { createRide, geoSuggestion } from "@/services/rideServices";
import { ActivityIndicator } from "react-native";

// ─── Design Tokens (matches profileSettings) ─────────────────────────────────
const C = {
  bg:          "#0a0618",
  surface:     "#110d22",
  surfaceAlt:  "#160f2e",
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
  success:     "#34d399",
  inputBg:     "rgba(255, 255, 255, 0.05)",
  inputBorder: "rgba(137, 56, 213, 0.2)",
  inputFocus:  "rgba(137, 56, 213, 0.7)",
};

const BTN_GRADIENT = ["#FD165A", "#8938D5"] as const;
const BTN_GREEN    = ["#059669", "#34d399"] as const;

export default function CreateRideScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();

  const [destination, setDestination]           = useState("");
  const [date, setDate]                         = useState(new Date());
  const [showPicker, setShowPicker]             = useState(false);
  const [seats, setSeats]                       = useState("1");
  const [suggestions, setSuggestions]           = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions]   = useState(false);
  const [liveRide, setLiveRide]                 = useState(true);
  const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lng: number }>();
  const [destFocused, setDestFocused]           = useState(false);
  const [submitting, setSubmitting]             = useState(false);
  const suppressSuggestionsRef                  = useRef(false);
  const debouncedDestination                    = useDebouncedValue(destination, 450);

  const onDestinationChange = (text: string) => {
    suppressSuggestionsRef.current = false;
    setDestination(text);
    setShowSuggestions(false);
  };

  const onSelectSuggestion = (value: string, lat: number, lng: number) => {
    suppressSuggestionsRef.current = true;
    const parts = value.split(",");
    setDestination((parts[0] + (parts[1] ? " " + parts[1] : "")).trim());
    setDestinationCoords({ lat, lng });
    setShowSuggestions(false);
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (suppressSuggestionsRef.current) { suppressSuggestionsRef.current = false; return; }
      if (debouncedDestination.length < 2) { setShowSuggestions(false); return; }
      const results = await geoSuggestion(debouncedDestination.trim());
      if (cancelled) return;
      setSuggestions(results ?? []);
      setShowSuggestions((results?.length ?? 0) > 0);
    };
    void run();
    return () => { cancelled = true; };
  }, [debouncedDestination]);

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
    if (submitting) return;
    setSubmitting(true);
    try {
      const loc     = await getUserLocation();
      const resjson = await createRide({
        destination,
        date: date.toISOString(),
        seatsAvailable: parseInt(seats),
        geopoint: { latitude: loc.latitude, longitude: loc.longitude },
        destinationCoords: { lat: destinationCoords?.lat, lng: destinationCoords?.lng },
        started: liveRide,
      });
      const rideId = resjson.name.split("/").pop();

      if (liveRide) {
        Alert.alert(t("createRide.successTitle"), t("createRide.rideCreated"));
        router.replace(
          `/riderScreen?rideId=${rideId}&maxSeat=${seats}&Originlat=${loc.latitude}&OriginLng=${loc.longitude}&Destination=${encodeURIComponent(destination)}&DestinationLat=${destinationCoords?.lat ?? 0}&DestinationLng=${destinationCoords?.lng ?? 0}`,
        );
      } else {
        Alert.alert(t("createRide.successTitle"), t("createRide.ridePlanned"));
        router.back();
      }
    } catch (err) {
      console.error(err);
      Alert.alert(t("createRide.failedTitle"), t("createRide.failedMsg"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={{ fontSize: 20 }}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t("createRide.headerTitle")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Destination ──────────────────────────────────────────────────── */}
        <Text style={styles.label}>{t("createRide.destination")}</Text>
        <View style={[styles.inputRow, destFocused && styles.inputRowFocused]}>
          <Text style={[{ fontSize: 16 }, styles.inputIcon]}>📍</Text>
          <TextInput
            style={styles.textInput}
            placeholder={t("createRide.destinationPlaceholder")}
            placeholderTextColor={C.muted}
            value={destination}
            onChangeText={onDestinationChange}
            onFocus={() => setDestFocused(true)}
            onBlur={() => setDestFocused(false)}
          />
          {destination.length > 0 && (
            <TouchableOpacity onPress={() => { setDestination(""); setShowSuggestions(false); }}>
              <Text style={{ fontSize: 14, color: C.muted }}>✕</Text>
            </TouchableOpacity>
          )}
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
                <Text style={{ fontSize: 12, marginRight: 8 }}>📍</Text>
                <Text style={styles.suggestionText} numberOfLines={1}>{item?.displayName}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Available Seats ───────────────────────────────────────────────── */}
        <Text style={[styles.label, { marginTop: 22 }]}>{t("createRide.availableSeats")}</Text>
        <View style={styles.seatsCard}>
          <View style={styles.seatsRow}>
            <TouchableOpacity
              style={styles.seatBtn}
              onPress={() => setSeats((s) => String(Math.max(1, parseInt(s) - 1)))}
            >
              <Text style={styles.seatBtnText}>−</Text>
            </TouchableOpacity>
            <View style={styles.seatDisplay}>
              <Text style={styles.seatNumber}>{seats}</Text>
              <Text style={styles.seatLabel}>{t("rides.seat", { count: parseInt(seats) })}</Text>
            </View>
            <TouchableOpacity
              style={styles.seatBtn}
              onPress={() => setSeats((s) => String(Math.min(7, parseInt(s) + 1)))}
            >
              <Text style={styles.seatBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          {/* Car visual */}
          <View style={styles.carWrap}>
            <View style={styles.carWindshield} />
            <View style={styles.carBody}>
              {/* Front row: driver + seat 1 */}
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
              {/* Back rows */}
              {([[2, 3], [4, 5], [6, 7]] as [number, number][]).map(([a, b]) => (
                <View key={a} style={styles.carRow}>
                  {[a, b].map((n) => (
                    <View key={n} style={[styles.carSeat, parseInt(seats) >= n && styles.carSeatFilled]}>
                      {parseInt(seats) >= n
                        ? <Text style={styles.carSeatIcon}>💺</Text>
                        : <View style={styles.carSeatEmpty} />}
                    </View>
                  ))}
                </View>
              ))}
            </View>
            <View style={styles.carBoot} />
          </View>
        </View>

        {/* ── Ride Type ─────────────────────────────────────────────────────── */}
        <Text style={[styles.label, { marginTop: 22 }]}>{t("createRide.rideType")}</Text>
        <View style={styles.rideTypeRow}>
          <TouchableOpacity
            onPress={() => setLiveRide(true)}
            activeOpacity={0.8}
            style={[styles.rideTypeOption, liveRide && styles.rideTypeActiveLive]}
          >
            <Text style={{ fontSize: 18 }}>📡</Text>
            <Text style={[styles.rideTypeLabel, liveRide && { color: C.success }]}>{t("createRide.live")}</Text>
            <Text style={styles.rideTypeSub}>{t("createRide.liveStart")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setLiveRide(false)}
            activeOpacity={0.8}
            style={[styles.rideTypeOption, !liveRide && styles.rideTypeActivePlanned]}
          >
            <Text style={{ fontSize: 18 }}>📅</Text>
            <Text style={[styles.rideTypeLabel, !liveRide && { color: C.purpleLight }]}>{t("createRide.planned")}</Text>
            <Text style={styles.rideTypeSub}>{t("createRide.plannedSchedule")}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Date & Time (planned only) ─────────────────────────────────────── */}
        {!liveRide && (
          <>
            <Text style={[styles.label, { marginTop: 22 }]}>{t("createRide.dateTime")}</Text>
            <TouchableOpacity
              onPress={() => setShowPicker(true)}
              style={[styles.inputRow, { marginBottom: 0 }]}
              activeOpacity={0.8}
            >
              <Text style={[{ fontSize: 16 }, styles.inputIcon]}>📅</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.dateLabel}>{t("createRide.departure")}</Text>
                <Text style={styles.dateValue}>
                  {date.toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA")}
                  {" — "}
                  {date.toLocaleTimeString(language === "fr" ? "fr-CA" : "en-CA", { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
              <Text style={{ fontSize: 14, color: C.muted }}>›</Text>
            </TouchableOpacity>

            {showPicker && (
              <DateTimePicker
                value={date}
                mode="datetime"
                display={Platform.OS === "ios" ? "inline" : "default"}
                onChange={(event, selectedDate) => {
                  if (event.type === "dismissed") { setShowPicker(false); return; }
                  if (selectedDate) {
                    const clean = new Date(selectedDate);
                    clean.setMinutes(0); clean.setSeconds(0);
                    setDate(clean);
                  }
                  if (Platform.OS === "android") setShowPicker(false);
                }}
              />
            )}
            {Platform.OS === "ios" && showPicker && (
              <TouchableOpacity
                onPress={() => setShowPicker(false)}
                style={styles.doneBtn}
              >
                <Text style={styles.doneBtnText}>{t("createRide.done")}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── Submit ───────────────────────────────────────────────────────── */}
        <Pressable onPress={handleSubmit} disabled={submitting} style={{ marginTop: 32 }}>
          <LinearGradient
            colors={liveRide ? BTN_GREEN : BTN_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.saveBtn, submitting && { opacity: 0.7 }]}
          >
            {submitting ? (
              <View style={styles.saveBtnContent}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={[styles.saveBtnText, { marginLeft: 8 }]}>Creating…</Text>
              </View>
            ) : (
              <Text style={styles.saveBtnText}>
                {liveRide ? t("createRide.startRideNow") : t("createRide.planRide")}
              </Text>
            )}
          </LinearGradient>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },

  // ── Header ───────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 56 : 20,
    paddingBottom: 14,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(224,154,247,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: "700",
  },

  // ── Scroll ───────────────────────────────────────────────────────────────────
  scroll: {
    padding: 20,
    paddingTop: 24,
  },

  // ── Label ────────────────────────────────────────────────────────────────────
  label: {
    color: C.muted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  // ── Input row ────────────────────────────────────────────────────────────────
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.inputBorder,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  inputRowFocused: {
    borderColor: C.inputFocus,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    color: C.text,
    fontSize: 15,
  },

  // ── Suggestions ──────────────────────────────────────────────────────────────
  suggestionsContainer: {
    marginTop: 6,
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderFaint,
    overflow: "hidden",
    marginBottom: 4,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.borderFaint,
  },
  suggestionText: {
    color: C.text,
    fontSize: 14,
    flex: 1,
  },

  // ── Seats card ───────────────────────────────────────────────────────────────
  seatsCard: {
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.inputBorder,
    borderRadius: 12,
    padding: 16,
  },
  seatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  seatBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(124,58,237,0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  seatBtnText: {
    color: C.purpleLight,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 26,
  },
  seatDisplay: {
    alignItems: "center",
  },
  seatNumber: {
    color: C.text,
    fontSize: 28,
    fontWeight: "800",
  },
  seatLabel: {
    color: C.muted,
    fontSize: 12,
    marginTop: -2,
  },

  // ── Car visual ───────────────────────────────────────────────────────────────
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

  // ── Ride type ────────────────────────────────────────────────────────────────
  rideTypeRow: {
    flexDirection: "row",
    gap: 12,
  },
  rideTypeOption: {
    flex: 1,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.inputBorder,
    borderRadius: 12,
    padding: 14,
    gap: 3,
  },
  rideTypeActiveLive: {
    borderColor: "rgba(52,211,153,0.5)",
    backgroundColor: "rgba(52,211,153,0.07)",
  },
  rideTypeActivePlanned: {
    borderColor: C.border,
    backgroundColor: "rgba(137,56,213,0.07)",
  },
  rideTypeLabel: {
    color: C.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  rideTypeSub: {
    color: C.dim,
    fontSize: 11,
  },

  // ── Date picker ──────────────────────────────────────────────────────────────
  dateLabel: {
    color: C.muted,
    fontSize: 11,
    marginBottom: 2,
  },
  dateValue: {
    color: C.text,
    fontSize: 14,
    fontWeight: "600",
  },
  doneBtn: {
    marginTop: 10,
    alignSelf: "flex-end",
    backgroundColor: C.purple,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  doneBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },

  // ── Save button ──────────────────────────────────────────────────────────────
  saveBtn: {
    height: 52,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  saveBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
});
