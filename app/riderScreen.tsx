/**
 * Driver Ride Screen
 * - Pre-start: see join requests, accept/reject, show passenger positions on map
 * - Post-start: broadcast live location, show QR for boarding, end ride
 */

//claude --resume "ride-flow-approval-tracking"

import { DriverRideMapView } from "@/components/mapview";
import QrCodeDisplay from "@/components/QrCodeDisplay";
import { haversineKm } from "@/hooks/use-ride-recommendations";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { generateQrToken, processRidePayments } from "@/services/paymentService";
import { CANCELLATION_FEES } from "@/constants/cancellation";
import { formatCentsAsDollars } from "@/constants/pricing";
import {
  cancelRideAsDriver,
  markPassengerDropped,
  markRideCompleted,
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
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import { Image as ExpoImage } from "expo-image";
import { Alert, AppState, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getMultiWaypointRoute } from "@/services/routeService";
import { devLog, devWarn } from "@/constants/runtime-config";
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
  const [confirmedDropoffPassengers, setConfirmedDropoffPassengers] = useState<string[]>([]);
  const [allPassengersDropped, setAllPassengersDropped] = useState(false);
  const [boardedPassengers, setBoardedPassengers] = useState<string[]>([]);
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

        // setRideStarted(true) is idempotent — React bails out if value unchanged
        if (data.status === "started") {
          setRideStarted(true);
        }
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
  // origin → non-dropped pickups → non-dropped dropoffs → destination.
  // Passing `includeDropped = true` keeps all passengers (used at ride start
  // before anyone has been dropped).
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
    const coords = [originCoords, ...pickups, ...dropoffs, destCoords];
    devLog("[RIDE-DEBUG] buildRouteCoords", {
      activePassengers: activePassengers.length,
      pickups: pickups.length,
      dropoffs: dropoffs.length,
      totalCoords: coords.length,
    });
    return coords;
  };

  const openGoogleMaps = async (coords: { latitude: number; longitude: number }[]) => {
    if (coords.length === 0) return;

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

  const finalizeRide = async (confirmedIds: string[]) => {
    setLoading(true);
    try {
      try {
        setPaymentProcessing(true);
        await processRidePayments(
          rideId,
          { lat: originCoords.latitude, lng: originCoords.longitude },
          { lat: destCoords.latitude, lng: destCoords.longitude },
          Object.keys(passengerPickups).length > 0
            ? Object.fromEntries(
                Object.entries(passengerPickups).map(([uid, loc]) => [
                  uid,
                  { lat: loc.latitude, lng: loc.longitude },
                ]),
              )
            : undefined,
          confirmedIds,
        );
      } catch (e) {
        console.warn("Payment processing failed (non-fatal):", e);
      } finally {
        setPaymentProcessing(false);
      }

      // pendingRatings was already populated incrementally per passenger via
      // markPassengerDropped — preserve it so we don't clobber the appended ids.
      await markRideCompleted(rideId, [], true);

      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }

      clearActiveRide();
      const endMsg = confirmedIds.length === 0
        ? t("driverRide.rideEndedNoPassengersMsg")
        : t("driverRide.rideEndedMsg");
      Alert.alert(t("driverRide.rideEndedTitle"), endMsg);
      router.replace("/");
    } catch (e) {
      Alert.alert(t("common.error"), rideErrorMessage(e, t));
    } finally {
      setLoading(false);
    }
  };

  const dropOffPassenger = async (pid: string) => {
    if (!boardedPassengers.includes(pid)) {
      Alert.alert(t("driverRide.dropoffNotBoardedTitle"), t("driverRide.dropoffNotBoardedMsg"));
      return;
    }
    let distKm: number | null = null;
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const ref = passengerDropoffs[pid] ?? passengerPickups[pid];
      if (ref) {
        distKm = haversineKm(
          pos.coords.latitude,
          pos.coords.longitude,
          ref.latitude,
          ref.longitude,
        );
      }
    } catch {
      // location unavailable — unconfirmed path
    }

    const isConfirmed = distKm !== null && distKm <= 3;
    const distLabel = distKm !== null ? `${distKm.toFixed(1)} km` : "";
    const msg = distKm === null
      ? t("driverRide.dropoffNoLocationMsg")
      : isConfirmed
        ? t("driverRide.dropoffConfirmMsg")
        : t("driverRide.dropoffUnconfirmedMsg", { dist: distLabel });

    Alert.alert(t("driverRide.dropoffTitle"), msg, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        onPress: async () => {
          try {
            await markPassengerDropped(rideId, pid, isConfirmed);
          } catch (e) {
            Alert.alert(t("common.error"), rideErrorMessage(e, t));
            return;
          }
          const newDropped = [...droppedPassengers, pid];
          const newConfirmed = isConfirmed
            ? [...confirmedDropoffPassengers, pid]
            : [...confirmedDropoffPassengers];
          setDroppedPassengers(newDropped);
          setConfirmedDropoffPassengers(newConfirmed);
          if (newDropped.length === passengers.length) {
            setAllPassengersDropped(true);
            Alert.alert(t("driverRide.allDroppedTitle"), t("driverRide.allDroppedMsg"));
          }
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
                      <Text style={styles.passengerIdText} numberOfLines={1}>
                        {passengerProfiles[req.passengerId]?.name ?? req.passengerId.slice(0, 12) + "..."}
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
                      <Text style={styles.passengerIdText} numberOfLines={1}>
                        {passengerProfiles[pid]?.name ?? pid.slice(0, 12) + "..."}
                      </Text>
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

          {/* Start Ride */}
          <TouchableOpacity
            onPress={startRideManually}
            disabled={loading || passengers.length === 0}
            activeOpacity={0.8}
            style={[styles.primaryBtn, (loading || passengers.length === 0) && styles.btnDisabled]}
          >
            <Text style={[{fontSize: 16}, { marginRight: 6 }]}>🧭</Text>
            <Text style={styles.btnText}>{t("driverRide.startRide")}</Text>
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
                      <Text style={styles.passengerIdText} numberOfLines={1}>
                        {passengerProfiles[pid]?.name ?? pid.slice(0, 12) + "..."}
                      </Text>
                      <Text style={styles.passengerSubtext}>
                        {isDropped
                          ? t("driverRide.droppedOff")
                          : isBoarded
                            ? t("driverRide.inRide")
                            : t("driverRide.notBoardedYet")}
                      </Text>
                    </View>
                    {isDropped ? (
                      <View style={styles.droppedBadge}>
                        <Text style={styles.droppedBadgeText}>{t("driverRide.droppedOff")}</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[
                          styles.dropoffBtn,
                          (loading || paymentProcessing || !isBoarded) && styles.btnDisabled,
                        ]}
                        onPress={() => dropOffPassenger(pid)}
                        disabled={loading || paymentProcessing || !isBoarded}
                      >
                        <Text style={styles.dropoffBtnText}>{t("driverRide.dropOff")}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          {/* Reopen Maps */}
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
                      onPress: () => finalizeRide(confirmedDropoffPassengers),
                    },
                  ]
                );
              }}
            >
              <Text style={styles.btnText}>{t("driverRide.endRide")}</Text>
            </TouchableOpacity>
          )}
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
