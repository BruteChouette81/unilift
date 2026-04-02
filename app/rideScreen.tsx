/**
 * Passenger Ride Screen
 * - State A: Pending approval (waiting for driver to accept join request)
 * - State B: Accepted & tracking driver (ride in progress, can scan QR to board)
 * - State C: Ride completed (mandatory rating)
 */

import { UserRideMapView } from '@/components/mapview';
import QrScanner from '@/components/QrScanner';
import RatingScreen from '@/components/ratings';
import { useActiveRide } from '@/context/ActiveRideContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAdaptivePolling } from '@/hooks/use-adaptive-polling';
import { useKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  firestoreDocumentUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import { validateAndBoardPassenger } from '@/services/paymentService';
import {
  cancelJoinRequest,
  fetchRideById,
  submitRating,
  updateRatings,
  updateXP,
} from '@/services/rideServices';

const C = {
  bg: "#080810", surface: "#0f0f1e", surfaceAlt: "#13132a",
  purple: "#8938D5", purpleLight: "#e09af7", blue: "#FD165A",
  text: "#f3f4f6", muted: "#9ca3af", dim: "#4b5563",
  danger: "#f87171", gold: "#fbbf24", success: "#34d399",
  border: "rgba(137, 56, 213, 0.22)", borderFaint: "rgba(255, 255, 255, 0.06)",
};
const BUTTON_GRADIENT = ["#FD165A", "#8938D5"] as const;
const BANNER_GRADIENT = ["#2d0015", "#1c0038"] as const;

type RideParams = {
  rideId: string;
  maxSeat: string;
  Originlat: string;
  OriginLng: string;
  DestinationLat: string;
  DestinationLng: string;
  pending: string;
};

const toSafeNumber = (value: string, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

type PassengerState = "pending" | "accepted" | "rejected" | "started" | "boarded" | "completed";

export default function RideScreen() {
  const { rideId, Originlat, OriginLng, DestinationLat, DestinationLng, pending } = useLocalSearchParams<RideParams>();
  const [originCoords, setOriginCoords] = useState<{ latitude: number; longitude: number }>({ latitude: 0, longitude: 0 });
  const [destinationCoords, setDestinationCoords] = useState<{ latitude: number; longitude: number }>({ latitude: 0, longitude: 0 });
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | undefined>();
  const [passengerState, setPassengerState] = useState<PassengerState>(pending === "true" ? "pending" : "accepted");
  const [loading, setLoading] = useState(false);
  const [boarded, setBoarded] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [rideStatus, setRideStatus] = useState<string>("planned");

  useKeepAwake();
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { setActiveRide, clearActiveRide } = useActiveRide();

  // Persist active ride so the user can return if backgrounded
  useEffect(() => {
    if (rideId) {
      setActiveRide({
        rideId,
        role: "passenger",
        params: { rideId, Originlat, OriginLng, DestinationLat, DestinationLng, pending: pending ?? "false" },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId]);

  useEffect(() => {
    setOriginCoords({
      latitude: toSafeNumber(Originlat),
      longitude: toSafeNumber(OriginLng),
    });
    setDestinationCoords({
      latitude: toSafeNumber(DestinationLat),
      longitude: toSafeNumber(DestinationLng),
    });
  }, [DestinationLat, DestinationLng, Originlat, OriginLng]);

  const hasNavigatedAwayRef = useRef(false);

  // Poll ride document for state changes
  useAdaptivePolling(
    async () => {
      try {
        const ride = await fetchRideById(rideId);
        if (!ride) {
          // Ride deleted (cancelled by driver)
          if (!hasNavigatedAwayRef.current) {
            hasNavigatedAwayRef.current = true;
            clearActiveRide();
            Alert.alert(t("passengerRide.rideCancelledTitle"), t("passengerRide.rideCancelledMsg"));
            router.push('/(tabs)');
          }
          return false;
        }

        setRideStatus(ride.status as string);

        // Update driver location if available
        if (ride.driverLocation) {
          setDriverLocation(ride.driverLocation);
        }

        // Check boarded status
        if (ride.boardedPassengers?.includes(user?.uid ?? "")) {
          setBoarded(true);
        }

        // State machine
        if (ride.status === "completed") {
          // Ride ended — check if we need to rate
          const needsRating = ride.pendingRatings?.includes(user?.uid ?? "") &&
            !ride.ratingsSubmitted?.includes(user?.uid ?? "");
          if (needsRating) {
            setPassengerState("completed");
          } else if (!hasNavigatedAwayRef.current) {
            // Either already rated or not required to rate — go home
            hasNavigatedAwayRef.current = true;
            clearActiveRide();
            router.replace("/");
          }
          return false;
        }

        if (passengerState === "pending") {
          // Check if we've been accepted (we're in passengers[])
          if (ride.passengers.includes(user?.uid ?? "")) {
            setPassengerState(ride.status === "started" ? "started" : "accepted");
            Alert.alert(t("passengerRide.requestAcceptedTitle"), t("passengerRide.requestAcceptedMsg"));
          }

          // Check if rejected
          const myRequest = ride.joinRequests?.[user?.uid ?? ""];
          if (myRequest?.status === "rejected") {
            if (!hasNavigatedAwayRef.current) {
              hasNavigatedAwayRef.current = true;
              clearActiveRide();
              Alert.alert(t("passengerRide.requestRejectedTitle"), t("passengerRide.requestRejectedMsg"));
              router.push('/(tabs)');
            }
            return false;
          }

          return true; // Keep polling
        }

        // If accepted and ride starts
        if ((passengerState === "accepted" || passengerState === "started") && ride.status === "started") {
          setPassengerState(boarded ? "boarded" : "started");
        }

        // Check if removed from ride
        if (!ride.passengers.includes(user?.uid ?? "") && !hasNavigatedAwayRef.current) {
          hasNavigatedAwayRef.current = true;
          clearActiveRide();
          Alert.alert(t("passengerRide.removedTitle"), t("passengerRide.removedMsg"));
          router.push('/(tabs)');
          return false;
        }

        return true;
      } catch (error) {
        console.error("Error checking ride status:", error);
        return false;
      }
    },
    {
      enabled: Boolean(rideId && user?.uid),
      // Fast polling when ride is started (tracking driver), slower otherwise
      initialDelayMs: rideStatus === "started" ? 3000 : 2500,
      maxDelayMs: rideStatus === "started" ? 6000 : 20000,
      backoffFactor: rideStatus === "started" ? 1.0 : 1.5,
    },
  );

  const quitRide = async () => {
    if (!user) return;

    if (passengerState === "pending") {
      // Cancel join request
      Alert.alert(
        t("passengerRide.cancelRequestTitle"),
        t("passengerRide.cancelRequestMsg"),
        [
          { text: t("common.no"), style: "cancel" },
          {
            text: t("passengerRide.cancelRequestBtn"),
            style: "destructive",
            onPress: async () => {
              setLoading(true);
              try {
                await cancelJoinRequest(rideId);
                clearActiveRide();
                router.push('/(tabs)');
              } catch (e) {
                Alert.alert(t("common.error"), t("passengerRide.failedCancelRequest"));
              } finally {
                setLoading(false);
              }
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      t("passengerRide.leaveRideTitle"),
      boarded
        ? t("passengerRide.leaveRideMsgBoarded")
        : t("passengerRide.leaveRideMsg"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("passengerRide.leave"),
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              const rideUrl = withFirebaseApiKey(
                `${firestoreDocumentUrl("rides", rideId)}?updateMask.fieldPaths=passengers&updateMask.fieldPaths=seatsAvailable`,
              );

              const rideRes = await fetch(rideUrl);
              const rideData = await rideRes.json();

              const currentPassengers =
                rideData.fields.passengers.arrayValue?.values?.map((v: any) => v.stringValue) || [];
              const newPassengers = currentPassengers.filter((pid: string) => pid !== user?.uid);

              const updateDoc = {
                fields: {
                  passengers: {
                    arrayValue: { values: newPassengers.map((id: string) => ({ stringValue: id })) },
                  },
                  seatsAvailable: {
                    integerValue: Number(rideData.fields.seatsAvailable.integerValue) + 1,
                  },
                },
              };

              const updateRes = await fetch(rideUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updateDoc),
              });

              if (!updateRes.ok) throw new Error("Failed to leave ride");
              clearActiveRide();
              router.push('/(tabs)');
            } catch (e) {
              Alert.alert(t("common.error"), t("passengerRide.failedLeaveRide"));
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleQrScan = async (payload: string) => {
    setShowScanner(false);
    try {
      if (!user) throw new Error("Not authenticated");
      await validateAndBoardPassenger(payload, user.uid, rideId);
      setBoarded(true);
      setPassengerState("boarded");
      Alert.alert(t("passengerRide.verifiedTitle"), t("passengerRide.verifiedMsg"));
    } catch (e: any) {
      Alert.alert(t("passengerRide.verificationFailedTitle"), e.message ?? t("passengerRide.verificationFailedTitle"));
    }
  };

  const handleRatingSubmitted = async (rating: number) => {
    if (!user) return;
    try {
      const driverId = await updateRatings(rideId, rating);
      await updateXP(user.uid, driverId!, rating * 20);
      await submitRating(rideId, user.uid);
      hasNavigatedAwayRef.current = true;
      clearActiveRide();
      Alert.alert("Thank you!", `You submitted a ${rating}/5 rating.`, [
        { text: "OK", onPress: () => router.replace("/") },
      ]);
    } catch (e) {
      Alert.alert(t("common.error"), t("passengerRide.failedRating"));
    }
  };

  // ── Render: Completed → mandatory rating ──
  if (passengerState === "completed") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar style="light" />
        <RatingScreen rideId={rideId} onRatingSubmitted={handleRatingSubmitted} />
      </SafeAreaView>
    );
  }

  // ── Status badge info ──
  const getStatusInfo = (): { label: string; color: string; icon: string } => {
    switch (passengerState) {
      case "pending":
        return { label: t("passengerRide.statusPending"), color: C.gold, icon: "⏱" };
      case "accepted":
        return { label: t("passengerRide.statusAccepted"), color: C.success, icon: "✅" };
      case "started":
        return { label: t("passengerRide.statusStarted"), color: C.purpleLight, icon: "🧭" };
      case "boarded":
        return { label: t("passengerRide.statusBoarded"), color: C.success, icon: "✅" };
      default:
        return { label: t("passengerRide.statusJoined"), color: C.success, icon: "✅" };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      {/* Header */}
      <LinearGradient colors={BANNER_GRADIENT} style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.liveDot, { backgroundColor: statusInfo.color }]} />
          <Text style={styles.headerTitle}>
            {passengerState === "pending" ? t("passengerRide.joinRequestHeader") : t("passengerRide.rideInProgressHeader")}
          </Text>
        </View>
        <Text style={styles.rideIdBadge}>#{rideId?.slice(-6)}</Text>
      </LinearGradient>

      {/* Map */}
      <View style={styles.mapContainer}>
        <UserRideMapView
          origin={originCoords}
          destination={destinationCoords}
          driverLocation={driverLocation}
        />
      </View>

      {/* Bottom panel */}
      <View style={styles.panel}>
        {/* Status card */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.sectionIconBox}>
              <Text style={{fontSize: 14}}>{statusInfo.icon}</Text>
            </View>
            <Text style={styles.cardLabel}>{t("passengerRide.statusLabel")}</Text>
            <View style={[styles.statusBadge, { backgroundColor: `${statusInfo.color}22` }]}>
              <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>
                {statusInfo.label}
              </Text>
            </View>
          </View>

          {/* Boarding status (only show after accepted) */}
          {passengerState !== "pending" && (
            <View style={[styles.cardRow, { marginTop: 12 }]}>
              <View style={styles.sectionIconBox}>
                <Text style={{fontSize: 14}}>📱</Text>
              </View>
              <Text style={styles.cardLabel}>{t("passengerRide.boardingLabel")}</Text>
              {boarded ? (
                <View style={styles.boardedBadge}>
                  <Text style={styles.boardedBadgeText}>{t("passengerRide.boarded")}</Text>
                </View>
              ) : (
                <View style={styles.notBoardedBadge}>
                  <Text style={styles.notBoardedBadgeText}>{t("passengerRide.scanDriverQr")}</Text>
                </View>
              )}
            </View>
          )}

          {/* Driver location indicator */}
          {driverLocation && passengerState === "started" && (
            <View style={[styles.cardRow, { marginTop: 12 }]}>
              <View style={styles.sectionIconBox}>
                <Text style={{fontSize: 14}}>🚗</Text>
              </View>
              <Text style={styles.cardLabel}>{t("passengerRide.driverLabel")}</Text>
              <View style={styles.trackingBadge}>
                <Text style={styles.trackingBadgeText}>{t("passengerRide.liveTracking")}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Scan QR Code button (only when ride is started and not yet boarded) */}
        {(passengerState === "started" || passengerState === "accepted") && !boarded && (
          <TouchableOpacity
            onPress={() => setShowScanner(true)}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={BUTTON_GRADIENT}
              style={styles.primaryBtn}
            >
              <Text style={[{fontSize: 16}, { marginRight: 6 }]}>📱</Text>
              <Text style={styles.btnText}>{t("passengerRide.scanQrBtn")}</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Quit / Cancel button */}
        {!boarded && (
          <TouchableOpacity
            style={[styles.dangerBtn, loading && styles.btnDisabled]}
            onPress={quitRide}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>
              {passengerState === "pending" ? t("passengerRide.cancelRequest") : t("passengerRide.quitRide")}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* QR Scanner Modal */}
      <Modal
        visible={showScanner}
        animationType="slide"
        onRequestClose={() => setShowScanner(false)}
      >
        <QrScanner
          onScanned={handleQrScan}
          onClose={() => setShowScanner(false)}
        />
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.success,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: C.text,
  },
  rideIdBadge: {
    fontSize: 12,
    color: C.purpleLight,
    backgroundColor: "rgba(137,56,213,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  mapContainer: { flex: 1 },
  panel: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    padding: 16,
    gap: 10,
  },
  card: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.borderFaint,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionIconBox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "rgba(224,154,247,0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  cardLabel: {
    flex: 1,
    fontSize: 14,
    color: C.muted,
  },
  statusBadge: {
    backgroundColor: "rgba(52,211,153,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusBadgeText: {
    fontSize: 12,
    color: C.success,
    fontWeight: "600",
  },
  boardedBadge: {
    backgroundColor: "rgba(52,211,153,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  boardedBadgeText: {
    fontSize: 12,
    color: C.success,
    fontWeight: "600",
  },
  notBoardedBadge: {
    backgroundColor: "rgba(251,191,36,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  notBoardedBadgeText: {
    fontSize: 12,
    color: C.gold,
    fontWeight: "600",
  },
  trackingBadge: {
    backgroundColor: "rgba(224,154,247,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  trackingBadgeText: {
    fontSize: 12,
    color: C.purpleLight,
    fontWeight: "600",
  },
  dangerBtn: {
    backgroundColor: "#ef4444",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  btnText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
