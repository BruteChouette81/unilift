import React, { useCallback, useMemo } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Ride, StartRidePayload } from "@/types/models";
import { useLanguage } from "@/context/LanguageContext";
import type { Language } from "@/constants/translations";

const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  card:        "#1e1b4b",
  border:      "rgba(124, 58, 237, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#7C3AED",
  purpleLight: "#a78bfa",
  purpleFaint: "rgba(124,58,237,0.12)",
  green:       "#10b981",
  greenFaint:  "rgba(16,185,129,0.12)",
  red:         "#ef4444",
  redFaint:    "rgba(239,68,68,0.12)",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
};

type PlannedRidesListProps = {
  rides: Ride[];
  driverId?: string;
  onStartRide: (rideId: string, payload: StartRidePayload) => void;
  onCancelRide: (rideId: string) => void;
};

function formatDate(iso: string, language: Language): { weekday: string; date: string; time: string } {
  const locale = language === "fr" ? "fr-CA" : "en-CA";
  const d = new Date(iso);
  const weekday = d.toLocaleDateString(locale, { weekday: "short" });
  const date = d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return { weekday, date, time };
}

export function PlannedRidesList({
  rides,
  driverId,
  onStartRide,
  onCancelRide,
}: PlannedRidesListProps) {
  const { t, language } = useLanguage();
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);
  const plannedRides = useMemo(
    () => rides.filter((ride) => ride.status === "planned" && ride.driverId === driverId),
    [driverId, rides],
  );
  const keyExtractor = useCallback((item: Ride) => item.id, []);

  const renderItem = useCallback(({ item, index }: { item: Ride; index: number }) => {
    const rideDate = item.date?.split("T")[0];
    const canStart = rideDate === today;
    const isFirst = index === 0;
    const formatted = item.date ? formatDate(item.date, language) : null;
    const passengerCount = item.passengers?.length ?? 0;
    const totalSeats = passengerCount + item.seatsAvailable;

    return (
      <View style={styles.row}>
        {/* Timeline column */}
        <View style={styles.timeline}>
          <View style={[styles.dot, canStart && styles.dotActive]} />
          <View style={styles.line} />
        </View>

        {/* Card */}
        <View style={[styles.card, isFirst && styles.cardFirst]}>
          {/* Date badge */}
          <View style={styles.cardHeader}>
            <View style={styles.dateBadge}>
              {formatted ? (
                <>
                  <Text style={styles.dateBadgeWeekday}>{formatted.weekday}</Text>
                  <Text style={styles.dateBadgeDate}>{formatted.date}</Text>
                </>
              ) : (
                <Text style={styles.dateBadgeDate}>—</Text>
              )}
            </View>

            {canStart ? (
              <View style={styles.todayBadge}>
                <Text style={{fontSize: 6}}>📍</Text>
                <Text style={styles.todayBadgeText}>{t("rides.today")}</Text>
              </View>
            ) : (
              <View style={styles.upcomingBadge}>
                <Text style={styles.upcomingBadgeText}>{t("rides.upcoming")}</Text>
              </View>
            )}
          </View>

          {/* Destination */}
          <View style={styles.destinationRow}>
            <View style={styles.destIconWrap}>
              <Text style={{fontSize: 12}}>📍</Text>
            </View>
            <Text style={styles.destination} numberOfLines={1}>
              {item.destination}
            </Text>
          </View>

          {/* Meta row */}
          <View style={styles.metaRow}>
            {formatted && (
              <View style={styles.metaChip}>
                <Text style={{fontSize: 10}}>⏱</Text>
                <Text style={styles.metaText}>{formatted.time}</Text>
              </View>
            )}
            <View style={styles.metaChip}>
              <Text style={{fontSize: 10}}>👥</Text>
              <Text style={styles.metaText}>
                {t("rides.passengersCount", { current: passengerCount, total: totalSeats })}
              </Text>
            </View>
            <View style={styles.metaChip}>
              <Text style={{fontSize: 10}}>🚗</Text>
              <Text style={styles.metaText}>{t("rides.seatsLeft", { count: item.seatsAvailable })}</Text>
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, canStart ? styles.startBtn : styles.disabledBtn]}
              disabled={!canStart}
              onPress={() =>
                onStartRide(item.id, {
                  originLat: item.localisation.latitude,
                  originLng: item.localisation.longitude,
                  destination: item.destination,
                  destinationLat: item.destinationCoords.latitude,
                  destinationLng: item.destinationCoords.longitude,
                })
              }
            >
              <Text style={{fontSize: 11}}>▶</Text>
              <Text style={[styles.actionBtnText, !canStart && styles.actionBtnTextDisabled]}>
                {t("rides.startRide")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.cancelBtn]}
              onPress={() =>
                Alert.alert(
                  t("rides.confirmCancel"),
                  t("rides.confirmCancelMsg"),
                  [
                    { text: t("common.no") },
                    { text: t("common.yes"), style: "destructive", onPress: () => onCancelRide(item.id) },
                  ],
                )
              }
            >
              <Text style={{fontSize: 11}}>✕</Text>
              <Text style={styles.cancelBtnText}>{t("rides.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }, [onCancelRide, onStartRide, today, t, language]);

  if (plannedRides.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIconWrap}>
          <Text style={{fontSize: 22}}>📅</Text>
        </View>
        <Text style={styles.emptyTitle}>{t("rides.noUpcoming")}</Text>
        <Text style={styles.emptySubtext}>{t("rides.noUpcomingSub")}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={plannedRides}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      contentContainerStyle={{ paddingBottom: 24 }}
      scrollEnabled={false}
      removeClippedSubviews
      initialNumToRender={4}
      maxToRenderPerBatch={8}
      windowSize={5}
    />
  );
}

