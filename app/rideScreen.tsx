/**
 * Passenger Ride Screen
 * - State A: Pending approval (waiting for driver to accept join request)
 * - State B: Accepted & tracking driver (ride in progress, can scan QR to board)
 * - State C: Ride completed (mandatory rating)
 */

import { UserRideMapView } from '@/components/mapview';
import CertBadges from '@/components/cert-badges';
import QrScanner from '@/components/QrScanner';
import RatingScreen from '@/components/ratings';
import { CANCELLATION_FEES } from "@/constants/cancellation";
import { formatCentsAsDollars } from "@/constants/pricing";
import { useActiveRide } from '@/context/ActiveRideContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { useAdaptivePolling } from '@/hooks/use-adaptive-polling';
import { validateAndBoardPassenger } from '@/services/paymentService';
import {
  cancelJoinRequest,
  fetchRideById,
  leaveRide,
  submitRideRating,
} from '@/services/rideServices';
import { fetchUserDocument, extractDriverProfile, type DriverProfile } from '@/services/userService';
import { rideLog } from '@/utils/ride-logger';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getAuth } from 'firebase/auth';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const C = {
  bg: "#080810", surface: "#0f0f1e", surfaceAlt: "#13132a",
  purple: "#8938D5", purpleLight: "#e09af7", blue: "#FD165A",
  text: "#f3f4f6", muted: "#9ca3af", dim: "#4b5563",
  danger: "#f87171", gold: "#fbbf24", success: "#34d399",
  border: "rgba(137, 56, 213, 0.22)", borderFaint: "rgba(255, 255, 255, 0.06)",
};

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

type TFn = (key: string, params?: any) => string;

function getStatusInfo(passengerState: PassengerState, t: TFn): { label: string; color: string; icon: string } {
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
}

// ─── Memoized header ─────────────────────────────────────────────────────────
type RideHeaderProps = {
  passengerState: PassengerState;
  boarded: boolean;
  rideIdShort: string;
  topInset: number;
  t: TFn;
};

const RideHeader = React.memo(function RideHeader({
  passengerState, boarded, rideIdShort, topInset, t,
}: RideHeaderProps) {
  const statusInfo = getStatusInfo(passengerState, t);
  return (
    <View style={[styles.header, { paddingTop: topInset + 12 }]}>
      <BlurView intensity={40} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={styles.headerScrim} pointerEvents="none" />
      <View style={styles.headerLeft}>
        <View style={[styles.liveDot, { backgroundColor: statusInfo.color }]} />
        <Text style={styles.headerTitle}>
          {passengerState === "pending"
            ? t("passengerRide.joinRequestHeader")
            : passengerState === "accepted"
              ? t("passengerRide.waitingForDriverHeader")
              : t("passengerRide.rideInProgressHeader")}
        </Text>
      </View>
      <Text style={styles.rideIdBadge}>#{rideIdShort}</Text>
    </View>
  );
}, (prev, next) => (
  prev.passengerState === next.passengerState &&
  prev.boarded === next.boarded &&
  prev.rideIdShort === next.rideIdShort &&
  prev.topInset === next.topInset &&
  prev.t === next.t
));

// ─── Memoized bottom panel ───────────────────────────────────────────────────
type BottomPanelProps = {
  passengerState: PassengerState;
  boarded: boolean;
  loading: boolean;
  hasDriverLocation: boolean;
  bottomInset: number;
  driverName?: string;
  driverAvatar?: string | null;
  driverCerts?: string[];
  onScan: () => void;
  onQuit: () => void;
  onLeave: () => void;
  onViewDriver: () => void;
  t: TFn;
};

