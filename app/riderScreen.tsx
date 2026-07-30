/**
 * Driver Ride Screen
 * - Pre-start: see join requests, accept/reject, show passenger positions on map
 * - Post-start: broadcast live location, show QR for boarding, end ride
 */

//claude --resume "ride-flow-approval-tracking"

import CertBadges from "@/components/cert-badges";
import { DriverRideMapView } from "@/components/mapview";
import QrCodeDisplay from "@/components/QrCodeDisplay";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { generateQrToken, processRidePayments } from "@/services/paymentService";
import { CANCELLATION_FEES } from "@/constants/cancellation";
import { formatCentsAsDollars } from "@/constants/pricing";
import {
  cancelRideAsDriver,
  markPassengerDropped,
  respondToJoinRequest,
  startRideService,
  updateDriverLocation,
} from "@/services/rideServices";
import { fetchUserDocument } from "@/services/userService";
import { calculateAgeFromBirthDate } from "@/components/userHelper";
import type { JoinRequest } from "@/types/models";
import { useActiveRide } from "@/context/ActiveRideContext";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { BlurView } from "expo-blur";
import { useKeepAwake } from "expo-keep-awake";
import * as Location from "expo-location";
import { devAwareCurrentPosition, getDevLocationOverride } from "@/utils/dev-location";
import { DROPOFF_CONFIRM_RADIUS_KM } from "@/constants/ride-geo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import { Image as ExpoImage } from "expo-image";
import { ActivityIndicator, Alert, AppState, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getMultiWaypointRoute } from "@/services/routeService";
import { devLog, devWarn } from "@/constants/runtime-config";
import { rideLog } from "@/utils/ride-logger";
import { maybeShowGmapsHint } from "@/utils/gmapsHint";
import { rideErrorMessage } from "@/utils/rideErrors";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  bg: "#080810", surface: "#0f0f1e", surfaceAlt: "#13132a",
  purple: "#8938D5", purpleLight: "#e09af7", blue: "#FD165A",
  text: "#f3f4f6", muted: "#9ca3af", dim: "#4b5563",
  danger: "#ef4444", gold: "#fbbf24", success: "#34d399",
  border: "rgba(137, 56, 213, 0.22)", borderFaint: "rgba(255, 255, 255, 0.06)",
};

type RideParams = {
  rideId: string;
  maxSeat: string;
  Originlat: string;
  OriginLng: string;
  DestinationLat: string;
  DestinationLng: string;
  Destination: string;
  /** "true" when launched already-started from the driver waiting screen. */
  started: string;
  /** "true" only on the fresh inbox hand-off — triggers the one-time Google
   *  Maps launch. Absent on banner re-entry so reopening the app doesn't
   *  hijack the driver back into Maps. */
  autostart: string;
};