const styles = StyleSheet.create({
  // ── Timeline layout ──────────────────────────────────────────────────────
  row: {
    flexDirection: "row",
    marginBottom: 12,
  },
  timeline: {
    width: 28,
    alignItems: "center",
    paddingTop: 20,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.dim,
    borderWidth: 2,
    borderColor: C.surfaceAlt,
    zIndex: 1,
  },
  dotActive: {
    backgroundColor: C.green,
    borderColor: C.greenFaint,
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: C.border,
    marginTop: 4,
  },

  // ── Card ─────────────────────────────────────────────────────────────────
  card: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 10,
  },
  cardFirst: {
    borderColor: "rgba(124,58,237,0.4)",
  },

  // ── Card header ──────────────────────────────────────────────────────────
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateBadge: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
  },
  dateBadgeWeekday: {
    color: C.purpleLight,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dateBadgeDate: {
    color: C.text,
    fontSize: 14,
    fontWeight: "700",
  },
  todayBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.greenFaint,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.25)",
  },
  todayBadgeText: {
    color: C.green,
    fontSize: 11,
    fontWeight: "700",
  },
  upcomingBadge: {
    backgroundColor: C.purpleFaint,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.border,
  },
  upcomingBadgeText: {
    color: C.purpleLight,
    fontSize: 11,
    fontWeight: "600",
  },

  // ── Destination ──────────────────────────────────────────────────────────
  destinationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  destIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: C.purpleFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  destination: {
    color: C.text,
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },

  // ── Meta chips ───────────────────────────────────────────────────────────
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.borderFaint,
  },
  metaText: {
    color: C.muted,
    fontSize: 11,
  },

  // ── Action buttons ───────────────────────────────────────────────────────
  actions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
  },
  startBtn: {
    backgroundColor: C.greenFaint,
    borderColor: "rgba(16,185,129,0.3)",
  },
  disabledBtn: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: C.borderFaint,
  },
  cancelBtn: {
    backgroundColor: C.redFaint,
    borderColor: "rgba(239,68,68,0.3)",
  },
  actionBtnText: {
    color: C.green,
    fontSize: 13,
    fontWeight: "600",
  },
  actionBtnTextDisabled: {
    color: C.dim,
  },
  cancelBtnText: {
    color: C.red,
    fontSize: 13,
    fontWeight: "600",
  },

  // ── Empty state ──────────────────────────────────────────────────────────
  empty: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 6,
  },
  emptyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: C.purpleFaint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: "700",
  },
  emptySubtext: {
    color: C.dim,
    fontSize: 13,
  },
});
