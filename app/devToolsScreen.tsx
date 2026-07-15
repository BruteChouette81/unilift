/**
 * Dev Ride Panel — a single-device ride testing harness.
 *
 * Reached by long-pressing the header DEV badge (see app/_layout.tsx). Compiled
 * in but completely inert in preview/production: the whole screen renders null
 * unless `isDev`, and every backend call goes through the dev-only `/dev/*`
 * sandbox endpoints (uniliftdev + Stripe test).
 *
 * It lets you drive a full ride solo — seed a request, auto-accept as a bot
 * driver, start / board / dropoff / finish — force any outcome, mock GPS, and
 * read the live ride log on-device, with no second phone or camera scan.
 */
import { isDev } from "@/constants/runtime-config";
import { useActiveRide } from "@/context/ActiveRideContext";
import {
  devAcceptAsBot,
  devAutoBoard,
  devDropoff,
  devFinishRide,
  devForceStatus,
  devReset,
  devSeedRequest,
  devStartRide,
} from "@/services/devRideService";
import {
  clearRideLog,
  formatRideLog,
  RideLogEntry,
  subscribeRideLog,
} from "@/utils/ride-logger";
import {
  DevCoords,
  LOCATION_PRESETS,
  setDevLocationOverride,
} from "@/utils/dev-location";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  bg: "#080810",
  surface: "#0f0f1e",
  card: "#161628",
  border: "#26263c",
  text: "#f3f4f6",
  muted: "#9ca3af",
  accent: "#7C3AED",
  accentLight: "#a78bfa",
  green: "#34d399",
  amber: "#f59e0b",
  red: "#ef4444",
  blue: "#3b82f6",
};

// Default coords match /dev/seed-request so the on-screen map has real points.
const DEFAULT_ORIGIN = LOCATION_PRESETS.campus;
const DEFAULT_DEST = LOCATION_PRESETS.downtown;