const BottomPanel = React.memo(function BottomPanel({
  passengerState, boarded, loading, hasDriverLocation, bottomInset,
  driverName, driverAvatar, driverCerts, onScan, onQuit, onLeave, onViewDriver, t,
}: BottomPanelProps) {
  const statusInfo = getStatusInfo(passengerState, t);
  return (
    <View style={[styles.panel, { paddingBottom: bottomInset + 12 }]}>
      <BlurView intensity={55} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.panelGlass} pointerEvents="none" />
      <View style={styles.panelScrim} pointerEvents="none" />

      {/* Driver card — read-only, tappable to view full profile */}
      {driverName != null && (
        <TouchableOpacity style={styles.driverCard} onPress={onViewDriver} activeOpacity={0.75}>
          {driverAvatar ? (
            <ExpoImage source={{ uri: driverAvatar }} style={styles.driverAvatar} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <View style={[styles.driverAvatar, styles.driverAvatarFallback]}>
              <Text style={{ fontSize: 18 }}>🚗</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.driverName} numberOfLines={1}>{driverName}</Text>
              <CertBadges certifications={driverCerts} size="compact" hideWhenEmpty />
            </View>
            <Text style={styles.driverSub}>{t("passengerRide.viewDriverProfile")}</Text>
          </View>
          <Text style={{ fontSize: 16, color: "#9ca3af" }}>›</Text>
        </TouchableOpacity>
      )}

      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={styles.sectionIconBox}>
            <Text style={{ fontSize: 14 }}>{statusInfo.icon}</Text>
          </View>
          <Text style={styles.cardLabel}>{t("passengerRide.statusLabel")}</Text>
          <View style={[styles.statusBadge, { backgroundColor: `${statusInfo.color}22` }]}>
            <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>
              {statusInfo.label}
            </Text>
          </View>
        </View>

        {passengerState !== "pending" && (
          <View style={[styles.cardRow, { marginTop: 12 }]}>
            <View style={styles.sectionIconBox}>
              <Text style={{ fontSize: 14 }}>📱</Text>
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

        {hasDriverLocation && boarded && (
          <View style={[styles.cardRow, { marginTop: 12 }]}>
            <View style={styles.sectionIconBox}>
              <Text style={{ fontSize: 14 }}>🚗</Text>
            </View>
            <Text style={styles.cardLabel}>{t("passengerRide.driverLabel")}</Text>
            <View style={styles.trackingBadge}>
              <Text style={styles.trackingBadgeText}>{t("passengerRide.liveTracking")}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Accepted but the driver hasn't started yet — show a reassuring waiting
          card instead of the (premature) scan button, plus a leave option. */}
      {passengerState === "accepted" && !boarded && (
        <>
          <View style={styles.waitingCard}>
            <Text style={styles.waitingTitle}>{t("passengerRide.driverConfirmedTitle")}</Text>
            <Text style={styles.waitingMsg}>{t("passengerRide.waitingForStartMsg")}</Text>
          </View>
          <TouchableOpacity
            style={[styles.dangerBtn, loading && styles.btnDisabled]}
            onPress={onLeave}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>{t("passengerRide.leave")}</Text>
          </TouchableOpacity>
        </>
      )}

      {passengerState === "started" && !boarded && (
        <TouchableOpacity onPress={onScan} style={styles.primaryBtn} activeOpacity={0.8}>
          <Text style={[{ fontSize: 16 }, { marginRight: 6 }]}>📱</Text>
          <Text style={styles.btnText}>{t("passengerRide.scanQrBtn")}</Text>
        </TouchableOpacity>
      )}

      {passengerState === "pending" && (
        <TouchableOpacity
          style={[styles.dangerBtn, loading && styles.btnDisabled]}
          onPress={onQuit}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.btnText}>{t("passengerRide.cancelRequest")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}, (prev, next) => (
  prev.passengerState === next.passengerState &&
  prev.boarded === next.boarded &&
  prev.loading === next.loading &&
  prev.hasDriverLocation === next.hasDriverLocation &&
  prev.bottomInset === next.bottomInset &&
  prev.driverName === next.driverName &&
  prev.driverAvatar === next.driverAvatar &&
  (prev.driverCerts ?? []).join(",") === (next.driverCerts ?? []).join(",") &&
  prev.onScan === next.onScan &&
  prev.onQuit === next.onQuit &&
  prev.onLeave === next.onLeave &&
  prev.onViewDriver === next.onViewDriver &&
  prev.t === next.t
));

export default function RideScreen() {
  const insets = useSafeAreaInsets();
  const { rideId, Originlat, OriginLng, DestinationLat, DestinationLng, pending } = useLocalSearchParams<RideParams>();
  const [originCoords, setOriginCoords] = useState<{ latitude: number; longitude: number }>({ latitude: 0, longitude: 0 });
  const [destinationCoords, setDestinationCoords] = useState<{ latitude: number; longitude: number }>({ latitude: 0, longitude: 0 });
  const [passengerState, setPassengerState] = useState<PassengerState>(pending === "true" ? "pending" : "accepted");
  const [loading, setLoading] = useState(false);
  const [boarded, setBoarded] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [pollingActive, setPollingActive] = useState(true);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | undefined>(undefined);
  const [showDriverModal, setShowDriverModal] = useState(false);
  const driverFetchedRef = useRef(false);

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

  // Poll ride document for state changes.
  //
  // Two distinct phases:
  //   • BEFORE boarded — watch for accept/reject/cancel/start.
  //   • AFTER boarded — ONLY watch for the driver dropping this passenger.
  //     We deliberately do not call any setState while boarded (no driver
  //     location updates, no status updates), so the screen stays frozen
  //     showing "Boarded / In ride" until the driver drops the passenger.
  useAdaptivePolling(
    async () => {
      try {
        const ride = await fetchRideById(rideId);
        if (!ride) {
          // Transient fetch failure — keep polling, do not navigate away.
          return true;
        }
        const uid = user?.uid ?? "";

        // Fetch full driver profile once on first successful ride fetch.
        if (!driverFetchedRef.current && ride.driverId) {
          driverFetchedRef.current = true;
          // Seed with embedded data immediately so the card shows right away.
          setDriverProfile({
            uid: ride.driverId,
            name: ride.driverName ?? "Driver",
            avatar: ride.driverAvatar ?? null,
            xp: 0, rating: 0, ridesCompleted: 0,
            certifications: [],
          });
          // Then fetch the full profile in the background.
          getAuth().currentUser?.getIdToken().then((token) =>
            fetchUserDocument(ride.driverId, token)
          ).then((doc) => {
            if (doc) setDriverProfile(extractDriverProfile(ride.driverId, doc));
          }).catch(() => {});
        }

        // Seed map coords from the ride doc when params were absent/zero (e.g. a
        // cold `driver_accepted` deep link that carries no coords — W-17).
        if (ride.localisation) {
          setOriginCoords((prev) => (prev.latitude === 0 && prev.longitude === 0
            ? { latitude: ride.localisation.latitude, longitude: ride.localisation.longitude }
            : prev));
        }
        if (ride.destinationCoords) {
          setDestinationCoords((prev) => (prev.latitude === 0 && prev.longitude === 0
            ? { latitude: ride.destinationCoords.latitude, longitude: ride.destinationCoords.longitude }
            : prev));
        }

        // Live driver tracking — plot the driver's last broadcast position (W-16).
        if (ride.driverLocation) {
          setDriverLocation((prev) => {
            const next = { latitude: ride.driverLocation!.latitude, longitude: ride.driverLocation!.longitude };
            return prev && prev.latitude === next.latitude && prev.longitude === next.longitude ? prev : next;
          });
        }

        // ── Frozen post-boarded path ─────────────────────────────────────────
        // Once boarded, the ONLY thing we care about is the driver dropping
        // this passenger. Anything else (driver position, ride status changes,
        // other passengers) is intentionally ignored to keep the UI stable.
        if (boarded) {
          if (ride.droppedPassengers?.includes(uid)) {
            const isConfirmed = ride.confirmedDropoffPassengers?.includes(uid) ?? false;
            const alreadyRated = ride.ratingsSubmitted?.includes(uid) ?? false;
            // Stop polling first — the ride is over for this passenger regardless
            // of the confirmed/unconfirmed path. clearActiveRide() is called now
            // so the home screen's syncRides doesn't re-push the ride screen.
            setPollingActive(false);
            clearActiveRide();
            hasNavigatedAwayRef.current = true;
            if (isConfirmed && !alreadyRated) {
              setPassengerState("completed");
            } else {
              Alert.alert(t("passengerRide.droppedOffTitle"), t("passengerRide.droppedOffMsg"));
              router.replace("/");
            }
            return false;
          }
          return true;
        }

        // ── Pre-boarded path ─────────────────────────────────────────────────
        if (ride.status === "cancelled") {
          if (!hasNavigatedAwayRef.current) {
            hasNavigatedAwayRef.current = true;
            setPollingActive(false);
            clearActiveRide();
            Alert.alert(t("passengerRide.rideCancelledTitle"), t("passengerRide.rideCancelledMsg"));
            router.push('/(tabs)');
          }
          return false;
        }

        // Sticky boarded check — once true, never regresses to false.
        const currentBoarded = ride.boardedPassengers?.includes(uid) ?? false;
        if (currentBoarded) {
          rideLog.transition("passenger", passengerState, "boarded", { rideId });
          setBoarded(true);
          setPassengerState("boarded");
          return true;
        }

        // Per-passenger dropoff edge case (e.g. dropped before boarding)
        if (ride.droppedPassengers?.includes(uid)) {
          const isConfirmed = ride.confirmedDropoffPassengers?.includes(uid) ?? false;
          const alreadyRated = ride.ratingsSubmitted?.includes(uid) ?? false;
          setPollingActive(false);
          clearActiveRide();
          hasNavigatedAwayRef.current = true;
          if (isConfirmed && !alreadyRated) {
            setPassengerState("completed");
          } else {
            Alert.alert(t("passengerRide.droppedOffTitle"), t("passengerRide.droppedOffMsg"));
            router.replace("/");
          }
          return false;
        }

        if (ride.status === "completed") {
          const needsRating = ride.pendingRatings?.includes(uid) &&
            !ride.ratingsSubmitted?.includes(uid);
          setPollingActive(false);
          clearActiveRide();
          hasNavigatedAwayRef.current = true;
          if (needsRating) {
            setPassengerState("completed");
          } else {
            router.replace("/");
          }
          return false;
        }

        if (passengerState === "pending") {
          if (ride.passengers.includes(uid)) {
            const next = ride.status === "started" ? "started" : "accepted";
            rideLog.transition("passenger", "pending", next, { rideId });
            setPassengerState(next);
            Alert.alert(t("passengerRide.requestAcceptedTitle"), t("passengerRide.requestAcceptedMsg"));
          }
          const myRequest = ride.joinRequests?.[uid];
          if (myRequest?.status === "rejected") {
            if (!hasNavigatedAwayRef.current) {
              hasNavigatedAwayRef.current = true;
              setPollingActive(false);
              clearActiveRide();
              Alert.alert(t("passengerRide.requestRejectedTitle"), t("passengerRide.requestRejectedMsg"));
              router.push('/(tabs)');
            }
            return false;
          }
          return true;
        }

        // accepted → started transition (still not boarded)
        if (passengerState === "accepted" && ride.status === "started") {
          rideLog.transition("passenger", "accepted", "started", { rideId });
          setPassengerState("started");
        }

        if (!ride.passengers.includes(uid) && !hasNavigatedAwayRef.current) {
          hasNavigatedAwayRef.current = true;
          setPollingActive(false);
          clearActiveRide();
          Alert.alert(t("passengerRide.removedTitle"), t("passengerRide.removedMsg"));
          router.push('/(tabs)');
          return false;
        }

        return true;
      } catch (error) {
        console.error("Error checking ride status:", error);
        return true;
      }
    },
    {
      enabled: Boolean(rideId && user?.uid) && pollingActive,
      // Fetch once immediately so a just-started ride flips the passenger into
      // live mode right away instead of showing "waiting" for the first interval.
      immediate: true,
      initialDelayMs: 8000,
      maxDelayMs: 30000,
      backoffFactor: 1.5,
    },
  );

  const quitRide = useCallback(async () => {
    if (!user) return;

    const passengerFee = formatCentsAsDollars(CANCELLATION_FEES.passengerCancelCents);

    // Only pending requests can be cancelled — once accepted, the passenger
    // is committed to the ride.
    Alert.alert(
      t("cancellation.passengerConfirmTitle"),
      t("cancellation.passengerFeeMsg", { fee: passengerFee }),
      [
        { text: t("common.no"), style: "cancel" },
        {
          text: t("cancellation.passengerConfirmBtn"),
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
  }, [user, t, rideId, clearActiveRide, router]);

  // Accepted-but-not-yet-boarded passengers can leave the ride (restores the
  // seat, notifies the driver). Once boarded/started this is disallowed server-side.
  const leaveRideHandler = useCallback(() => {
    Alert.alert(
      t("passengerRide.leaveRideTitle"),
      t("passengerRide.leaveRideMsg"),
      [
        { text: t("common.no"), style: "cancel" },
        {
          text: t("passengerRide.leave"),
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              await leaveRide(rideId);
              hasNavigatedAwayRef.current = true;
              setPollingActive(false);
              clearActiveRide();
              router.push('/(tabs)');
            } catch {
              Alert.alert(t("common.error"), t("passengerRide.failedLeaveRide"));
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }, [t, rideId, clearActiveRide, router]);

  const openScanner = useCallback(() => setShowScanner(true), []);

  const handleQrScan = useCallback(async (payload: string) => {
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
  }, [user, rideId, t]);

  const closeScanner = useCallback(() => setShowScanner(false), []);

  const handleRatingSubmitted = async (rating: number) => {
    if (!user) return;
    try {
      await submitRideRating(rideId, rating);
      hasNavigatedAwayRef.current = true;
      clearActiveRide();
      Alert.alert(t("ratings.thankYou"), t("ratings.thankYouMsg", { count: rating }), [
        { text: t("common.ok"), onPress: () => router.replace("/") },
      ]);
    } catch {
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

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Map base layer — full-bleed so it reaches the very top of the screen,
          with the glass header + panel floating over it. Driver location is
          intentionally not tracked to keep the screen stable. */}
      <View style={styles.mapContainer}>
        <UserRideMapView
          origin={originCoords}
          destination={destinationCoords}
          driverLocation={driverLocation}
        />
      </View>

      {/* Header — memoized so the per-second parent re-render doesn't repaint it */}
      <RideHeader
        passengerState={passengerState}
        boarded={boarded}
        rideIdShort={rideId?.slice(-6) ?? ""}
        topInset={insets.top}
        t={t}
      />

      {/* Bottom panel — memoized; props are stable so there is zero visible
          refresh from parent re-renders (e.g. the countdown tick). */}
      <BottomPanel
        passengerState={passengerState}
        boarded={boarded}
        loading={loading}
        hasDriverLocation={Boolean(driverLocation)}
        bottomInset={insets.bottom}
        driverName={driverProfile?.name}
        driverAvatar={driverProfile?.avatar}
        driverCerts={driverProfile?.certifications}
        onScan={openScanner}
        onQuit={quitRide}
        onLeave={leaveRideHandler}
        onViewDriver={() => setShowDriverModal(true)}
        t={t}
      />

      {/* QR Scanner Modal */}
      <Modal
        visible={showScanner}
        animationType="slide"
        onRequestClose={closeScanner}
      >
        <QrScanner
          onScanned={handleQrScan}
          onClose={closeScanner}
        />
      </Modal>

      {/* Driver Profile Modal — read-only */}
      <Modal
        visible={showDriverModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDriverModal(false)}
      >
        <TouchableOpacity
          style={styles.profileBackdrop}
          activeOpacity={1}
          onPress={() => setShowDriverModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.profileSheet}>
            {driverProfile ? (
              <>
                {/* Read-only badge */}
                <View style={styles.profileReadOnlyBadge}>
                  <Text style={{ fontSize: 12 }}>🔒</Text>
                  <Text style={styles.profileReadOnlyText}>{t("passengerRide.readOnly")}</Text>
                </View>

                <View style={styles.profileAvatarWrap}>
                  {driverProfile.avatar ? (
                    <ExpoImage source={{ uri: driverProfile.avatar }} style={styles.profileAvatar} contentFit="cover" cachePolicy="memory-disk" />
                  ) : (
                    <View style={[styles.profileAvatar, styles.profileAvatarFallback]}>
                      <Text style={{ fontSize: 32 }}>🚗</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.profileDriverName}>{driverProfile.name}</Text>

                <View style={{ alignItems: "center", marginTop: 8 }}>
                  <CertBadges certifications={driverProfile.certifications} size="full" />
                </View>

                <View style={styles.profileXpRow}>
                  <Text style={styles.profileXpText}>⚡ {driverProfile.xp} XP</Text>
                  {driverProfile.rating > 0 && (
                    <Text style={styles.profileRatingText}>⭐ {driverProfile.rating.toFixed(1)}</Text>
                  )}
                </View>

                <View style={styles.profileStatsRow}>
                  <View style={styles.profileStat}>
                    <Text style={styles.profileStatVal}>{driverProfile.ridesCompleted}</Text>
                    <Text style={styles.profileStatLabel}>{t("driverRide.profileRides")}</Text>
                  </View>
                </View>

                <View style={styles.profileInfoList}>
                  {driverProfile.school ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon}>🎓</Text>
                      <Text style={styles.profileInfoText}>{driverProfile.school}</Text>
                    </View>
                  ) : null}
                  {driverProfile.age ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon}>🎂</Text>
                      <Text style={styles.profileInfoText}>{t("driverRide.profileAge", { age: driverProfile.age })}</Text>
                    </View>
                  ) : null}
                  {driverProfile.instagramHandle ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon}>📷</Text>
                      <Text style={styles.profileInfoText}>@{driverProfile.instagramHandle}</Text>
                    </View>
                  ) : null}
                </View>

                <TouchableOpacity style={styles.profileCloseBtn} onPress={() => setShowDriverModal(false)}>
                  <Text style={styles.profileCloseBtnText}>{t("common.close")}</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.10)",
  },
  headerScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,8,18,0.86)" },
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
  mapContainer: { ...StyleSheet.absoluteFillObject },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    backgroundColor: "transparent",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
    padding: 16,
    gap: 10,
  },
  waitingCard: {
    backgroundColor: "rgba(52,211,153,0.10)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.30)",
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 6,
  },
  waitingTitle: {
    color: C.success,
    fontSize: 15,
    fontWeight: "800",
  },
  waitingMsg: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  // Frosted blur + dark scrim guarantee text contrast over any map content.
  panelGlass: { ...StyleSheet.absoluteFillObject },
  panelScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,8,18,0.78)" },
  card: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
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
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
  },
  primaryBtn: {
    backgroundColor: C.purple,
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: C.purple,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  btnText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // ── Driver card (read-only, passenger view) ──────────────────────────────
  driverCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(137,56,213,0.08)",
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.25)",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  driverAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  driverAvatarFallback: {
    backgroundColor: "rgba(137,56,213,0.15)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  driverName: {
    color: "#f3f4f6",
    fontSize: 15,
    fontWeight: "700" as const,
  },
  driverSub: {
    color: "#9ca3af",
    fontSize: 11,
    marginTop: 1,
  },

  // ── Driver profile modal ─────────────────────────────────────────────────
  profileBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  profileSheet: {
    width: "100%" as const,
    backgroundColor: "#13132a",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.3)",
    padding: 24,
    alignItems: "center" as const,
    gap: 12,
  },
  profileLoadingWrap: { paddingVertical: 40, alignItems: "center" as const },
  profileAvatarWrap: { marginBottom: 4 },
  profileAvatar: { width: 80, height: 80, borderRadius: 40 },
  profileAvatarFallback: {
    backgroundColor: "rgba(137,56,213,0.15)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  profileReadOnlyBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  profileReadOnlyText: { color: "#9ca3af", fontSize: 11, fontWeight: "500" as const },
  profileDriverName: { color: "#f3f4f6", fontSize: 18, fontWeight: "700" as const, textAlign: "center" as const },
  profileXpRow: { flexDirection: "row" as const, gap: 12, alignItems: "center" as const },
  profileXpText: { color: "#a78bfa", fontSize: 13, fontWeight: "600" as const },
  profileRatingText: { color: "#fbbf24", fontSize: 13, fontWeight: "600" as const },
  profileStatsRow: {
    flexDirection: "row" as const,
    gap: 20,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    width: "100%" as const,
    justifyContent: "center" as const,
  },
  profileStat: { alignItems: "center" as const, gap: 2 },
  profileStatVal: { color: "#f3f4f6", fontSize: 18, fontWeight: "700" as const },
  profileStatLabel: { color: "#9ca3af", fontSize: 11 },
  profileInfoList: { width: "100%" as const, gap: 8 },
  profileInfoRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  profileInfoIcon: { fontSize: 15 },
  profileInfoText: { color: "#d1d5db", fontSize: 13, fontWeight: "500" as const, flex: 1 },
  profileCloseBtn: {
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.4)",
    backgroundColor: "rgba(137,56,213,0.1)",
  },
  profileCloseBtnText: { color: "#a78bfa", fontSize: 14, fontWeight: "600" as const },
});