const toSafeNumber = (value: string, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

type PassengerProfile = {
  uid: string;
  name: string;
  email: string;
  xp: number;
  rating: number;
  avatar: string | null;
  ridesCompleted: number;
  school?: string;
  age?: number;
  instagramHandle?: string;
  certifications: string[];
};

function extractPassengerProfile(uid: string, doc: { fields?: Record<string, unknown> }): PassengerProfile {
  const fields = doc?.fields ?? {};
  const str = (key: string): string => {
    const v = fields[key] as Record<string, unknown> | undefined;
    return typeof v?.stringValue === "string" ? v.stringValue : "";
  };
  const num = (key: string): number => {
    const v = fields[key] as Record<string, unknown> | undefined;
    return Number(v?.integerValue ?? v?.doubleValue ?? 0);
  };
  const strArr = (key: string): string[] => {
    const v = fields[key] as Record<string, unknown> | undefined;
    const values = (v?.arrayValue as Record<string, unknown> | undefined)?.values;
    if (!Array.isArray(values)) return [];
    return values
      .map((e) => (e as Record<string, unknown>)?.stringValue)
      .filter((s): s is string => typeof s === "string");
  };
  const email = str("email");
  const name = str("name") || email.split("@")[0] || "Unknown";
  const birthDate = str("birthDate");
  const storedAge = num("age");
  const age = birthDate ? calculateAgeFromBirthDate(birthDate) : (storedAge > 0 ? storedAge : undefined);
  const school = str("school");
  const instagramHandle = str("instagramHandle");
  return {
    uid,
    name,
    email,
    xp: num("xp"),
    rating: num("rating"),
    avatar: str("avatar") || null,
    ridesCompleted: num("ridesCompleted"),
    school: school || undefined,
    age: typeof age === "number" && age > 0 ? age : undefined,
    instagramHandle: instagramHandle || undefined,
    certifications: strArr("certifications"),
  };
}

export default function RideModeDriver() {
  useKeepAwake();
  const router = useRouter();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { setActiveRide, clearActiveRide } = useActiveRide();
  const { rideId, Originlat, OriginLng, DestinationLat, DestinationLng, Destination, started, autostart } = useLocalSearchParams<RideParams>();
  const startedFromInbox = started === "true";
  // Only the genuine inbox hand-off carries autostart — banner re-entry doesn't,
  // so reopening the app mid-ride won't relaunch Google Maps unprompted.
  const autoLaunchMaps = autostart === "true";

  const [passengers, setPassengers] = useState<string[]>([]);
  const [joinRequests, setJoinRequests] = useState<Record<string, JoinRequest>>({});
  const [rideStarted, setRideStarted] = useState(startedFromInbox);
  const [loading, setLoading] = useState(false);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number>(0);
  const [showQrModal, setShowQrModal] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [passengerPickups, setPassengerPickups] = useState<Record<string, { latitude: number; longitude: number }>>({});
  const [passengerDropoffs, setPassengerDropoffs] = useState<Record<string, { latitude: number; longitude: number }>>({});
  const [droppedPassengers, setDroppedPassengers] = useState<string[]>([]);
  // Legs the server measured as in-range at dropoff — the only ones that bill.
  // Server-owned and unwritable by the client; mirrored here so the driver can
  // see which legs will pay before ending the ride.
  const [confirmedDropoffs, setConfirmedDropoffs] = useState<string[]>([]);
  const [allPassengersDropped, setAllPassengersDropped] = useState(false);
  const [boardedPassengers, setBoardedPassengers] = useState<string[]>([]);
  // Passengers who accepted but haven't yet swiped to confirm this driver. The
  // ride cannot start until this is empty (mutual match gate).
  const [pendingConfirmation, setPendingConfirmation] = useState<string[]>([]);
  const [frozenPolyline, setFrozenPolyline] = useState<string | undefined>(undefined);
const [profileModal, setProfileModal] = useState<PassengerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [passengerProfiles, setPassengerProfiles] = useState<Record<string, PassengerProfile>>({});

  const locationSubRef = useRef<Location.LocationSubscription | null>(null);

  const originCoords = {
    latitude: toSafeNumber(Originlat),
    longitude: toSafeNumber(OriginLng),
  };
  const destCoords = {
    latitude: toSafeNumber(DestinationLat),
    longitude: toSafeNumber(DestinationLng),
  };

  const openPassengerProfile = async (uid: string) => {
    if (passengerProfiles[uid]) {
      setProfileModal(passengerProfiles[uid]);
      return;
    }
    setProfileLoading(true);
    const token = await user?.getIdToken().catch(() => undefined);
    const doc = await fetchUserDocument(uid, token);
    setProfileLoading(false);
    if (doc) {
      const profile = extractPassengerProfile(uid, doc);
      setPassengerProfiles((prev) => ({ ...prev, [uid]: profile }));
      setProfileModal(profile);
    } else {
      Alert.alert(t("common.error"), t("driverRide.profileLoadError"));
    }
  };

  // Persist active ride so the user can return from Google Maps / other apps.
  // `started` is included so re-entry (e.g. after the app is killed) restores
  // the in-progress panel immediately instead of flashing the pre-start UI.
  useEffect(() => {
    if (rideId) {
      setActiveRide({
        rideId,
        role: "driver",
        params: {
          rideId, Originlat, OriginLng, DestinationLat, DestinationLng,
          Destination: Destination ?? "",
          started: rideStarted ? "true" : "false",
        },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, rideStarted]);

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
        // Refresh QR if it's about to expire or already expired.
        // qrExpiresAt is in milliseconds (Date.now()-based), so compare in ms.
        if (Date.now() > qrExpiresAt - 30_000) {
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

  // Live listener for ride state: join requests, passengers, boarded status
  const passengerCountRef = useRef(0);
  const pendingRequestCountRef = useRef(0);
  useEffect(() => {
    if (!rideId) return;
    const unsubscribe = onSnapshot(
      doc(db, "rides", rideId),
      (snapshot) => {
        devLog("[RIDE-DEBUG] ride snapshot", { rideId, exists: snapshot.exists() });
        if (!snapshot.exists()) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = snapshot.data() as Record<string, any>;
        devLog("[RIDE-DEBUG] raw ride data", {
          passengers: data.passengers,
          passengerPickups: data.passengerPickups,
          passengerDropoffs: data.passengerDropoffs,
          status: data.status,
        });

        // Parse join requests from SDK plain-object map (no REST type wrappers)
        const rawJR = data.joinRequests as Record<string, Record<string, unknown>> | undefined;
        const nextJR: Record<string, JoinRequest> = {};
        if (rawJR) {
          for (const [pid, jr] of Object.entries(rawJR)) {
            const loc = jr.location as { latitude?: number; longitude?: number } | undefined;
            const drop = jr.dropoff as { latitude?: number; longitude?: number } | undefined;
            nextJR[pid] = {
              passengerId: pid,
              status: jr.status as JoinRequest["status"],
              location: { latitude: loc?.latitude ?? 0, longitude: loc?.longitude ?? 0 },
              requestedAt: (jr.requestedAt as string) ?? "",
              dropoff: drop ? { latitude: drop.latitude ?? 0, longitude: drop.longitude ?? 0 } : undefined,
            };
          }
        }

        // Detect new pending join requests
        const newPendingCount = Object.values(nextJR).filter((r) => r.status === "pending").length;
        if (newPendingCount > pendingRequestCountRef.current) {
          Alert.alert(t("driverRide.newJoinRequestTitle"), t("driverRide.newJoinRequestMsg"));
        }
        pendingRequestCountRef.current = newPendingCount;
        setJoinRequests(nextJR);

        // Update passengers
        const nextPassengers: string[] = Array.isArray(data.passengers) ? data.passengers : [];
        if (nextPassengers.length > passengerCountRef.current) {
          Alert.alert(t("driverRide.passengerAcceptedTitle"), t("driverRide.passengerAcceptedDetail"));
        }
        passengerCountRef.current = nextPassengers.length;
        setPassengers((prev) => {
          const prevKey = prev.join(",");
          const nextKey = nextPassengers.join(",");
          return prevKey === nextKey ? prev : nextPassengers;
        });

        // Update passenger pickups — only replace reference when content changed
        const rawPickups = data.passengerPickups as Record<string, { latitude?: number; longitude?: number }> | undefined;
        if (rawPickups) {
          const nextPickups: Record<string, { latitude: number; longitude: number }> = {};
          for (const [uid, loc] of Object.entries(rawPickups)) {
            nextPickups[uid] = { latitude: loc?.latitude ?? 0, longitude: loc?.longitude ?? 0 };
          }
          devLog("[RIDE-DEBUG] parsed pickups", nextPickups);
          setPassengerPickups((prev) => {
            const prevStr = JSON.stringify(prev);
            const nextStr = JSON.stringify(nextPickups);
            return prevStr === nextStr ? prev : nextPickups;
          });
        }

        // Update passenger dropoffs — same stabilization
        const rawDropoffs = data.passengerDropoffs as Record<string, { latitude?: number; longitude?: number }> | undefined;
        if (rawDropoffs) {
          const nextDropoffs: Record<string, { latitude: number; longitude: number }> = {};
          for (const [uid, loc] of Object.entries(rawDropoffs)) {
            nextDropoffs[uid] = { latitude: loc?.latitude ?? 0, longitude: loc?.longitude ?? 0 };
          }
          devLog("[RIDE-DEBUG] parsed dropoffs", nextDropoffs);
          setPassengerDropoffs((prev) => {
            const prevStr = JSON.stringify(prev);
            const nextStr = JSON.stringify(nextDropoffs);
            return prevStr === nextStr ? prev : nextDropoffs;
          });
        }

        // Update boarded passengers
        const nextBoarded: string[] = Array.isArray(data.boardedPassengers) ? data.boardedPassengers : [];
        setBoardedPassengers((prev) => {
          const prevKey = prev.join(",");
          const nextKey = nextBoarded.join(",");
          return prevKey === nextKey ? prev : nextBoarded;
        });

        // Mutual-match gate: passengers who still need to swipe-confirm this driver.
        const nextPending: string[] = Array.isArray(data.pendingConfirmation) ? data.pendingConfirmation : [];
        setPendingConfirmation((prev) => (prev.join(",") === nextPending.join(",") ? prev : nextPending));

        // Dropped / confirmed — server-owned now; mirror into local state so the
        // completion gate and per-passenger badges reflect the authoritative doc.
        const nextDropped: string[] = Array.isArray(data.droppedPassengers) ? data.droppedPassengers : [];
        setDroppedPassengers((prev) => (prev.join(",") === nextDropped.join(",") ? prev : nextDropped));
        const nextConfirmed: string[] = Array.isArray(data.confirmedDropoffPassengers)
          ? data.confirmedDropoffPassengers
          : [];
        setConfirmedDropoffs((prev) => (prev.join(",") === nextConfirmed.join(",") ? prev : nextConfirmed));
        // Every accepted passenger resolved (dropped or no-show) ⇒ ride can end.
        if (nextPassengers.length > 0 && nextPassengers.every((p) => nextDropped.includes(p))) {
          setAllPassengersDropped(true);
        }

        // setRideStarted(true) is idempotent — React bails out if value unchanged
        if (data.status === "started") {
          setRideStarted(true);
        }
        rideLog.info("driver", `ride snapshot ${rideId}`, {
          status: data.status,
          paymentStatus: data.paymentStatus,
          passengers: nextPassengers.length,
          boarded: Array.isArray(data.boardedPassengers) ? data.boardedPassengers.length : 0,
          dropped: nextDropped.length,
        });
      },
      (error) => devWarn("[RIDE-DEBUG] ride listener error", error),
    );
    return () => unsubscribe();
  }, [rideId, t]);

  // Pre-fetch passenger profiles whenever the passenger/request lists change
  useEffect(() => {
    const uids = [
      ...passengers,
      ...Object.values(joinRequests).map((r) => r.passengerId),
    ].filter((uid) => uid && !passengerProfiles[uid]);

    if (uids.length === 0) return;

    user?.getIdToken().then((token) => {
      uids.forEach((uid) => {
        fetchUserDocument(uid, token).then((doc) => {
          if (doc) {
            setPassengerProfiles((prev) => ({
              ...prev,
              [uid]: extractPassengerProfile(uid, doc),
            }));
          }
        });
      });
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passengers, joinRequests]);

  // Get pending join requests
  const pendingRequests = Object.values(joinRequests).filter((r) => r.status === "pending");
  // Exclude {0,0} fallbacks — those are passengers whose GPS failed and should not
  // show up as a marker near the equator on the driver's map.
  const pendingLocations = pendingRequests
    .filter((r) => r.location.latitude !== 0 || r.location.longitude !== 0)
    .map((r) => ({
      latitude: r.location.latitude,
      longitude: r.location.longitude,
      passengerId: r.passengerId,
      avatarUri: passengerProfiles[r.passengerId]?.avatar ?? null,
      dropoff: r.dropoff ? { latitude: r.dropoff.latitude, longitude: r.dropoff.longitude } : undefined,
    }));

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
    const driverFee = formatCentsAsDollars(CANCELLATION_FEES.driverCancelCents);
    Alert.alert(
      t("cancellation.driverConfirmTitle"),
      t("cancellation.driverFeeMsg", { fee: driverFee }),
      [
        { text: t("cancellation.keepRide"), style: "cancel" },
        {
          text: t("cancellation.driverConfirmBtn"),
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              await cancelRideAsDriver(rideId);
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

  // Idempotent: a subscription already running (or one mid-setup) is a no-op,
  // so this can be safely called from ride-start, the resume effect, and the
  // inbox hand-off without ever opening two location watchers.
  const broadcastStartingRef = useRef(false);
  const startLocationBroadcast = async () => {
    if (locationSubRef.current || broadcastStartingRef.current) return;
    broadcastStartingRef.current = true;
    try {
      // Dev GPS override: broadcast a single fixed position and skip the real
      // watcher entirely so the driver location is deterministic in testing.
      const devCoords = getDevLocationOverride();
      if (devCoords) {
        void updateDriverLocation(rideId, devCoords).catch(() => {});
        return;
      }

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
          // Never let a rejected write escape the watcher callback.
          void updateDriverLocation(rideId, {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          }).catch(() => {});
        },
      );
    } finally {
      broadcastStartingRef.current = false;
    }
  };

  // Build the ordered route coords for Google Maps:
  // origin → non-dropped pickups → non-dropped dropoffs → [destination].
  // Passing `includeDropped = true` keeps all passengers (used at ride start
  // before anyone has been dropped).
  //
  // The driver's own destination is only appended when at least one active
  // passenger has NO explicit dropoff — those passengers ride all the way to
  // the ride destination, so it is a real stop. When every active passenger has
  // their own dropoff, the navigation ends at the last dropoff: the driver's
  // destination is where they happen to be heading afterwards (often home), not
  // part of the ride, and routing them there made Google Maps keep navigating
  // after the final drop-off.
  const buildRouteCoords = (includeDropped = false): { latitude: number; longitude: number }[] => {
    const activePassengers = includeDropped
      ? passengers
      : passengers.filter((uid) => !droppedPassengers.includes(uid));
    const pickups = activePassengers
      .map((uid) => passengerPickups[uid])
      .filter((l): l is { latitude: number; longitude: number } => !!l);
    const dropoffs = activePassengers
      .map((uid) => passengerDropoffs[uid])
      .filter((l): l is { latitude: number; longitude: number } => !!l);
    const ridesToDestination = activePassengers.some((uid) => !passengerDropoffs[uid]);
    const destIsReal = destCoords.latitude !== 0 || destCoords.longitude !== 0;
    const coords = [
      originCoords,
      ...pickups,
      ...dropoffs,
      ...(ridesToDestination && destIsReal ? [destCoords] : []),
    ];
    devLog("[RIDE-DEBUG] buildRouteCoords", {
      activePassengers: activePassengers.length,
      pickups: pickups.length,
      dropoffs: dropoffs.length,
      ridesToDestination,
      totalCoords: coords.length,
    });
    return coords;
  };

  const openGoogleMaps = async (coords: { latitude: number; longitude: number }[]) => {
    // Fewer than two points means there is nothing left to navigate to (every
    // passenger has been dropped off). Never fall back to the driver's own
    // destination here — the ride is over.
    if (coords.length < 2) return;

    // Web URL: google.com/maps/dir/LAT,LNG/LAT,LNG/... supports arbitrary stops
    const path = coords.map(c => `${c.latitude},${c.longitude}`).join('/');
    const webUrl = `https://www.google.com/maps/dir/${path}`;

    const dest = coords[coords.length - 1];
    const intermediates = coords.slice(1, -1); // everything between origin and destination

    let nativeUrl: string;
    if (Platform.OS === "ios") {
      if (intermediates.length === 0) {
        // Single-stop: simple daddr
        nativeUrl = `comgooglemaps://?daddr=${dest.latitude},${dest.longitude}&directionsmode=driving`;
      } else {
        // Multi-stop: chain all stops using +to: syntax, then final destination
        // comgooglemaps://?daddr=WP1+to:WP2+to:DEST&directionsmode=driving
        const stops = [...intermediates, dest]
          .map(c => `${c.latitude},${c.longitude}`)
          .join('+to:');
        nativeUrl = `comgooglemaps://?daddr=${stops}&directionsmode=driving`;
      }
    } else {
      // Android google.navigation doesn't support multi-stop; fall back to web URL
      nativeUrl = intermediates.length === 0
        ? `google.navigation:q=${dest.latitude},${dest.longitude}`
        : webUrl;
    }

    try {
      const canOpenNative = await Linking.canOpenURL(nativeUrl);
      if (canOpenNative) {
        await Linking.openURL(nativeUrl);
        return;
      }
    } catch {
      // fall through to web
    }

    await maybeShowGmapsHint(t);
    await Linking.openURL(webUrl);
  };

  const startRideManually = async () => {
    if (passengers.length === 0) {
      Alert.alert(t("driverRide.noPassengersTitle"), t("driverRide.noPassengersMsg"));
      return;
    }
    // Mutual-match gate — the server also enforces this (428); guard here so the
    // driver gets an immediate, clear message instead of a round-trip error.
    if (pendingConfirmation.length > 0) {
      Alert.alert(t("driverRide.startRide"), t("railguards.passengersNotConfirmed"));
      return;
    }

    setLoading(true);
    try {
      await startRideService(rideId);
      setRideStarted(true);

      // Compute and freeze the polyline once at ride start (all accepted pickups + dropoffs).
      const routeResult = await getMultiWaypointRoute(buildRouteCoords(true));
      if (routeResult?.overviewPolyline) setFrozenPolyline(routeResult.overviewPolyline);

      // Start broadcasting location
      await startLocationBroadcast();

      // Open Google Maps with all passenger pickups and dropoffs
      await openGoogleMaps(buildRouteCoords(true));
      Alert.alert(t("driverRide.rideStartedTitle"), t("driverRide.rideStartedMsg"));
    } catch (e: any) {
      Alert.alert(t("common.error"), rideErrorMessage(e, t));
    } finally {
      setLoading(false);
    }
  };

  const finalizeRide = async () => {
    setLoading(true);
    setPaymentProcessing(true);
    try {
      // /rides/finish atomically charges boarded∧dropped passengers, credits the
      // driver, and marks the ride completed. Failure is surfaced (no silent loss)
      // and the ride is NOT left half-completed — the driver can retry.
      await processRidePayments(rideId);

      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }

      clearActiveRide();
      // Mirrors the server's chargeablePassengers(): a leg only bills if it was
      // boarded, dropped, AND measured in range of the destination. Checking only
      // boarded∩dropped here told the driver they'd been paid for out-of-range
      // dropoffs that the server had correctly refused to charge.
      const anyCharged = passengers.some(
        (p) =>
          boardedPassengers.includes(p) &&
          droppedPassengers.includes(p) &&
          confirmedDropoffs.includes(p),
      );
      Alert.alert(
        t("driverRide.rideEndedTitle"),
        anyCharged ? t("driverRide.rideEndedMsg") : t("driverRide.rideEndedNoPassengersMsg"),
      );
      router.replace("/");
    } catch (e) {
      Alert.alert(t("common.error"), rideErrorMessage(e, t));
    } finally {
      setPaymentProcessing(false);
      setLoading(false);
    }
  };

  // Optimistically mark a passenger resolved locally; the onSnapshot listener
  // reconciles against the server-authoritative droppedPassengers set.
  const applyLocalDropped = (pid: string) => {
    const newDropped = droppedPassengers.includes(pid) ? droppedPassengers : [...droppedPassengers, pid];
    setDroppedPassengers(newDropped);
    if (passengers.length > 0 && passengers.every((p) => newDropped.includes(p))) {
      setAllPassengersDropped(true);
      Alert.alert(t("driverRide.allDroppedTitle"), t("driverRide.allDroppedMsg"));
    }
  };

  /** A fresh fix for the dropoff radius check, or null if we can't get one in
   *  time. Bounded so a slow/absent GPS lock can't hang the Drop off button.
   *  devAwareCurrentPosition honours the Dev Ride Panel's GPS override. */
  const getDropoffFix = async (): Promise<{ latitude: number; longitude: number } | null> => {
    try {
      const pos = await Promise.race([
        devAwareCurrentPosition({ accuracy: Location.Accuracy.High }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (!pos) return null;
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch (e) {
      devWarn("dropoff: could not read current position", e);
      return null;
    }
  };

  /** Send the dropoff and report the server's billing decision back to the
   *  driver. The outcome used to be silently discarded, so a driver only found
   *  out a leg was unpaid at the end of the ride — if at all. */
  const submitDropoff = async (
    pid: string,
    fix: { latitude: number; longitude: number } | null,
  ) => {
    let result;
    try {
      result = await markPassengerDropped(rideId, pid, { driverLocation: fix });
    } catch (e) {
      Alert.alert(t("common.error"), rideErrorMessage(e, t));
      return;
    }
    applyLocalDropped(pid);

    if (result.confirmed) {
      Alert.alert(t("driverRide.dropoffPaidTitle"), t("driverRide.dropoffPaidMsg"));
      return;
    }
    Alert.alert(
      t("driverRide.dropoffNotPaidTitle"),
      result.distanceKm != null
        ? t("driverRide.dropoffNotPaidMsg", {
            dist: `${result.distanceKm.toFixed(1)} km`,
            km: result.radiusKm ?? DROPOFF_CONFIRM_RADIUS_KM,
          })
        : t("driverRide.dropoffNotPaidNoLocationMsg"),
    );
  };

  const dropOffPassenger = async (pid: string) => {
    if (!boardedPassengers.includes(pid)) {
      Alert.alert(t("driverRide.dropoffNotBoardedTitle"), t("driverRide.dropoffNotBoardedMsg"));
      return;
    }
    // The server decides whether this leg is billable, by measuring the fix below
    // against the passenger's destination. The client only reports where we are.
    Alert.alert(t("driverRide.dropoffTitle"), t("driverRide.dropoffConfirmGenericMsg"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        onPress: async () => {
          const fix = await getDropoffFix();
          if (!fix) {
            // Without a fix the leg cannot be confirmed and so cannot be charged.
            // Say so up front rather than letting the driver discover it later.
            Alert.alert(t("driverRide.dropoffTitle"), t("driverRide.dropoffNoLocationMsg"), [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("driverRide.dropoffAnywayUnpaid"),
                style: "destructive",
                onPress: () => void submitDropoff(pid, null),
              },
            ]);
            return;
          }
          await submitDropoff(pid, fix);
        },
      },
    ]);
  };

  // Resolve a passenger who never boarded (no-show): excluded from charge/rating
  // server-side, but still counts toward "all passengers resolved" so the driver
  // can end the ride (fixes the softlock).
  const markNoShow = async (pid: string) => {
    Alert.alert(t("driverRide.noShowTitle"), t("driverRide.noShowMsg"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("driverRide.noShowConfirm"),
        style: "destructive",
        onPress: async () => {
          try {
            await markPassengerDropped(rideId, pid, { noShow: true });
          } catch (e) {
            Alert.alert(t("common.error"), rideErrorMessage(e, t));
            return;
          }
          applyLocalDropped(pid);
        },
      },
    ]);
  };


  // Side-effects for an in-progress ride. The frozen polyline + Google Maps
  // hand-off (below) wait until the passenger list has loaded from the first
  // poll and only auto-fire on the genuine inbox hand-off.
  const startedSideEffectsRef = useRef(false);
  // Keep the live-location broadcast running whenever the ride is in progress.
  // This fires on the inbox hand-off (rideStarted starts true), on manual start,
  // and — crucially — when the driver re-opens the app mid-ride and polling
  // flips rideStarted back to true. startLocationBroadcast() is idempotent.
  useEffect(() => {
    if (rideStarted && rideId) void startLocationBroadcast();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideStarted, rideId]);
  useEffect(() => {
    if (!autoLaunchMaps || startedSideEffectsRef.current || passengers.length === 0) return;
    // Wait until every accepted passenger has a pickup coord in state before
    // launching Google Maps. Without this guard the effect can fire in the
    // render where `passengers` first becomes non-empty but `passengerPickups`
    // hasn't been committed yet (state batching timing), which causes Google
    // Maps to open with only origin→destination and no passenger stops.
    const allPickupsReady = passengers.every((uid) => passengerPickups[uid]);
    if (!allPickupsReady) return;
    startedSideEffectsRef.current = true;
    (async () => {
      try {
        const routeResult = await getMultiWaypointRoute(buildRouteCoords(true));
        if (routeResult?.overviewPolyline) setFrozenPolyline(routeResult.overviewPolyline);
        await openGoogleMaps(buildRouteCoords(true));
      } catch { /* non-fatal — driver can reopen maps manually */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLaunchMaps, passengers, passengerPickups]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Header — dark glass (frosted blur + scrim), no gradient */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <BlurView intensity={40} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.headerScrim} pointerEvents="none" />
        <View style={styles.headerTopRow}>
          <View style={styles.headerLeft}>
            <View style={styles.liveDot} />
            <Text style={styles.headerTitle}>{t("driverRide.headerTitle")}</Text>
          </View>
          <View style={styles.modeBadge}>
            <Text style={{fontSize: 12}}>🚗</Text>
            <Text style={styles.modeBadgeText}>{rideStarted ? t("driverRide.inProgress") : t("driverRide.waiting")}</Text>
          </View>
        </View>
        <View style={styles.headerBottomRow}>
          <Text style={styles.headerDestination} numberOfLines={1}>
            {Destination ? decodeURIComponent(Destination) : `${DestinationLat}, ${DestinationLng}`}
          </Text>
          <View style={styles.headerPaxPill}>
            <Text style={{fontSize: 11}}>👥</Text>
            <Text style={styles.headerPaxText}>
              {passengers.length} {t("driverRide.acceptedCount")}
            </Text>
          </View>
        </View>
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <DriverRideMapView
          origin={originCoords}
          destination={destCoords}
          passengers={passengers}
          pendingLocations={pendingLocations}
          passengerPickups={passengerPickups}
          passengerDropoffs={passengerDropoffs}
          frozenPolyline={frozenPolyline}
        />
      </View>

      {!rideStarted ? (
        /* ── Pre-Start Panel ── */
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <BlurView intensity={55} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.panelGlass} pointerEvents="none" />
          <View style={styles.panelScrim} pointerEvents="none" />
          {/* Pending Join Requests */}
          {pendingRequests.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t("driverRide.joinRequests")}</Text>
              <ScrollView style={styles.passengerList} nestedScrollEnabled>
                {pendingRequests.map((req) => (
                  <View key={req.passengerId} style={styles.requestCard}>
                    <TouchableOpacity
                      style={styles.avatarPlaceholder}
                      onPress={() => openPassengerProfile(req.passengerId)}
                      activeOpacity={0.7}
                    >
                      {passengerProfiles[req.passengerId]?.avatar ? (
                        <ExpoImage
                          source={{ uri: passengerProfiles[req.passengerId].avatar! }}
                          style={styles.avatarThumb}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                        />
                      ) : (
                        <Text style={{fontSize: 16}}>🙋</Text>
                      )}
                    </TouchableOpacity>
                    <View style={styles.passengerInfo}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.passengerIdText} numberOfLines={1}>
                          {passengerProfiles[req.passengerId]?.name ?? req.passengerId.slice(0, 12) + "..."}
                        </Text>
                        <CertBadges certifications={passengerProfiles[req.passengerId]?.certifications} size="compact" hideWhenEmpty />
                      </View>
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
                    <TouchableOpacity
                      style={styles.avatarPlaceholder}
                      onPress={() => openPassengerProfile(pid)}
                      activeOpacity={0.7}
                    >
                      {passengerProfiles[pid]?.avatar ? (
                        <ExpoImage
                          source={{ uri: passengerProfiles[pid].avatar! }}
                          style={styles.avatarThumb}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                        />
                      ) : (
                        <Text style={{fontSize: 16}}>👤</Text>
                      )}
                    </TouchableOpacity>
                    <View style={styles.passengerInfo}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.passengerIdText} numberOfLines={1}>
                          {passengerProfiles[pid]?.name ?? pid.slice(0, 12) + "..."}
                        </Text>
                        <CertBadges certifications={passengerProfiles[pid]?.certifications} size="compact" hideWhenEmpty />
                      </View>
                      <Text style={styles.passengerSubtext}>{t("driverRide.accepted")}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </>
          ) : pendingRequests.length === 0 ? (
            <Text style={styles.waitingText}>{t("driverRide.waitingForPassengers")}</Text>
          ) : null}

          {/* Show Boarding QR */}
          {qrToken && (
            <TouchableOpacity
              onPress={() => setShowQrModal(true)}
              activeOpacity={0.8}
              style={styles.primaryBtn}
            >
              <Text style={[{fontSize: 16}, { marginRight: 6 }]}>📱</Text>
              <Text style={styles.btnText}>{t("driverRide.showBoardingQr")}</Text>
            </TouchableOpacity>
          )}

          {/* Start Ride — blocked until every dispatched passenger has swiped to
              confirm this driver (mutual match). */}
          {pendingConfirmation.length > 0 ? (
            <View style={[styles.primaryBtn, styles.btnDisabled, styles.waitingConfirmChip]}>
              <ActivityIndicator size="small" color="#e09af7" style={{ marginRight: 8 }} />
              <Text style={styles.waitingConfirmText}>{t("driverRide.waitingForRiderConfirm")}</Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={startRideManually}
              disabled={loading || passengers.length === 0}
              activeOpacity={0.8}
              style={[styles.primaryBtn, (loading || passengers.length === 0) && styles.btnDisabled]}
            >
              <Text style={[{fontSize: 16}, { marginRight: 6 }]}>🧭</Text>
              <Text style={styles.btnText}>{t("driverRide.startRide")}</Text>
            </TouchableOpacity>
          )}

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
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
          <BlurView intensity={55} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.panelGlass} pointerEvents="none" />
          <View style={styles.panelScrim} pointerEvents="none" />
          <View style={styles.infoCard}>
            <Text style={[styles.infoLabel, { color: C.success }]}>{t("driverRide.rideInProgress")}</Text>
            <Text style={styles.waitingText}>{t("driverRide.locationShared")}</Text>
          </View>

          {/* Passenger drop-off list */}
          {passengers.length > 0 && (
            <ScrollView style={styles.passengerList} nestedScrollEnabled>
              {passengers.map((pid) => {
                const isDropped = droppedPassengers.includes(pid);
                const isBoarded = boardedPassengers.includes(pid);
                // Dropped but out of range of their destination ⇒ this leg pays
                // nothing. Surface it now, not after the ride is over.
                const isUnpaidLeg = isDropped && isBoarded && !confirmedDropoffs.includes(pid);
                return (
                  <View key={pid} style={styles.passengerCard}>
                    <TouchableOpacity
                      style={styles.avatarPlaceholder}
                      onPress={() => openPassengerProfile(pid)}
                      activeOpacity={0.7}
                    >
                      {passengerProfiles[pid]?.avatar ? (
                        <ExpoImage
                          source={{ uri: passengerProfiles[pid].avatar! }}
                          style={styles.avatarThumb}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                        />
                      ) : (
                        <Text style={{fontSize: 16}}>👤</Text>
                      )}
                    </TouchableOpacity>
                    <View style={styles.passengerInfo}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.passengerIdText} numberOfLines={1}>
                          {passengerProfiles[pid]?.name ?? pid.slice(0, 12) + "..."}
                        </Text>
                        <CertBadges certifications={passengerProfiles[pid]?.certifications} size="compact" hideWhenEmpty />
                      </View>
                      <Text style={styles.passengerSubtext}>
                        {isDropped
                          ? t("driverRide.droppedOff")
                          : isBoarded
                            ? t("driverRide.inRide")
                            : t("driverRide.notBoardedYet")}
                      </Text>
                    </View>
                    {isDropped ? (
                      <View style={isUnpaidLeg ? styles.unpaidBadge : styles.droppedBadge}>
                        <Text style={isUnpaidLeg ? styles.unpaidBadgeText : styles.droppedBadgeText}>
                          {isUnpaidLeg ? t("driverRide.unpaidLeg") : t("driverRide.droppedOff")}
                        </Text>
                      </View>
                    ) : isBoarded ? (
                      <TouchableOpacity
                        style={[
                          styles.dropoffBtn,
                          (loading || paymentProcessing) && styles.btnDisabled,
                        ]}
                        onPress={() => dropOffPassenger(pid)}
                        disabled={loading || paymentProcessing}
                      >
                        <Text style={styles.dropoffBtnText}>{t("driverRide.dropOff")}</Text>
                      </TouchableOpacity>
                    ) : (
                      // Never boarded — let the driver resolve them as a no-show so
                      // the ride can still be ended (no softlock).
                      <TouchableOpacity
                        style={[
                          styles.noShowBtn,
                          (loading || paymentProcessing) && styles.btnDisabled,
                        ]}
                        onPress={() => markNoShow(pid)}
                        disabled={loading || paymentProcessing}
                      >
                        <Text style={styles.noShowBtnText}>{t("driverRide.noShow")}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          {/* Reopen Maps — hidden once everyone has been dropped off: there is
              no stop left, and re-opening must not navigate the driver home. */}
          {passengers.some((pid) => !droppedPassengers.includes(pid)) && (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => {
                // Only route to passengers who haven't been dropped yet
                openGoogleMaps(buildRouteCoords(false));
              }}
              activeOpacity={0.8}
            >
              <Text style={{fontSize: 14}}>🗺</Text>
              <Text style={styles.secondaryBtnText}>{t("driverRide.reopenMaps")}</Text>
            </TouchableOpacity>
          )}

          {/* Show QR Code button */}
          {qrToken && (
            <TouchableOpacity
              onPress={() => setShowQrModal(true)}
              activeOpacity={0.8}
              style={styles.primaryBtn}
            >
              <Text style={[{fontSize: 16}, { marginRight: 6 }]}>📱</Text>
              <Text style={styles.btnText}>{t("driverRide.showQrCode")}</Text>
            </TouchableOpacity>
          )}

          {paymentProcessing && (
            <View style={styles.infoCard}>
              <Text style={[styles.waitingText, { color: C.gold }]}>{t("driverRide.processingPayment")}</Text>
            </View>
          )}

          {allPassengersDropped && (
            <TouchableOpacity
              style={[styles.dangerBtn, (loading || paymentProcessing) && styles.btnDisabled]}
              disabled={loading || paymentProcessing}
              activeOpacity={0.8}
              onPress={() => {
                Alert.alert(
                  t("driverRide.endRideTitle"),
                  t("driverRide.endRideMsg"),
                  [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                      text: t("driverRide.endRide"),
                      style: "destructive",
                      onPress: () => finalizeRide(),
                    },
                  ]
                );
              }}
            >
              <Text style={styles.btnText}>{t("driverRide.endRide")}</Text>
            </TouchableOpacity>
          )}

          {/* Always-available escape hatch while the ride is in progress. */}
          <TouchableOpacity
            style={[styles.cancelInlineBtn, (loading || paymentProcessing) && styles.btnDisabled]}
            disabled={loading || paymentProcessing}
            activeOpacity={0.8}
            onPress={cancelRide}
          >
            <Text style={styles.cancelInlineText}>{t("driverRide.cancelRide")}</Text>
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

      {/* Passenger Profile Modal */}
      <Modal
        visible={profileModal !== null || profileLoading}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileModal(null)}
      >
        <TouchableOpacity
          style={styles.profileBackdrop}
          activeOpacity={1}
          onPress={() => setProfileModal(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.profileSheet}>
            {profileLoading ? (
              <View style={styles.profileLoadingWrap}>
                <Text style={styles.profileLoadingText}>{t("common.loading")}</Text>
              </View>
            ) : profileModal ? (
              <>
                {/* Avatar */}
                <View style={styles.profileAvatarWrap}>
                  {profileModal.avatar ? (
                    <ExpoImage
                      source={{ uri: profileModal.avatar }}
                      style={styles.profileAvatar}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={[styles.profileAvatar, styles.profileAvatarFallback]}>
                      <Text style={{ fontSize: 32 }}>👤</Text>
                    </View>
                  )}
                </View>

                {/* Name + XP */}
                <Text style={styles.profileName}>{profileModal.name}</Text>
                <View style={{ alignItems: "center", marginTop: 8 }}>
                  <CertBadges certifications={profileModal.certifications} size="full" />
                </View>
                <View style={styles.profileXpRow}>
                  <Text style={styles.profileXpText}>⚡ {profileModal.xp} XP</Text>
                  {profileModal.rating > 0 && (
                    <Text style={styles.profileRatingText}>⭐ {profileModal.rating.toFixed(1)}</Text>
                  )}
                </View>

                {/* Stats */}
                <View style={styles.profileStatsRow}>
                  <View style={styles.profileStat}>
                    <Text style={styles.profileStatVal}>{profileModal.ridesCompleted}</Text>
                    <Text style={styles.profileStatLabel}>{t("driverRide.profileRides")}</Text>
                  </View>
                </View>

                {/* Extra info */}
                <View style={styles.profileInfoList}>
                  {profileModal.school ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon}>🎓</Text>
                      <Text style={styles.profileInfoText}>{profileModal.school}</Text>
                    </View>
                  ) : null}
                  {profileModal.age ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon}>🎂</Text>
                      <Text style={styles.profileInfoText}>{t("driverRide.profileAge", { age: profileModal.age })}</Text>
                    </View>
                  ) : null}
                  {profileModal.instagramHandle ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon}>📷</Text>
                      <Text style={styles.profileInfoText}>@{profileModal.instagramHandle}</Text>
                    </View>
                  ) : null}
                </View>

                <TouchableOpacity
                  style={styles.profileCloseBtn}
                  onPress={() => setProfileModal(null)}
                >
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
    paddingHorizontal: 20,
    paddingBottom: 18,
    gap: 12,
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.10)",
  },
  headerScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,8,18,0.86)" },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  headerDestination: {
    flex: 1,
    color: C.text,
    fontSize: 15,
    fontWeight: "700",
  },
  headerPaxPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  headerPaxText: {
    color: C.text,
    fontSize: 12,
    fontWeight: "700",
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
    backgroundColor: "transparent",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 10,
    // Float the glass panel slightly above the map base layer.
    marginTop: -28,
  },
  // Frosted blur + dark scrim guarantee text contrast over any map content.
  panelGlass: { ...StyleSheet.absoluteFillObject },
  panelScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,8,18,0.78)" },
  infoCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
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
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: 10,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  requestCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(251,191,36,0.10)",
    borderRadius: 12,
    padding: 10,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.3)",
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(137,56,213,0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
    overflow: "hidden",
  },
  avatarThumb: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
  dangerBtn: {
    backgroundColor: C.danger,
    borderRadius: 16,
    paddingVertical: 18,
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
  waitingConfirmChip: {
    opacity: 1,
    backgroundColor: "rgba(137,56,213,0.14)",
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.35)",
  },
  waitingConfirmText: {
    color: "#e09af7",
    fontWeight: "700",
    fontSize: 14,
    textAlign: "center",
    flexShrink: 1,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#8938D5",
    backgroundColor: "transparent",
  },
  secondaryBtnText: {
    color: "#8938D5",
    fontSize: 13,
    fontWeight: "600",
  },
  dropoffBtn: {
    backgroundColor: "#8938D5",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dropoffBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  noShowBtn: {
    backgroundColor: "rgba(248,113,113,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.35)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  noShowBtnText: {
    color: "#f87171",
    fontSize: 12,
    fontWeight: "700",
  },
  cancelInlineBtn: {
    alignItems: "center",
    paddingVertical: 12,
  },
  cancelInlineText: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "600",
  },
  droppedBadge: {
    backgroundColor: "rgba(16,185,129,0.12)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.3)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  droppedBadgeText: {
    color: "#34d399",
    fontSize: 11,
    fontWeight: "600",
  },
  // Dropped, but outside the destination radius — this leg earns nothing.
  unpaidBadge: {
    backgroundColor: "rgba(245,158,11,0.12)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.3)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  unpaidBadgeText: {
    color: C.gold,
    fontSize: 11,
    fontWeight: "600",
  },

  // ── Passenger Profile Modal ───────────────────────────────────────────────
  profileBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  profileSheet: {
    width: "100%",
    backgroundColor: "#13132a",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.3)",
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  profileLoadingWrap: {
    paddingVertical: 32,
    alignItems: "center",
  },
  profileLoadingText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  profileAvatarWrap: {
    marginBottom: 4,
  },
  profileAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  profileAvatarFallback: {
    backgroundColor: "rgba(137,56,213,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: {
    color: "#f3f4f6",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  profileXpRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  profileXpText: {
    color: "#a78bfa",
    fontSize: 13,
    fontWeight: "600",
  },
  profileRatingText: {
    color: "#fbbf24",
    fontSize: 13,
    fontWeight: "600",
  },
  profileStatsRow: {
    flexDirection: "row",
    gap: 20,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    width: "100%",
    justifyContent: "center",
  },
  profileStat: {
    alignItems: "center",
    gap: 2,
  },
  profileStatVal: {
    color: "#f3f4f6",
    fontSize: 18,
    fontWeight: "700",
  },
  profileStatLabel: {
    color: "#9ca3af",
    fontSize: 11,
  },
  profileInfoList: {
    width: "100%",
    gap: 8,
  },
  profileInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  profileInfoIcon: {
    fontSize: 15,
  },
  profileInfoText: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  profileCloseBtn: {
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.4)",
    backgroundColor: "rgba(137,56,213,0.1)",
  },
  profileCloseBtnText: {
    color: "#a78bfa",
    fontSize: 14,
    fontWeight: "600",
  },
});
