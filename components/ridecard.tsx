import { useLanguage } from "@/context/LanguageContext";
import { extractDriverSummary, fetchUserDocument } from "@/services/userService";
import { LinearGradient } from "expo-linear-gradient";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import React, { memo, useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";

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
  driverName?: string;
  driverAvatar?: string;
  rating: number;
  destination: string;
  seatsAvailable: number;
  time: string;
  origin: string;
  level: number;
  scheduledDate?: string;   // ISO string — if future date, shows scheduled badge
  onPress: () => void;
}

interface RideCardSelectedProps extends RideCardProps {
  onCancel: () => void;
  isScheduled?: boolean;    // changes the join button label & color
}

// ─── Shared ──────────────────────────────────────────────────────────────────
const DEFAULT_AVATAR = "https://www.macfcu.org/wp-content/uploads/2024/02/Windows_10_Default_Profile_Picture.svg.png";
const DRIVER_CACHE_TTL_MS = 60_000;
const driverSummaryCache = new Map<string, { driver: Driver; fetchedAt: number }>();

function useDriver(driverId: string, embeddedName?: string, embeddedAvatar?: string) {
  const hasEmbedded = Boolean(embeddedName);
  const [driver, setDriver] = useState<Driver | null>(
    hasEmbedded ? { name: embeddedName, avatar: embeddedAvatar || null } : null,
  );
  useEffect(() => {
    // Skip fetch if we already have embedded data from the ride document
    if (hasEmbedded) {
      setDriver({ name: embeddedName, avatar: embeddedAvatar || null });
      return;
    }
    let cancelled = false;
    const load = async (retries = 2) => {
      const cached = driverSummaryCache.get(driverId);
      if (cached && Date.now() - cached.fetchedAt < DRIVER_CACHE_TTL_MS) {
        setDriver(cached.driver);
        return;
      }
      try {
        const currentUser = getAuth().currentUser;
        if (!currentUser) {
          if (retries > 0) {
            const unsub = onAuthStateChanged(getAuth(), (user) => {
              unsub();
              if (!cancelled && user) void load(retries - 1);
            });
          }
          return;
        }
        const token = await currentUser.getIdToken();
        const data = await fetchUserDocument(driverId, token);
        const summary = extractDriverSummary(data);
        driverSummaryCache.set(driverId, { driver: summary, fetchedAt: Date.now() });
        if (!cancelled) setDriver(summary);
      } catch {
        // silently fail — card renders with "Unknown Driver"
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [driverId, embeddedName, embeddedAvatar]);
  return driver;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().split("T")[0];

function isScheduledRide(scheduledDate?: string): boolean {
  if (!scheduledDate) return false;
  return scheduledDate.split("T")[0] > todayStr();
}

function formatScheduledDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Shared card body ────────────────────────────────────────────────────────
function CardBody({ driver, rating, destination, seatsAvailable, origin, scheduledDate }: {
  driver: Driver | null;
  rating: number;
  destination: string;
  seatsAvailable: number;
  time: string;
  origin: string;
  scheduledDate?: string;
}) {
  const { t } = useLanguage();
  const isScheduled = isScheduledRide(scheduledDate);
  return (
    <>
      {/* Driver row */}
      <View style={s.row}>
        <View style={s.avatarWrap}>
          <Image source={{ uri: driver?.avatar || DEFAULT_AVATAR }} style={s.avatar} />
          <View style={s.onlineDot} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={s.driverName}>{driver?.name || t("rides.unknownDriver")}</Text>
          <View style={s.ratingRow}>
            <Text style={{fontSize: 10}}>⭐</Text>
            <Text style={s.ratingText}>{rating?.toFixed(1)}</Text>
            {driver?.level !== undefined && (
              <View style={s.levelPill}>
                <Text style={{fontSize: 8}}>⚡</Text>
                <Text style={s.levelText}>Lvl {driver.level}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Live / Scheduled badge */}
        {isScheduled ? (
          <View style={s.scheduledBadge}>
            <Text style={{fontSize: 9}}>📅</Text>
            <Text style={s.scheduledBadgeText}>{scheduledDate ? formatScheduledDate(scheduledDate) : ""}</Text>
          </View>
        ) : (
          <View style={s.liveBadge}>
            <View style={s.liveDot} />
            <Text style={s.liveBadgeText}>Live</Text>
          </View>
        )}
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
          <Text style={{fontSize: 10}}>👥</Text>
          <Text style={s.chipText}>{seatsAvailable} {t("rides.seat", { count: seatsAvailable })} </Text>
        </View>
        <View style={s.chip}>
          <Text style={{fontSize: 10}}>📍</Text>
          <Text style={s.chipText} numberOfLines={1}>{origin}</Text>
        </View>
      </View>
    </>
  );
}

// ─── RideCard (list item) ────────────────────────────────────────────────────
function RideCardComponent(props: RideCardProps) {
  const driver = useDriver(props.driverId, props.driverName, props.driverAvatar);

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
          scheduledDate={props.scheduledDate}
        />
      </LinearGradient>
    </TouchableOpacity>
  );
}

export default memo(RideCardComponent);

// ─── RideCardSelected (expanded with actions) ────────────────────────────────
export function RideCardSlected(props: RideCardSelectedProps) {
  const driver = useDriver(props.driverId, props.driverName, props.driverAvatar);
  const { t } = useLanguage();
  const scheduled = props.isScheduled ?? isScheduledRide(props.scheduledDate);
  const ENROLL_GRADIENT = ["#fbbf24", "#f97316"] as const;

  return (
    <LinearGradient colors={CARD_GRADIENT} style={s.card}>
      <CardBody
        driver={driver}
        rating={props.rating}
        destination={props.destination}
        seatsAvailable={props.seatsAvailable}
        time={props.time}
        origin={props.origin}
        scheduledDate={props.scheduledDate}
      />

      <View style={s.divider} />

      <View style={s.buttonRow}>
        <Pressable style={s.goBtn} onPress={props.onPress}>
          <LinearGradient
            colors={scheduled ? ENROLL_GRADIENT : BTN_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.goBtnGrad}
          >
            <Text style={{fontSize: 14}}>{scheduled ? "📅" : "🚗"}</Text>
            <Text style={s.goBtnText}>{scheduled ? t("rides.enrollRide") : t("rides.joinRide")}</Text>
          </LinearGradient>
        </Pressable>

        <Pressable style={s.cancelBtn} onPress={props.onCancel}>
          <Text style={s.cancelText}>{t("rides.cancel")}</Text>
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

  // Live / Scheduled badges
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(52,211,153,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(52,211,153,0.3)" },
  liveDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  liveBadgeText: { color: C.success, fontSize: 11, fontWeight: "700" },
  scheduledBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(251,191,36,0.08)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(251,191,36,0.25)" },
  scheduledBadgeText: { color: "#fbbf24", fontSize: 10, fontWeight: "600" },
});