export default function DevToolsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeRide } = useActiveRide();

  const [requestId, setRequestId] = useState<string | null>(null);
  const [rideId, setRideId] = useState<string | null>(activeRide?.rideId ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [gpsPreset, setGpsPreset] = useState<string | null>(null);
  const [logs, setLogs] = useState<RideLogEntry[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  useEffect(() => subscribeRideLog(setLogs), []);

  const run = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(key);
      try {
        await fn();
      } catch (e: any) {
        Alert.alert("Dev action failed", e?.message ?? String(e));
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  const currentRideId = rideId ?? activeRide?.rideId ?? null;

  const openPassengerRide = () => {
    if (!currentRideId) {
      Alert.alert("No ride", "Seed + accept a ride first.");
      return;
    }
    router.push(
      `/rideScreen?rideId=${currentRideId}&Originlat=${DEFAULT_ORIGIN.latitude}&OriginLng=${DEFAULT_ORIGIN.longitude}&DestinationLat=${DEFAULT_DEST.latitude}&DestinationLng=${DEFAULT_DEST.longitude}&pending=false`,
    );
  };

  const seedAndAccept = () =>
    run("seedAccept", async () => {
      const { requestId: rid } = await devSeedRequest();
      setRequestId(rid);
      const { rideId: newRideId } = await devAcceptAsBot(rid);
      setRideId(newRideId);
    });

  const applyGps = (key: string, coords: DevCoords | null) => {
    setDevLocationOverride(coords);
    setGpsPreset(coords ? key : null);
  };

  const shareLogs = async () => {
    try {
      await Share.share({ message: formatRideLog(logs) || "(no logs)" });
    } catch {
      /* user dismissed */
    }
  };

  if (!isDev) return null;

  const filtered = tagFilter ? logs.filter((l) => l.tag === tagFilter) : logs;
  const tags = ["passenger", "driver", "dispatch", "payment", "qr", "dev"];
  const levelColor = (lvl: string) =>
    lvl === "error" ? C.red : lvl === "warn" ? C.amber : C.accentLight;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <LinearGradient colors={["#2d0015", "#1c0038"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Dev Ride Panel</Text>
        <View style={styles.devTag}><Text style={styles.devTagText}>DEV</Text></View>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        {/* IDs */}
        <View style={styles.idRow}>
          <IdChip label="request" value={requestId} />
          <IdChip label="ride" value={currentRideId} />
        </View>

        <Section title="1 · Create & match">
          <Btn label="Seed request + accept as bot" icon="rocket" color={C.accent} loading={busy === "seedAccept"} onPress={seedAndAccept} />
          <Btn label="Open passenger ride screen" icon="eye" color={C.blue} onPress={openPassengerRide} />
        </Section>

        <Section title="2 · Drive the ride">
          <Btn label="Start ride" icon="play" loading={busy === "start"}
            onPress={() => currentRideId && run("start", () => devStartRide(currentRideId).then(() => {}))} />
          <Btn label="Auto-board (skip QR scan)" icon="qr-code" loading={busy === "board"}
            onPress={() => currentRideId && run("board", () => devAutoBoard(currentRideId).then(() => {}))} />
          <Btn label="Dropoff — confirmed (charged + rated)" icon="checkmark-circle" color={C.green} loading={busy === "dropC"}
            onPress={() => currentRideId && run("dropC", () => devDropoff(currentRideId, { confirmed: true }).then(() => {}))} />
          <Btn label="Dropoff — out of range (no charge)" icon="alert-circle" color={C.amber} loading={busy === "dropU"}
            onPress={() => currentRideId && run("dropU", () => devDropoff(currentRideId, { confirmed: false }).then(() => {}))} />
          <Btn label="Finish + charge" icon="flag" color={C.green} loading={busy === "finish"}
            onPress={() => currentRideId && run("finish", () => devFinishRide(currentRideId).then(() => {}))} />
        </Section>

        <Section title="Force outcomes">
          <Btn label="No driver found (expire request)" icon="time" color={C.amber} loading={busy === "expReq"}
            onPress={() => requestId && run("expReq", () => devForceStatus({ requestId, requestStatus: "expired" }).then(() => {}))} />
          <Btn label="Stuck payment (processing)" icon="hourglass" color={C.amber} loading={busy === "proc"}
            onPress={() => currentRideId && run("proc", () => devForceStatus({ rideId: currentRideId, paymentStatus: "processing" }).then(() => {}))} />
          <Btn label="Cancel ride" icon="close-circle" color={C.red} loading={busy === "cancel"}
            onPress={() => currentRideId && run("cancel", () => devForceStatus({ rideId: currentRideId, status: "cancelled" }).then(() => {}))} />
          <Btn label="Expire ride" icon="trash" color={C.red} loading={busy === "expRide"}
            onPress={() => currentRideId && run("expRide", () => devForceStatus({ rideId: currentRideId, status: "expired" }).then(() => {}))} />
        </Section>

        <Section title="GPS override">
          <View style={styles.gpsRow}>
            {Object.keys(LOCATION_PRESETS).map((k) => (
              <Pressable key={k} onPress={() => applyGps(k, LOCATION_PRESETS[k])}
                style={[styles.gpsChip, gpsPreset === k && styles.gpsChipActive]}>
                <Text style={[styles.gpsChipText, gpsPreset === k && styles.gpsChipTextActive]}>{k}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => applyGps("off", null)}
              style={[styles.gpsChip, gpsPreset === null && styles.gpsChipActive]}>
              <Text style={[styles.gpsChipText, gpsPreset === null && styles.gpsChipTextActive]}>real</Text>
            </Pressable>
          </View>
        </Section>

        <Section title="Reset">
          <Btn label="Reset my test rides & requests" icon="refresh" color={C.red} loading={busy === "reset"}
            onPress={() => run("reset", async () => {
              const r = await devReset();
              setRequestId(null);
              setRideId(null);
              Alert.alert("Reset", `Expired ${r.requests} request(s), ${r.rides} ride(s).`);
            })} />
        </Section>

        {/* Logs */}
        <View style={styles.logHeader}>
          <Text style={styles.sectionTitle}>Ride log</Text>
          <View style={styles.logActions}>
            <Pressable onPress={shareLogs} hitSlop={8} style={styles.logBtn}>
              <Ionicons name="share-outline" size={16} color={C.accentLight} />
            </Pressable>
            <Pressable onPress={clearRideLog} hitSlop={8} style={styles.logBtn}>
              <Ionicons name="trash-outline" size={16} color={C.muted} />
            </Pressable>
          </View>
        </View>
        <View style={styles.tagRow}>
          <TagChip label="all" active={tagFilter === null} onPress={() => setTagFilter(null)} />
          {tags.map((tg) => (
            <TagChip key={tg} label={tg} active={tagFilter === tg} onPress={() => setTagFilter(tg)} />
          ))}
        </View>
        <View style={styles.logBox}>
          {filtered.length === 0 ? (
            <Text style={styles.logEmpty}>No logs yet — run an action above.</Text>
          ) : (
            filtered.slice(-120).reverse().map((l) => (
              <Text key={l.id} style={styles.logLine}>
                <Text style={{ color: C.muted }}>{new Date(l.ts).toISOString().slice(11, 19)} </Text>
                <Text style={{ color: levelColor(l.level) }}>[{l.tag}] </Text>
                <Text style={{ color: C.text }}>{l.msg}</Text>
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Btn({
  label, icon, color = C.card, loading, onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color?: string;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={loading} style={({ pressed }) => [styles.btn, { opacity: pressed || loading ? 0.6 : 1 }]}>
      <View style={[styles.btnIcon, { backgroundColor: color + "33" }]}>
        {loading ? <ActivityIndicator size="small" color={color} /> : <Ionicons name={icon} size={16} color={color} />}
      </View>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

function IdChip({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.idChip}>
      <Text style={styles.idChipLabel}>{label}</Text>
      <Text style={styles.idChipValue} numberOfLines={1}>{value ? value.slice(0, 10) + "…" : "—"}</Text>
    </View>
  );
}

function TagChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tagChip, active && styles.tagChipActive]}>
      <Text style={[styles.tagChipText, active && styles.tagChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  backBtn: { padding: 2 },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: "800", flex: 1 },
  devTag: { backgroundColor: "#f97316", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  devTagText: { color: "#fff", fontSize: 11, fontWeight: "800" },

  idRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  idChip: { flex: 1, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10 },
  idChipLabel: { color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  idChipValue: { color: C.accentLight, fontSize: 13, fontWeight: "700" },

  section: { marginBottom: 18 },
  sectionTitle: { color: C.text, fontSize: 13, fontWeight: "700", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },

  btn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8 },
  btnIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnText: { color: C.text, fontSize: 14, fontWeight: "600", flex: 1 },

  gpsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gpsChip: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 8 },
  gpsChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  gpsChipText: { color: C.muted, fontSize: 13, fontWeight: "600" },
  gpsChipTextActive: { color: "#fff" },

  logHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  logActions: { flexDirection: "row", gap: 12 },
  logBtn: { padding: 4 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  tagChip: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 5 },
  tagChipActive: { backgroundColor: C.accent + "33", borderColor: C.accent },
  tagChipText: { color: C.muted, fontSize: 11, fontWeight: "600" },
  tagChipTextActive: { color: C.accentLight },

  logBox: { backgroundColor: "#05050c", borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10, minHeight: 120 },
  logEmpty: { color: C.muted, fontSize: 12, fontStyle: "italic" },
  logLine: { fontSize: 11, fontFamily: "monospace", marginBottom: 3, lineHeight: 15 },
});
