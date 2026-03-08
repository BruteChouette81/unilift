import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { memo, useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { extractDriverSummary, fetchUserDocument } from "@/services/userService";

// ─── Design Tokens ───────────────────────────────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  border:      "rgba(124, 58, 237, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#7C3AED",
  purpleLight: "#a78bfa",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
  gold:        "#fbbf24",
  success:     "#34d399",
};

const CARD_GRADIENT = ["#1e1b4b", "#0d1224"] as const;
const BTN_GRADIENT  = ["#7C3AED", "#2563eb"] as const;

// ─── Types ───────────────────────────────────────────────────────────────────
interface Driver {
  name?: string;
  avatar?: string | null;
  level?: number;
}

interface RideCardProps {
  driverId: string;
  rating: number;
  destination: string;
  seatsAvailable: number;
  time: string;
  origin: string;
  level: number;
  onPress: () => void;
}

interface RideCardSelectedProps extends RideCardProps {
  onCancel: () => void;
}

// ─── Shared ──────────────────────────────────────────────────────────────────
const DEFAULT_AVATAR = "https://www.macfcu.org/wp-content/uploads/2024/02/Windows_10_Default_Profile_Picture.svg.png";
const driverSummaryCache = new Map<string, Driver>();

function useDriver(driverId: string) {
  const [driver, setDriver] = useState<Driver | null>(null);
  useEffect(() => {
    const load = async () => {
      if (driverSummaryCache.has(driverId)) {
        setDriver(driverSummaryCache.get(driverId) ?? null);
        return;
      }
      const data = await fetchUserDocument(driverId);
      const summary = extractDriverSummary(data);
      driverSummaryCache.set(driverId, summary);
      setDriver(summary);
    };
    void load();
  }, [driverId]);
  return driver;
}

// ─── Shared card body ────────────────────────────────────────────────────────
function CardBody({ driver, rating, destination, seatsAvailable, time, origin }: {
  driver: Driver | null;
  rating: number;
  destination: string;
  seatsAvailable: number;
  time: string;
  origin: string;
}) {
  return (
    <>
      {/* Driver row */}
      <View style={s.row}>
        <View style={s.avatarWrap}>
          <Image source={{ uri: driver?.avatar || DEFAULT_AVATAR }} style={s.avatar} />
          <View style={s.onlineDot} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={s.driverName}>{driver?.name || "Unknown Driver"}</Text>
          <View style={s.ratingRow}>
            <Ionicons name="star" size={12} color={C.gold} />
            <Text style={s.ratingText}>{rating?.toFixed(1)}</Text>
            {driver?.level !== undefined && (
              <View style={s.levelPill}>
                <Ionicons name="flash" size={10} color={C.purpleLight} />
                <Text style={s.levelText}>Lvl {driver.level}</Text>
              </View>
            )}
          </View>
        </View>

        {time ? <Text style={s.time}>{time}</Text> : null}
      </View>

      {/* Destination */}
      <View style={s.destinationRow}>
        <View style={s.destDot} />
        <Text style={s.destination} numberOfLines={1}>
          {destination}
        </Text>
      </View>

      {/* Details chips */}
      <View style={s.chipsRow}>
        <View style={s.chip}>
          <Ionicons name="people-outline" size={12} color={C.purpleLight} />
          <Text style={s.chipText}>{seatsAvailable} seats</Text>
        </View>
        <View style={s.chip}>
          <Ionicons name="location-outline" size={12} color={C.purpleLight} />
          <Text style={s.chipText} numberOfLines={1}>{origin}</Text>
        </View>
      </View>
    </>
  );
}

// ─── RideCard (list item) ────────────────────────────────────────────────────
function RideCardComponent(props: RideCardProps) {
  const driver = useDriver(props.driverId);

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={props.onPress}>
      <LinearGradient colors={CARD_GRADIENT} style={s.card}>
        <CardBody
          driver={driver}
          rating={props.rating}
          destination={props.destination}
          seatsAvailable={props.seatsAvailable}
          time={props.time}
          origin={props.origin}
        />
      </LinearGradient>
    </TouchableOpacity>
  );
}

export default memo(RideCardComponent);

// ─── RideCardSelected (expanded with actions) ────────────────────────────────
export function RideCardSlected(props: RideCardSelectedProps) {
  const driver = useDriver(props.driverId);

  return (
    <LinearGradient colors={CARD_GRADIENT} style={s.card}>
      <CardBody
        driver={driver}
        rating={props.rating}
        destination={props.destination}
        seatsAvailable={props.seatsAvailable}
        time={props.time}
        origin={props.origin}
      />

      <View style={s.divider} />

      <View style={s.buttonRow}>
        <Pressable style={s.goBtn} onPress={props.onPress}>
          <LinearGradient colors={BTN_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.goBtnGrad}>
            <Ionicons name="car-sport-outline" size={16} color="#fff" />
            <Text style={s.goBtnText}>Join Ride</Text>
          </LinearGradient>
        </Pressable>

        <Pressable style={s.cancelBtn} onPress={props.onCancel}>
          <Text style={s.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </LinearGradient>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },

  // Driver row
  row:        { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 12 },
  avatarWrap: { position: "relative" },
  avatar:     { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: C.border, backgroundColor: C.surface },
  onlineDot:  { position: "absolute", bottom: 1, right: 1, width: 10, height: 10, borderRadius: 5, backgroundColor: C.success, borderWidth: 2, borderColor: C.bg },
  driverName: { color: C.text, fontSize: 15, fontWeight: "700" },
  ratingRow:  { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  ratingText: { color: C.gold, fontSize: 12, fontWeight: "600" },
  levelPill:  { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(167,139,250,0.1)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: C.border },
  levelText:  { color: C.purpleLight, fontSize: 10, fontWeight: "700" },
  time:       { color: C.muted, fontSize: 12, fontWeight: "500" },

  // Destination
  destinationRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  destDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: C.purple },
  destination:    { color: C.text, fontSize: 15, fontWeight: "700", flex: 1 },

  // Chips
  chipsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(124,58,237,0.08)", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: C.border },
  chipText: { color: C.muted, fontSize: 12 },

  // Selected card actions
  divider:   { height: 1, backgroundColor: C.borderFaint, marginVertical: 14 },
  buttonRow: { flexDirection: "row", gap: 10 },
  goBtn:     { flex: 1, borderRadius: 10, overflow: "hidden" },
  goBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12 },
  goBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  cancelBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: "rgba(248,113,113,0.25)", backgroundColor: "rgba(248,113,113,0.06)" },
  cancelText:{ color: C.danger, fontSize: 14, fontWeight: "600" },
});
