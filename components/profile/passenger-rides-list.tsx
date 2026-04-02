import React, { useCallback, useMemo } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Ride } from "@/types/models";
import { useLanguage } from "@/context/LanguageContext";
import type { Language } from "@/constants/translations";

const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(124, 58, 237, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#7C3AED",
  purpleLight: "#a78bfa",
  purpleFaint: "rgba(124,58,237,0.12)",
  green:       "#10b981",
  greenFaint:  "rgba(16,185,129,0.12)",
  gold:        "#fbbf24",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
};

type PassengerRidesListProps = {
  rides: Ride[];
  userId: string;
  onEnterRide: (ride: Ride) => void;
};

function formatDate(iso: string, language: Language): { weekday: string; date: string; time: string } {
  const locale = language === "fr" ? "fr-CA" : "en-CA";
  const d = new Date(iso);
  return {
    weekday: d.toLocaleDateString(locale, { weekday: "short" }),
    date:    d.toLocaleDateString(locale, { month: "short", day: "numeric" }),
    time:    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
  };
}

export function PassengerRidesList({ rides, userId, onEnterRide }: PassengerRidesListProps) {
  const { t, language } = useLanguage();

  const passengerRides = useMemo(
    () =>
      rides.filter(
        (ride) =>
          ride.passengers.includes(userId) &&
          ride.driverId !== userId &&
          ride.status !== "completed",
      ),
    [rides, userId],
  );

  const keyExtractor = useCallback((item: Ride) => item.id, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Ride; index: number }) => {
      const formatted = item.date ? formatDate(item.date, language) : null;
      const isStarted = item.status === "started";
      const isFirst = index === 0;

      return (
        <View style={styles.row}>
          {/* Timeline dot */}
          <View style={styles.timeline}>
            <View style={[styles.dot, isStarted && styles.dotActive]} />
            <View style={styles.line} />
          </View>

          {/* Card */}
          <View style={[styles.card, isFirst && styles.cardFirst]}>
            {/* Header row */}
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

              {isStarted ? (
                <View style={styles.startedBadge}>
                  <View style={styles.startedDot} />
                  <Text style={styles.startedBadgeText}>{t("rides.rideStarted")}</Text>
                </View>
              ) : (
                <View style={styles.waitingBadge}>
                  <Text style={styles.waitingBadgeText}>{t("rides.waitingToStart")}</Text>
                </View>
              )}
            </View>

            {/* Destination */}
            <View style={styles.destinationRow}>
              <View style={styles.destIconWrap}>
                <Text style={{ fontSize: 12 }}>📍</Text>
              </View>
              <Text style={styles.destination} numberOfLines={1}>
                {item.destination}
              </Text>
            </View>

            {/* Meta */}
            <View style={styles.metaRow}>
              {formatted && (
                <View style={styles.metaChip}>
                  <Text style={{ fontSize: 10 }}>⏱</Text>
                  <Text style={styles.metaText}>{formatted.time}</Text>
                </View>
              )}
              <View style={styles.metaChip}>
                <Text style={{ fontSize: 10 }}>🚗</Text>
                <Text style={styles.metaText}>{item.driverName ?? t("rides.unknownDriver")}</Text>
              </View>
              <View style={styles.metaChip}>
                <Text style={{ fontSize: 10 }}>👥</Text>
                <Text style={styles.metaText}>
                  {t("rides.seatsLeft", { count: item.seatsAvailable })}
                </Text>
              </View>
            </View>

            {/* Enter Ride button — only when started */}
            {isStarted && (
              <TouchableOpacity
                style={styles.enterBtn}
                onPress={() => onEnterRide(item)}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 12 }}>▶</Text>
                <Text style={styles.enterBtnText}>{t("rides.enterRide")}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    },
    [onEnterRide, t, language],
  );

  if (passengerRides.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIconWrap}>
          <Text style={{ fontSize: 22 }}>🎒</Text>
        </View>
        <Text style={styles.emptyTitle}>{t("rides.noPassengerRides")}</Text>
        <Text style={styles.emptySubtext}>{t("rides.noPassengerRidesSub")}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={passengerRides}
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
  startedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.greenFaint,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.25)",
  },
  startedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.green,
  },
  startedBadgeText: {
    color: C.green,
    fontSize: 11,
    fontWeight: "700",
  },
  waitingBadge: {
    backgroundColor: "rgba(251,191,36,0.08)",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.25)",
  },
  waitingBadgeText: {
    color: C.gold,
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

  // ── Enter button ─────────────────────────────────────────────────────────
  enterBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: C.greenFaint,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.3)",
    borderRadius: 9,
    paddingVertical: 9,
    marginTop: 2,
  },
  enterBtnText: {
    color: C.green,
    fontSize: 13,
    fontWeight: "700",
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
