import DateTimePicker from "@react-native-community/datetimepicker";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as Location from "expo-location";
import { GeoPoint } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { createRide, geoSuggestion } from "../services/rideServices";

// ─── Design Tokens ──────────────────────────────────────────────────────────
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

const HEADER_GRADIENT = ["#3b0764", "#1e3a8a"] as const;
const CARD_GRADIENT   = ["#1e1b4b", "#0d1224"] as const;
const BTN_GRADIENT    = ["#7C3AED", "#2563eb"] as const;

// ─── Section Header ──────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={sh.row}>
      <View style={sh.iconDot}>
        <Ionicons name={icon as any} size={14} color={C.purpleLight} />
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
  const [destination, setDestination]         = useState("");
  const [date, setDate]                       = useState(new Date());
  const [showPicker, setShowPicker]           = useState(false);
  const [seats, setSeats]                     = useState("1");
  const [suggestions, setSuggestions]         = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [liveRide, setLiveRide]               = useState(true);
  const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lng: number }>();
  const debouncedDestination = useDebouncedValue(destination, 450);

  const onDestinationChange = (text: string) => {
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
      Alert.alert("Error", "Please fill out all fields.");
      return;
    }
    try {
      const loc = await getUserLocation();
      const resjson = await createRide({
        destination,
        date: date.toISOString(),
        seatsAvailable: parseInt(seats),
        geopoint: new GeoPoint(loc.latitude, loc.longitude),
        destinationCoords: { lat: destinationCoords?.lat, lng: destinationCoords?.lng },
        started: liveRide,
      });
      console.log(resjson);
      const rideId = resjson.name.split("/").pop();

      if (liveRide) {
        Alert.alert("Success", "Your ride has been created!");
        router.replace(`/riderScreen?rideId=${rideId}&maxSeat=${seats}&Originlat=${loc.latitude}&OriginLng=${loc.longitude}&Destination=${destination}`);
      } else {
        Alert.alert("Success", "Your ride has been planned!");
        props.cancelCreate();
      }
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to create ride.");
    }
  }

  const onSelectSuggestion = (value: string, lat: number, lng: number) => {
    const destString = value.split(",")[0] + " " + value.split(",")[1];
    setDestination(destString);
    setDestinationCoords({ lat, lng });
    setShowSuggestions(false);
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
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
            <Ionicons name="car-sport-outline" size={22} color={C.purpleLight} />
          </LinearGradient>
          <View>
            <Text style={styles.headerTitle}>New Ride</Text>
            <Text style={styles.headerSub}>Set your destination and preferences</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.body}>
        {/* ── Destination ───────────────────────────────────────────────────── */}
        <SectionHeader icon="location-outline" title="Destination" />
        <View style={styles.card}>
          {/* Origin row */}
          <View style={styles.inputRow}>
            <View style={styles.dotGreen} />
            <Text style={styles.originLabel}>Your current location</Text>
          </View>
          <View style={styles.routeLine} />

          {/* Destination input */}
          <View style={styles.inputRow}>
            <View style={styles.dotPurple} />
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="Where are you going?"
                placeholderTextColor={C.dim}
                value={destination}
                onChangeText={onDestinationChange}
              />
              {destination.length > 0 && (
                <TouchableOpacity onPress={() => { setDestination(""); setShowSuggestions(false); }}>
                  <Ionicons name="close-circle" size={16} color={C.dim} />
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
                  <Ionicons name="location-outline" size={14} color={C.purpleLight} style={{ marginRight: 8 }} />
                  <Text style={styles.suggestionText} numberOfLines={1}>{item?.displayName}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* ── Ride Type ─────────────────────────────────────────────────────── */}
        <SectionHeader icon="flash-outline" title="Ride Type" />
        <View style={styles.card}>
          <View style={styles.rideTypeRow}>
            <LinearGradient
              colors={liveRide ? CARD_GRADIENT : ["transparent", "transparent"]}
              style={[styles.rideTypeOption, liveRide && styles.rideTypeActive]}
            >
              <Ionicons name="radio-outline" size={18} color={liveRide ? C.purpleLight : C.dim} />
              <Text style={[styles.rideTypeLabel, liveRide && { color: C.purpleLight }]}>Live</Text>
              <Text style={[styles.rideTypeSub, liveRide && { color: C.muted }]}>Start now</Text>
            </LinearGradient>

            <Switch
              value={liveRide}
              onValueChange={setLiveRide}
              trackColor={{ false: C.surfaceAlt, true: "rgba(124,58,237,0.4)" }}
              thumbColor={liveRide ? C.purple : C.dim}
              style={{ marginHorizontal: 12 }}
            />

            <LinearGradient
              colors={!liveRide ? CARD_GRADIENT : ["transparent", "transparent"]}
              style={[styles.rideTypeOption, !liveRide && styles.rideTypeActive, { alignItems: "flex-end" }]}
            >
              <Ionicons name="calendar-outline" size={18} color={!liveRide ? C.blueLight : C.dim} />
              <Text style={[styles.rideTypeLabel, !liveRide && { color: C.blueLight }]}>Planned</Text>
              <Text style={[styles.rideTypeSub, !liveRide && { color: C.muted }]}>Schedule it</Text>
            </LinearGradient>
          </View>
        </View>

        {/* ── Date & Time (planned only) ────────────────────────────────────── */}
        {!liveRide && (
          <>
            <SectionHeader icon="time-outline" title="Date & Time" />
            <View style={styles.card}>
              <TouchableOpacity onPress={() => setShowPicker(true)} style={styles.dateButton}>
                <View style={styles.dateIconWrap}>
                  <Ionicons name="calendar" size={16} color={C.purpleLight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dateLabel}>Departure</Text>
                  <Text style={styles.dateValue}>
                    {date.toLocaleDateString()} — {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.dim} />
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
                  <Text style={styles.doneText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        {/* ── Seats ────────────────────────────────────────────────────────── */}
        <SectionHeader icon="people-outline" title="Available Seats" />
        <View style={styles.card}>
          <View style={styles.seatsRow}>
            <TouchableOpacity
              style={styles.seatBtn}
              onPress={() => setSeats(s => String(Math.max(1, parseInt(s) - 1)))}
            >
              <Ionicons name="remove" size={18} color={C.purpleLight} />
            </TouchableOpacity>

            <View style={styles.seatDisplay}>
              <Text style={styles.seatNumber}>{seats}</Text>
              <Text style={styles.seatLabel}>{parseInt(seats) === 1 ? "seat" : "seats"}</Text>
            </View>

            <TouchableOpacity
              style={styles.seatBtn}
              onPress={() => setSeats(s => String(Math.min(8, parseInt(s) + 1)))}
            >
              <Ionicons name="add" size={18} color={C.purpleLight} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Actions ───────────────────────────────────────────────────────── */}
        <TouchableOpacity onPress={handleSubmit} style={styles.submitBtn} activeOpacity={0.85}>
          <LinearGradient colors={BTN_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitGrad}>
            <Ionicons name={liveRide ? "radio-outline" : "calendar-outline"} size={18} color="#fff" />
            <Text style={styles.submitText}>{liveRide ? "Start Ride Now" : "Plan Ride"}</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity onPress={props.cancelCreate} style={styles.cancelBtn} activeOpacity={0.8}>
          <Text style={styles.cancelText}>Cancel</Text>
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
});
