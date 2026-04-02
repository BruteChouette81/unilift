/**
 * Driver Ride Screen
 * - Pre-start: see join requests, accept/reject, show passenger positions on map
 * - Post-start: broadcast live location, show QR for boarding, end ride
 */

//claude --resume "ride-flow-approval-tracking"

import { DriverRideMapView } from "@/components/mapview";
import QrCodeDisplay from "@/components/QrCodeDisplay";
import {
  firestoreDocumentUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import { useAdaptivePolling } from "@/hooks/use-adaptive-polling";
import { generateQrToken, processRidePayments } from "@/services/paymentService";
import {
  fetchRideById,
  markRideCompleted,
  respondToJoinRequest,
  startRideService,
  updateDriverLocation,
} from "@/services/rideServices";
import type { JoinRequest } from "@/types/models";
import { useActiveRide } from "@/context/ActiveRideContext";
import { useLanguage } from "@/context/LanguageContext";
import { useKeepAwake } from "expo-keep-awake";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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
  Destination: string;
};

const toSafeNumber = (value: string, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default function RideModeDriver() {
  useKeepAwake();
  const router = useRouter();
  const { t } = useLanguage();
  const { setActiveRide, clearActiveRide } = useActiveRide();
  const { rideId, Originlat, OriginLng, DestinationLat, DestinationLng, Destination } = useLocalSearchParams<RideParams>();

  const [passengers, setPassengers] = useState<string[]>([]);
  const [joinRequests, setJoinRequests] = useState<Record<string, JoinRequest>>({});
  const [passengersCoords, setPassengersCoords] = useState<{ latitude: number; longitude: number }[] | null>(null);
  const [rideStarted, setRideStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number>(0);
  const [showQrModal, setShowQrModal] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [boardedPassengerIds, setBoardedPassengerIds] = useState<string[]>([]);

  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  const url = withFirebaseApiKey(firestoreDocumentUrl("rides", rideId));

  const originCoords = {
    latitude: toSafeNumber(Originlat),
    longitude: toSafeNumber(OriginLng),
  };
  const destCoords = {
    latitude: toSafeNumber(DestinationLat),
    longitude: toSafeNumber(DestinationLng),
  };

  // Persist active ride so the user can return from Google Maps / other apps
  useEffect(() => {
    if (rideId) {
      setActiveRide({
        rideId,
        role: "driver",
        params: { rideId, Originlat, OriginLng, DestinationLat, DestinationLng, Destination: Destination ?? "" },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId]);

  // Generate QR token
  const generateQr = async () => {
    try {
      const tokenPayload = await generateQrToken(rideId);
      setQrToken(tokenPayload);
      const parsed = JSON.parse(atob(tokenPayload));
      setQrExpiresAt(parsed.expiresAt);
    } catch (e) {
      console.warn('QR generation failed', e);
    }
  };

  useEffect(() => {
    if (rideId) void generateQr();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId]);

  // Regenerate QR when returning from background (e.g. Google Maps)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && rideId) {
        // Refresh QR if it's about to expire or already expired
        if (Date.now() / 1000 > qrExpiresAt - 30) {
          void generateQr();
        }
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, qrExpiresAt]);

  // Cleanup location subscription on unmount
  useEffect(() => {
    return () => {
      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }
    };
  }, []);

  // Poll ride doc for join requests, passengers, and boarded status
  const passengerCountRef = useRef(0);
  useAdaptivePolling(
    async () => {
      try {
        const ride = await fetchRideById(rideId);
        if (!ride) return false;

        // Update passengers
        if (ride.passengers.length > passengerCountRef.current) {
          Alert.alert(t("driverRide.passengerAcceptedTitle"), t("driverRide.passengerAcceptedMsg"));
        }
        passengerCountRef.current = ride.passengers.length;
        setPassengers((prev) => {
          const prevKey = prev.join(",");
          const nextKey = ride.passengers.join(",");
          return prevKey === nextKey ? prev : ride.passengers;
        });

        // Update join requests
        setJoinRequests(ride.joinRequests ?? {});

        // Update boarded passengers
        setBoardedPassengerIds(ride.boardedPassengers ?? []);

        // Check if ride was started externally
        if (ride.status === "started" && !rideStarted) {
          setRideStarted(true);
        }

        return ride.passengers.length > 0 || Object.keys(ride.joinRequests ?? {}).length > 0;
      } catch (e) {
        console.log("Error polling ride:", e);
        return false;
      }
    },
    {
      enabled: Boolean(rideId),
      initialDelayMs: 1500,
      maxDelayMs: 15000,
      backoffFactor: 1.6,
    },
  );

  // Get pending join requests
  const pendingRequests = Object.values(joinRequests).filter((r) => r.status === "pending");
  const pendingLocations = pendingRequests.map((r) => r.location);

  const handleAcceptRequest = async (passengerId: string) => {
    try {
      setLoading(true);
      await respondToJoinRequest(rideId, passengerId, true);
      Alert.alert(t("driverRide.acceptedTitle"), t("driverRide.acceptedMsg"));
    } catch (e: any) {
      Alert.alert(t("common.error"), e.message ?? t("driverRide.failedAccept"));
    } finally {
      setLoading(false);
    }
  };

  const handleRejectRequest = async (passengerId: string) => {
    try {
      setLoading(true);
      await respondToJoinRequest(rideId, passengerId, false);
    } catch (e: any) {
      Alert.alert(t("common.error"), e.message ?? t("driverRide.failedReject"));
    } finally {
      setLoading(false);
    }
  };

  const cancelRide = async () => {
    Alert.alert(
      t("driverRide.cancelRideTitle"),
      t("driverRide.cancelRideMsg"),
      [
        { text: t("driverRide.back"), style: "cancel" },
        {
          text: t("driverRide.cancelRide"),
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              await fetch(url, { method: "DELETE" });
              clearActiveRide();
              Alert.alert(t("driverRide.rideCancelledTitle"), t("driverRide.rideCancelledMsg"));
              router.replace("/");
            } catch (e) {
              Alert.alert(t("common.error"), t("driverRide.rideCancelledMsg"));
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const startLocationBroadcast = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(t("driverRide.permissionDeniedTitle"), t("driverRide.permissionDeniedMsg"));
      return;
    }

    locationSubRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 50,
        timeInterval: 8000,
      },
      (loc) => {
        updateDriverLocation(rideId, {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      },
    );
  };

  const openGoogleMaps = (coords: { latitude: number; longitude: number }[]) => {
    const path = coords.map(c => `${c.latitude},${c.longitude}`).join('/');
    const mapsUrl = `https://www.google.com/maps/dir/${path}`;
    Linking.openURL(mapsUrl);
  };

  const startRideManually = async () => {
    if (passengers.length === 0) {
      Alert.alert(t("driverRide.noPassengersTitle"), t("driverRide.noPassengersMsg"));
      return;
    }

    setLoading(true);
    try {
      await startRideService(rideId);
      setRideStarted(true);

      // Start broadcasting location
      await startLocationBroadcast();

      // Open Google Maps with waypoints
      if (!passengersCoords) {
        openGoogleMaps([originCoords, destCoords]);
      } else {
        openGoogleMaps([
          originCoords,
          ...passengersCoords.map(p => ({ latitude: p.latitude, longitude: p.longitude })),
          destCoords,
        ]);
      }
      Alert.alert(t("driverRide.rideStartedTitle"), t("driverRide.rideStartedMsg"));
    } catch (e: any) {
      Alert.alert(t("common.error"), e.message ?? t("driverRide.failedStartRide"));
    } finally {
      setLoading(false);
    }
  };

  const endRide = async () => {
    Alert.alert(
      t("driverRide.endRideTitle"),
      t("driverRide.endRideMsg"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("driverRide.endRide"),
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              // Process payments
              try {
                setPaymentProcessing(true);
                await processRidePayments(
                  rideId,
                  { lat: originCoords.latitude, lng: originCoords.longitude },
                  { lat: destCoords.latitude, lng: destCoords.longitude },
                );
              } catch (e) {
                console.warn('Payment processing failed (non-fatal):', e);
              } finally {
                setPaymentProcessing(false);
              }

              // Mark ride as completed with pending ratings
              await markRideCompleted(rideId, boardedPassengerIds.length > 0 ? boardedPassengerIds : passengers);

              // Stop location broadcasting
              if (locationSubRef.current) {
                locationSubRef.current.remove();
                locationSubRef.current = null;
              }

              clearActiveRide();
              Alert.alert(t("driverRide.rideEndedTitle"), t("driverRide.rideEndedMsg"));
              router.replace("/");
            } catch (e) {
              Alert.alert(t("common.error"), t("driverRide.failedEndRide"));
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const onPassengerKicked = (passengerId: string) => {
    Alert.alert(
      t("driverRide.removePassengerTitle"),
      t("driverRide.removePassengerMsg"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("driverRide.remove"),
          style: "destructive",
          onPress: async () => {
            try {
              const kickUrl = withFirebaseApiKey(firestoreDocumentUrl("rides", rideId));
              const rideRes = await fetch(kickUrl);
              const rideData = await rideRes.json();
              const currentPassengers =
                rideData.fields.passengers.arrayValue?.values?.map((v: any) => v.stringValue) || [];
              const newPassengers = currentPassengers.filter((pid: string) => pid !== passengerId);

              const patchUrl = withFirebaseApiKey(
                `${firestoreDocumentUrl("rides", rideId)}?updateMask.fieldPaths=passengers&updateMask.fieldPaths=seatsAvailable`,
              );
              const body = {
                fields: {
                  passengers: {
                    arrayValue: { values: newPassengers.map((id: string) => ({ stringValue: id })) },
                  },
                  seatsAvailable: {
                    integerValue: Number(rideData.fields.seatsAvailable.integerValue) + 1,
                  },
                },
              };
              const res = await fetch(patchUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              if (!res.ok) throw new Error("Failed");
              Alert.alert(t("driverRide.passengerRemovedTitle"), t("driverRide.passengerRemovedMsg"));
            } catch (e) {
              Alert.alert(t("common.error"), t("driverRide.failedRemovePassenger"));
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      {/* Header */}
      <LinearGradient colors={BANNER_GRADIENT} style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.liveDot} />
          <Text style={styles.headerTitle}>{t("driverRide.headerTitle")}</Text>
        </View>
        <View style={styles.modeBadge}>
          <Text style={{fontSize: 12}}>🚗</Text>
          <Text style={styles.modeBadgeText}>{rideStarted ? t("driverRide.inProgress") : t("driverRide.waiting")}</Text>
        </View>
      </LinearGradient>

      {/* Map */}
      <View style={styles.mapContainer}>
        <DriverRideMapView
          origin={originCoords}
          destination={destCoords}
          passengers={passengers}
          setCoords={setPassengersCoords}
          pendingLocations={pendingLocations}
        />
      </View>

      {!rideStarted ? (
        /* ── Pre-Start Panel ── */
        <View style={styles.panel}>
          {/* Info card */}
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.sectionIconBox}>
                <Text style={{fontSize: 12}}>🚩</Text>
              </View>
              <Text style={styles.infoLabel}>{t("driverRide.destination")}</Text>
              <Text style={styles.infoValue} numberOfLines={1}>
                {Destination ? decodeURIComponent(Destination) : `${DestinationLat}, ${DestinationLng}`}
              </Text>
            </View>
            <View style={[styles.infoRow, { marginTop: 8 }]}>
              <View style={styles.sectionIconBox}>
                <Text style={{fontSize: 12}}>👥</Text>
              </View>
              <Text style={styles.infoLabel}>{t("driverRide.passengers")}</Text>
              <Text style={styles.infoValue}>{passengers.length} {t("driverRide.acceptedCount")}</Text>
            </View>
          </View>

          {/* Pending Join Requests */}
          {pendingRequests.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t("driverRide.joinRequests")}</Text>
              <ScrollView style={styles.passengerList} nestedScrollEnabled>
                {pendingRequests.map((req) => (
                  <View key={req.passengerId} style={styles.requestCard}>
                    <View style={styles.avatarPlaceholder}>
                      <Text style={{fontSize: 16}}>🙋</Text>
                    </View>
                    <View style={styles.passengerInfo}>
                      <Text style={styles.passengerIdText} numberOfLines={1}>
                        {req.passengerId.slice(0, 12)}...
                      </Text>
                      <Text style={styles.passengerSubtext}>{t("driverRide.wantsToJoin")}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleAcceptRequest(req.passengerId)}
                      style={styles.acceptBtn}
                      disabled={loading}
                      activeOpacity={0.8}
                    >
                      <Text style={{fontSize: 14}}>✅</Text>
                      <Text style={styles.acceptText}>{t("driverRide.accept")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleRejectRequest(req.passengerId)}
                      style={styles.kickBtn}
                      disabled={loading}
                      activeOpacity={0.8}
                    >
                      <Text style={{fontSize: 14}}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </>
          )}

          {/* Accepted Passengers */}
          {passengers.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>{t("driverRide.acceptedPassengers")}</Text>
              <ScrollView style={styles.passengerList} nestedScrollEnabled>
                {passengers.map((pid) => (
                  <View key={pid} style={styles.passengerCard}>
                    <View style={styles.avatarPlaceholder}>
                      <Text style={{fontSize: 16}}>👤</Text>
                    </View>
                    <View style={styles.passengerInfo}>
                      <Text style={styles.passengerIdText} numberOfLines={1}>
                        {pid.slice(0, 12)}...
                      </Text>
                      <Text style={styles.passengerSubtext}>{t("driverRide.accepted")}</Text>
                    </View>
                    <TouchableOpacity onPress={() => onPassengerKicked(pid)} style={styles.kickBtn} activeOpacity={0.8}>
                      <Text style={{fontSize: 14}}>✕</Text>
                      <Text style={styles.kickText}>{t("driverRide.remove")}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </>
          ) : pendingRequests.length === 0 ? (
            <Text style={styles.waitingText}>{t("driverRide.waitingForPassengers")}</Text>
          ) : null}

          {/* Show Boarding QR */}
          {qrToken && (
            <TouchableOpacity onPress={() => setShowQrModal(true)} activeOpacity={0.8}>
              <LinearGradient colors={BUTTON_GRADIENT} style={styles.primaryBtn}>
                <Text style={[{fontSize: 16}, { marginRight: 6 }]}>📱</Text>
                <Text style={styles.btnText}>{t("driverRide.showBoardingQr")}</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* Start Ride */}
          <TouchableOpacity onPress={startRideManually} disabled={loading || passengers.length === 0} activeOpacity={0.8}>
            <LinearGradient
              colors={BUTTON_GRADIENT}
              style={[styles.primaryBtn, (loading || passengers.length === 0) && styles.btnDisabled]}
            >
              <Text style={[{fontSize: 16}, { marginRight: 6 }]}>🧭</Text>
              <Text style={styles.btnText}>{t("driverRide.startRide")}</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Cancel Ride */}
          <TouchableOpacity
            style={[styles.dangerBtn, loading && styles.btnDisabled]}
            onPress={cancelRide}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>{t("driverRide.cancelRide")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* ── In-Progress Panel ── */
        <View style={styles.panel}>
          <View style={styles.infoCard}>
            <Text style={[styles.infoLabel, { color: C.success }]}>{t("driverRide.rideInProgress")}</Text>
            <Text style={styles.waitingText}>{t("driverRide.locationShared")}</Text>
          </View>

          {/* Passenger boarding list */}
          {passengers.length > 0 && (
            <ScrollView style={styles.passengerList} nestedScrollEnabled>
              {passengers.map((pid) => (
                <View key={pid} style={styles.passengerCard}>
                  <View style={styles.avatarPlaceholder}>
                    <Text style={{fontSize: 16}}>👤</Text>
                  </View>
                  <View style={styles.passengerInfo}>
                    <Text style={styles.passengerIdText} numberOfLines={1}>
                      {pid.slice(0, 12)}...
                    </Text>
                    <Text style={styles.passengerSubtext}>
                      {boardedPassengerIds.includes(pid) ? t("driverRide.boarded") : t("driverRide.notBoardedYet")}
                    </Text>
                  </View>
                  {boardedPassengerIds.includes(pid) ? (
                    <Text style={{fontSize: 20}}>✅</Text>
                  ) : (
                    <Text style={{fontSize: 20}}>⏱</Text>
                  )}
                </View>
              ))}
            </ScrollView>
          )}

          {/* Show QR Code button */}
          {qrToken && (
            <TouchableOpacity onPress={() => setShowQrModal(true)} activeOpacity={0.8}>
              <LinearGradient colors={BUTTON_GRADIENT} style={styles.primaryBtn}>
                <Text style={[{fontSize: 16}, { marginRight: 6 }]}>📱</Text>
                <Text style={styles.btnText}>{t("driverRide.showQrCode")}</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.dangerBtn, (loading || paymentProcessing) && styles.btnDisabled]}
            onPress={endRide}
            disabled={loading || paymentProcessing}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>
              {paymentProcessing ? t("driverRide.processingPayment") : t("driverRide.endRide")}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* QR Code Modal */}
      <Modal
        visible={showQrModal}
        animationType="slide"
        onRequestClose={() => setShowQrModal(false)}
      >
        {qrToken ? (
          <QrCodeDisplay
            token={qrToken}
            expiresAt={qrExpiresAt}
            onClose={() => setShowQrModal(false)}
            onExpired={generateQr}
          />
        ) : null}
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
  modeBadge: {
    flexDirection: "row",
    gap: 4,
    backgroundColor: "rgba(137,56,213,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignItems: "center",
  },
  modeBadgeText: {
    fontSize: 12,
    color: C.purpleLight,
    fontWeight: "600",
  },
  mapContainer: { flex: 1 },
  panel: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    padding: 16,
    gap: 10,
    maxHeight: "55%",
  },
  infoCard: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.borderFaint,
  },
  infoRow: {
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
  infoLabel: {
    flex: 1,
    fontSize: 13,
    color: C.muted,
  },
  infoValue: {
    fontSize: 13,
    color: C.text,
    fontWeight: "600",
    maxWidth: "50%",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: C.purpleLight,
    marginTop: 4,
  },
  passengerList: {
    maxHeight: 140,
  },
  passengerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    padding: 10,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: C.borderFaint,
  },
  requestCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    padding: 10,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.2)",
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(137,56,213,0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  passengerInfo: {
    flex: 1,
  },
  passengerIdText: {
    fontSize: 13,
    color: C.text,
    fontWeight: "600",
  },
  passengerSubtext: {
    fontSize: 11,
    color: C.muted,
  },
  acceptBtn: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(52,211,153,0.12)",
    alignItems: "center",
    marginRight: 6,
  },
  acceptText: {
    fontSize: 12,
    color: C.success,
    fontWeight: "600",
  },
  kickBtn: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(248,113,113,0.12)",
    alignItems: "center",
  },
  kickText: {
    fontSize: 12,
    color: C.danger,
    fontWeight: "600",
  },
  waitingText: {
    fontSize: 13,
    color: C.muted,
    textAlign: "center",
    paddingVertical: 8,
  },
  primaryBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  dangerBtn: {
    backgroundColor: "#ef4444",
    borderRadius: 10,
    paddingVertical: 14,
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
