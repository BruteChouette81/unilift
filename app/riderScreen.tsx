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
import { fetchPublicProfile, fetchPublicProfiles, type PublicProfile } from "@/services/publicProfileService";
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
import { useDriverRoute } from "@/hooks/use-driver-route";
import { fetchRideRequestById } from "@/services/rideRequestService";
import { fetchPassengerContact } from "@/services/contactService";
import { smsUri, telUri } from "@/utils/phoneNumber";
import ContactCard from "@/components/phone/contact-card";
import { devLog, devWarn } from "@/constants/runtime-config";
import { rideLog } from "@/utils/ride-logger";
import { maybeShowGmapsHint } from "@/utils/gmapsHint";
import { rideErrorMessage } from "@/utils/rideErrors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResponsive } from "@/hooks/use-responsive";
import { FONT_CAP } from "@/constants/typography";
import { P } from "@/constants/palette";

const C = {
  bg: P.bg, surface: P.surface, surfaceAlt: P.surfaceRaised,
  purple: P.accent, purpleLight: P.accentLight, blue: P.hype,
  text: P.text, muted: P.textMuted, dim: P.textDim,
  danger: P.dangerStrong, gold: P.warning, success: P.success,
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
  /** The accepted passenger and their pickup/dropoff, forwarded by
   *  acceptRideScreen from the accept response. Optional — the ride-doc
   *  snapshot is still the source of truth; these only seed the map so it is
   *  never blank on the first frame. */
  PaxId?: string;
  PaxLat?: string;
  PaxLng?: string;
  PaxDestLat?: string;
  PaxDestLng?: string;
};

const toSafeNumber = (value: string, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// The cross-user view of a person is `users/{uid}/public/profile` — see
// services/publicProfileService.ts. The local type and decoder that used to live
// here read `users/{uid}` directly, which is now owner-only: it carried the other
// person's email and birth date into a screen that only ever rendered their name,
// avatar, rating and badges.
type PassengerProfile = PublicProfile;


export default function RideModeDriver() {
  useKeepAwake();
  const router = useRouter();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { isNarrow, shouldStack, scaleBox, panelMaxHeight, height: winHeight, fontScale } = useResponsive();
  const { user } = useAuth();
  const { setActiveRide, clearActiveRide } = useActiveRide();
  const {
    rideId, Originlat, OriginLng, DestinationLat, DestinationLng, Destination, started,
    PaxId, PaxLat, PaxLng, PaxDestLat, PaxDestLng,
  } = useLocalSearchParams<RideParams>();
  const startedFromInbox = started === "true";

  // Deliberately NOT seeded from the accept params: `passengers` gates the Start
  // Ride button, and `pendingConfirmation` is empty until the first snapshot —
  // seeding it would briefly let the driver start a ride the passenger has not
  // confirmed yet. The map renders straight off the pickup map below, so the
  // passenger pin still paints on the first frame without this.
  const [passengers, setPassengers] = useState<string[]>([]);
  const [joinRequests, setJoinRequests] = useState<Record<string, JoinRequest>>({});
  const [rideStarted, setRideStarted] = useState(startedFromInbox);
  const [loading, setLoading] = useState(false);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<number>(0);
  const [showQrModal, setShowQrModal] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  // Seeded from the accept hand-off when it carried the passenger's coords, so
  // the map has a passenger on it before the first snapshot. Overwritten by the
  // ride doc as soon as it arrives.
  const [passengerPickups, setPassengerPickups] = useState<Record<string, { latitude: number; longitude: number }>>(
    () => (PaxId && PaxLat && PaxLng
      ? { [PaxId]: { latitude: toSafeNumber(PaxLat), longitude: toSafeNumber(PaxLng) } }
      : {}),
  );
  const [passengerDropoffs, setPassengerDropoffs] = useState<Record<string, { latitude: number; longitude: number }>>(
    () => (PaxId && PaxDestLat && PaxDestLng
      ? { [PaxId]: { latitude: toSafeNumber(PaxDestLat), longitude: toSafeNumber(PaxDestLng) } }
      : {}),
  );
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

  // The driver's own live GPS. Previously the watcher's fix went straight to
  // Firestore and was never held here, so the driver's marker sat on the
  // accept-time `originCoords` for the whole ride — the "I'm a house parked in
  // the wrong place" report.
  const [myLocation, setMyLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  // Street address per stop coordinate, keyed by "lat,lng". Filled from the
  // originating request's label when there is one, else reverse-geocoded.
  const [stopAddresses, setStopAddresses] = useState<Record<string, string>>({});
  const [requestId, setRequestId] = useState<string | null>(null);
  // Passenger phone numbers, keyed by uid. `undefined` = not fetched yet,
  // `null` = the passenger shared none. Deliberately not persisted anywhere:
  // the server re-checks permission on every call and stops answering once the
  // passenger is dropped off, so a cache that outlived the ride would outlive
  // the consent behind it.
  const [passengerPhones, setPassengerPhones] = useState<Record<string, string | null>>({});

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
    const profile = await fetchPublicProfile(uid);
    setProfileLoading(false);
    if (profile) {
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
      devWarn('QR generation failed', e);
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

        // The originating rideRequests doc — the only place a human-readable
        // pickup address exists. Rules let the matched driver read it.
        if (typeof data.requestId === "string") {
          setRequestId((prev) => (prev === data.requestId ? prev : data.requestId));
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

    void fetchPublicProfiles(uids).then((profiles) => {
      if (Object.keys(profiles).length === 0) return;
      setPassengerProfiles((prev) => ({ ...prev, ...profiles }));
    });
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
        setMyLocation(devCoords);
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
          const fix = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          // Drive the map/ETA off the same fix we broadcast — one watcher, two
          // consumers, no second GPS subscription.
          setMyLocation(fix);
          // Never let a rejected write escape the watcher callback.
          void updateDriverLocation(rideId, fix).catch(() => {});
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
  //
  // `buildStops` is the list WITHOUT the driver: every remaining place they have
  // to drive to, in order. A passenger who has already boarded no longer needs
  // their pickup visited, so it drops out — routing a driver back to a corner
  // they already left is what made the old route look nonsensical mid-ride.
  const buildStops = (includeDropped = false): { latitude: number; longitude: number }[] => {
    const activePassengers = includeDropped
      ? passengers
      : passengers.filter((uid) => !droppedPassengers.includes(uid));
    const pickups = activePassengers
      .filter((uid) => includeDropped || !boardedPassengers.includes(uid))
      .map((uid) => passengerPickups[uid])
      .filter((l): l is { latitude: number; longitude: number } => !!l);
    const dropoffs = activePassengers
      .map((uid) => passengerDropoffs[uid])
      .filter((l): l is { latitude: number; longitude: number } => !!l);
    const ridesToDestination = activePassengers.some((uid) => !passengerDropoffs[uid]);
    const destIsReal = destCoords.latitude !== 0 || destCoords.longitude !== 0;
    const stops = [
      ...pickups,
      ...dropoffs,
      ...(ridesToDestination && destIsReal ? [destCoords] : []),
    ];
    devLog("[RIDE-DEBUG] buildStops", {
      activePassengers: activePassengers.length,
      pickups: pickups.length,
      dropoffs: dropoffs.length,
      ridesToDestination,
      totalStops: stops.length,
    });
    return stops;
  };

  // Full ordered coordinate list for navigation: where the driver IS right now,
  // then every remaining stop. The live fix is what matters — the old code put
  // `originCoords` here, i.e. wherever the driver happened to be when they
  // accepted, which Google Maps then rendered as pinned point A. That stale pin
  // is what drivers were seeing instead of their passenger.
  const buildRouteCoords = (includeDropped = false): { latitude: number; longitude: number }[] => {
    const start = myLocation ?? originCoords;
    return [start, ...buildStops(includeDropped)];
  };

  // ── Where is my passenger, in words and in minutes ────────────────────────
  //
  // The stops the driver still has to visit, from where they are right now.
  const remainingStops = buildStops(false);
  const route = useDriverRoute(myLocation, remainingStops);

  /** Stable key for a coordinate, so an address is fetched once per place. */
  const coordKey = (c: { latitude: number; longitude: number }): string =>
    `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`;

  // Resolve every pickup/dropoff to a street address. The originating request
  // carries the label the passenger actually typed, which beats a reverse
  // geocode; anything else (planned-ride joins, drop-offs) falls back to the
  // on-device reverse geocoder. Each place is resolved once and cached.
  useEffect(() => {
    const targets = [
      ...Object.values(passengerPickups),
      ...Object.values(passengerDropoffs),
    ].filter((c) => c && (c.latitude !== 0 || c.longitude !== 0));
    const missing = targets.filter((c) => !stopAddresses[coordKey(c)]);
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      // The request label, when this ride came from a dispatch match.
      let requestLabel: { key: string; label: string } | null = null;
      if (requestId) {
        try {
          const req = await fetchRideRequestById(requestId);
          if (req?.originLabel && req.origin) {
            requestLabel = { key: coordKey(req.origin), label: req.originLabel };
          }
        } catch { /* fall through to reverse geocoding */ }
      }

      const resolved: Record<string, string> = {};
      if (requestLabel) resolved[requestLabel.key] = requestLabel.label;

      for (const c of missing) {
        const key = coordKey(c);
        if (resolved[key]) continue;
        try {
          const [place] = await Location.reverseGeocodeAsync(c);
          if (!place) continue;
          const line = [place.streetNumber, place.street].filter(Boolean).join(" ");
          const address = [line || place.name, place.city].filter(Boolean).join(", ");
          if (address) resolved[key] = address;
        } catch { /* leave unresolved — the card shows a fallback */ }
      }

      if (!cancelled && Object.keys(resolved).length > 0) {
        setStopAddresses((prev) => ({ ...resolved, ...prev }));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passengerPickups, passengerDropoffs, requestId]);

  /** The stop this passenger is associated with right now: their pickup until
   *  they board, their drop-off afterwards. */
  const stopForPassenger = (uid: string): { latitude: number; longitude: number } | undefined =>
    boardedPassengers.includes(uid) ? passengerDropoffs[uid] : passengerPickups[uid];

  const addressForPassenger = (uid: string): string | null => {
    const stop = stopForPassenger(uid);
    if (!stop) return null;
    return stopAddresses[coordKey(stop)] ?? null;
  };

  /** "3.2 km · 8 min away" for a passenger's current stop, or null when the
   *  route hasn't resolved yet. `route.legs` is in `remainingStops` order. */
  const etaForPassenger = (uid: string): string | null => {
    const stop = stopForPassenger(uid);
    if (!stop || route.legs.length === 0) return null;
    const index = remainingStops.findIndex((s) => coordKey(s) === coordKey(stop));
    if (index < 0) return null;
    // legs[i] is the drive INTO stops[i], so cumulative up to and including it.
    const upTo = route.legs.slice(0, index + 1);
    if (upTo.length !== index + 1) return null;
    const km = upTo.reduce((sum, l) => sum + l.distanceKm, 0);
    const minutes = Math.max(1, Math.round(upTo.reduce((sum, l) => sum + l.durationSeconds, 0) / 60));
    return t("driverRide.etaAway", {
      dist: km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`,
      time: `${minutes} ${t("driverRide.minutesShort")}`,
    });
  };

  // Fetch each active passenger's number once. The server refuses after
  // drop-off, so dropped passengers are skipped rather than retried into a 400.
  useEffect(() => {
    if (!rideId) return;
    const missing = passengers.filter(
      (uid) => !droppedPassengers.includes(uid) && !(uid in passengerPhones),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const uid of missing) {
        try {
          const { phone } = await fetchPassengerContact(rideId, uid);
          if (!cancelled) setPassengerPhones((prev) => ({ ...prev, [uid]: phone }));
        } catch (err) {
          // A refusal is not worth an alert — the card falls back to "no number
          // shared", which is the same thing from the driver's point of view.
          devWarn("[RIDE-DEBUG] passenger contact unavailable", err);
          if (!cancelled) setPassengerPhones((prev) => ({ ...prev, [uid]: null }));
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, passengers, droppedPassengers]);

  /** Open the dialer or Messages. Deliberately does NOT gate on canOpenURL:
   *  that returns false on any device without a dialer (iPad, simulator), which
   *  would hide the buttons on exactly the hardware this gets tested on. */
  const openContactUri = async (uri: string) => {
    if (!uri) return;
    try {
      await Linking.openURL(uri);
    } catch (err) {
      devWarn("[RIDE-DEBUG] contact link failed", err);
      Alert.alert(t("common.error"), t("driverRide.contactLinkFailed"));
    }
  };

  /** Passenger display names for the map callouts. */
  const passengerNames: Record<string, string> = {};
  for (const [uid, profile] of Object.entries(passengerProfiles)) {
    if (profile?.name) passengerNames[uid] = profile.name;
  }

  const openGoogleMaps = async (coords: { latitude: number; longitude: number }[]) => {
    // Fewer than two points means there is nothing left to navigate to (every
    // passenger has been dropped off). Never fall back to the driver's own
    // destination here — the ride is over.
    if (coords.length < 2) return;

    const ll = (c: { latitude: number; longitude: number }) => `${c.latitude},${c.longitude}`;

    const dest = coords[coords.length - 1];
    const intermediates = coords.slice(1, -1); // everything between origin and destination

    // Web URL, documented `api=1` form. The legacy `dir/A/B/C` path form made
    // coords[0] a literal pinned place, so Google Maps opened focused on a dot
    // labelled with the driver's own start point rather than routing them. With
    // an explicit `origin` the driver's live position is the route's start and
    // the passenger's pickup is the first thing they see.
    const webUrl =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${encodeURIComponent(ll(coords[0]))}` +
      `&destination=${encodeURIComponent(ll(dest))}` +
      (intermediates.length > 0
        ? `&waypoints=${encodeURIComponent(intermediates.map(ll).join("|"))}`
        : "") +
      `&travelmode=driving`;

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


  // Keep the live-location broadcast running for the whole time this screen is
  // mounted. startLocationBroadcast() is idempotent, so re-entry after a cold
  // start (or a `rideStarted` flip from the snapshot) never opens a second
  // watcher. Armed as soon as the screen mounts, not only once the ride is started: the
  // drive TO the pickup is exactly the stretch where the driver needs to see
  // themselves move, and it keeps `rides.driverLocation` fresh so the waiting
  // passenger can watch their driver approach too.
  useEffect(() => {
    if (rideId) void startLocationBroadcast();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideStarted, rideId]);

  // First fix on mount so the car pin is right immediately instead of waiting
  // for the watcher's first callback (up to 8 s / 50 m away).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pos = await devAwareCurrentPosition({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled && pos) {
          setMyLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        }
      } catch { /* permission prompt is handled by startLocationBroadcast */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // A passenger row grows with the text, so a flat 140pt cap showed one clipped
  // row at large sizes. Track the text, but stay a fraction of the window so two
  // lists plus the action buttons still fit. At the default text size this
  // resolves to exactly the previous 140.
  const listMaxHeight = Math.min(winHeight * 0.22, 140 * Math.min(fontScale, 2));

  /**
   * One passenger, everything the driver needs to reach them: who they are,
   * the street address of the stop, how far and how long away it is, and a
   * one-tap hand-off to Google Maps.
   *
   * The pickup pin is a fixed point captured when the passenger sent their
   * request — we never receive their live position — so the card says so
   * outright. A driver who thinks a static pin is tracking a moving person
   * circles the block looking for someone who was never there.
   */
  function PassengerStopCard({ passengerId: pid }: { passengerId: string }) {
    const profile = passengerProfiles[pid];
    const isDropped = droppedPassengers.includes(pid);
    const isBoarded = boardedPassengers.includes(pid);
    // Dropped but out of range of their destination ⇒ this leg pays nothing.
    // Surface it now, not after the ride is over.
    const isUnpaidLeg = isDropped && isBoarded && !confirmedDropoffs.includes(pid);
    const stop = stopForPassenger(pid);
    const address = addressForPassenger(pid);
    const eta = etaForPassenger(pid);
    // Read through the drop-off check rather than trusting what was fetched
    // earlier. The server stops answering once a passenger is dropped, and this
    // is what makes the client agree with it instead of showing a number whose
    // window has closed.
    const phone = isDropped ? null : (passengerPhones[pid] ?? null);
    const busy = loading || paymentProcessing;

    return (
      <View style={styles.stopCard}>
        {/* Identity */}
        <View style={styles.stopCardHead}>
          <TouchableOpacity
            style={[styles.avatarPlaceholder, { width: avatarBox, height: avatarBox, borderRadius: avatarBox / 2 }]}
            onPress={() => openPassengerProfile(pid)}
            activeOpacity={0.7}
          >
            {profile?.avatar ? (
              <ExpoImage
                source={{ uri: profile.avatar }}
                style={styles.avatarThumb}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <Text style={{ fontSize: 16 }} allowFontScaling={false}>👤</Text>
            )}
          </TouchableOpacity>

          <View style={styles.stopCardIdentity}>
            <View style={styles.passengerNameRow}>
              <Text style={styles.passengerIdText} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP.body}>
                {profile?.name ?? pid.slice(0, 12) + "..."}
              </Text>
              {profile && profile.ratingCount > 0 && (
                <Text style={styles.stopCardRating} maxFontSizeMultiplier={FONT_CAP.chrome}>
                  ⭐ {profile.rating.toFixed(1)}
                </Text>
              )}
              <CertBadges certifications={profile?.certifications} size="compact" hideWhenEmpty />
            </View>
            <Text style={styles.passengerSubtext} maxFontSizeMultiplier={FONT_CAP.chrome}>
              {isDropped
                ? t("driverRide.droppedOff")
                : isBoarded
                  ? t("driverRide.inRide")
                  : rideStarted
                    ? t("driverRide.notBoardedYet")
                    : t("driverRide.accepted")}
            </Text>
          </View>

          {isDropped && (
            <View style={isUnpaidLeg ? styles.unpaidBadge : styles.droppedBadge}>
              <Text
                style={isUnpaidLeg ? styles.unpaidBadgeText : styles.droppedBadgeText}
                maxFontSizeMultiplier={FONT_CAP.chrome}
              >
                {isUnpaidLeg ? t("driverRide.unpaidLeg") : t("driverRide.droppedOff")}
              </Text>
            </View>
          )}
        </View>

        {/* Where to go */}
        {!isDropped && stop && (
          <View style={styles.stopCardWhere}>
            <Text style={styles.stopCardLabel} maxFontSizeMultiplier={FONT_CAP.chrome}>
              {isBoarded ? t("driverRide.dropoffAddress") : t("driverRide.pickupAddress")}
            </Text>
            <Text style={styles.stopCardAddress} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.body}>
              📍 {address ?? t("driverRide.addressUnavailable")}
            </Text>
            {!isBoarded && (
              <Text style={styles.stopCardStaticNote} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.chrome}>
                {t("driverRide.pickupStaticNote")}
              </Text>
            )}
            <Text style={styles.stopCardEta} maxFontSizeMultiplier={FONT_CAP.chrome}>
              {eta ?? (route.loading ? "…" : t("driverRide.etaUnavailable"))}
            </Text>
          </View>
        )}

        {/* How to reach them. A driver standing outside the wrong door needs
            this more than any other thing on the card.

            `phone` is already null for a dropped passenger (see above), and the
            card renders "no number shared" for null — so the visibility rule
            stays in one place rather than being restated by this branch. */}
        {!isDropped && (
          <ContactCard
            phone={phone}
            name={profile?.name}
            onCall={() => void openContactUri(telUri(phone ?? ""))}
            onText={() => void openContactUri(smsUri(phone ?? ""))}
            stacked={shouldStack}
          />
        )}

        {/* Actions */}
        {!isDropped && (
          <View style={[styles.stopCardActions, shouldStack && styles.stopCardActionsStacked]}>
            {stop && (
              <TouchableOpacity
                style={[styles.navigateBtn, shouldStack && styles.stopCardActionStacked]}
                onPress={() => openGoogleMaps(buildRouteCoords(false))}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 14 }} allowFontScaling={false}>🧭</Text>
                <Text style={styles.navigateBtnText} maxFontSizeMultiplier={FONT_CAP.action}>
                  {t("driverRide.navigate")}
                </Text>
              </TouchableOpacity>
            )}
            {isBoarded ? (
              <TouchableOpacity
                style={[styles.dropoffBtn, styles.stopCardSecondaryAction, shouldStack && styles.stopCardActionStacked, busy && styles.btnDisabled]}
                onPress={() => dropOffPassenger(pid)}
                disabled={busy}
                activeOpacity={0.8}
              >
                <Text style={styles.dropoffBtnText} maxFontSizeMultiplier={FONT_CAP.chrome}>
                  {t("driverRide.dropOff")}
                </Text>
              </TouchableOpacity>
            ) : rideStarted ? (
              // Never boarded — let the driver resolve them as a no-show so the
              // ride can still be ended (no softlock).
              <TouchableOpacity
                style={[styles.noShowBtn, styles.stopCardSecondaryAction, shouldStack && styles.stopCardActionStacked, busy && styles.btnDisabled]}
                onPress={() => markNoShow(pid)}
                disabled={busy}
                activeOpacity={0.8}
              >
                <Text style={styles.noShowBtnText} maxFontSizeMultiplier={FONT_CAP.chrome}>
                  {t("driverRide.noShow")}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>
    );
  }

  const avatarBox = scaleBox(36);
  const panelPad = isNarrow ? 12 : 16;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Header — dark glass (frosted blur + scrim), no gradient */}
      <View style={[styles.header, { paddingTop: insets.top + 16, paddingHorizontal: isNarrow ? 14 : 20 }]}>
        <BlurView intensity={40} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.headerScrim} pointerEvents="none" />
        <View style={[styles.headerTopRow, shouldStack && styles.headerRowStacked]}>
          <View style={styles.headerLeft}>
            <View style={styles.liveDot} />
            <Text style={styles.headerTitle} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.body}>{t("driverRide.headerTitle")}</Text>
          </View>
          <View style={[styles.modeBadge, !shouldStack && styles.badgeInline]}>
            <Text style={{fontSize: 12}} allowFontScaling={false}>🚗</Text>
            <Text style={styles.modeBadgeText} maxFontSizeMultiplier={FONT_CAP.chrome}>{rideStarted ? t("driverRide.inProgress") : t("driverRide.waiting")}</Text>
          </View>
        </View>
        <View style={[styles.headerBottomRow, shouldStack && styles.headerRowStacked]}>
          <Text style={styles.headerDestination} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.body}>
            {Destination ? decodeURIComponent(Destination) : `${DestinationLat}, ${DestinationLng}`}
          </Text>
          <View style={[styles.headerPaxPill, !shouldStack && styles.badgeInline]}>
            <Text style={{fontSize: 11}} allowFontScaling={false}>👥</Text>
            <Text style={styles.headerPaxText} maxFontSizeMultiplier={FONT_CAP.chrome}>
              {passengers.length} {t("driverRide.acceptedCount")}
            </Text>
          </View>
        </View>
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <DriverRideMapView
          origin={originCoords}
          driverLocation={myLocation ?? undefined}
          destination={destCoords}
          passengers={passengers}
          pendingLocations={pendingLocations}
          passengerPickups={passengerPickups}
          passengerDropoffs={passengerDropoffs}
          passengerNames={passengerNames}
          labels={{
            driver: t("driverRide.legendYou"),
            pickup: t("driverRide.pickupAddress"),
            dropoff: t("driverRide.dropoffAddress"),
            destination: t("driverRide.destination"),
          }}
          // Before the ride starts this is the live route to the pickup; once it
          // starts the polyline is frozen at the agreed multi-stop route — with
          // the live one as a fallback, so a failed Directions call at start
          // leaves a route on screen rather than a bare set of pins.
          frozenPolyline={rideStarted ? (frozenPolyline ?? route.polyline) : route.polyline}
        />

        {/* Legend. Lives here rather than inside the map component so it renders
            identically on Apple Maps (iOS), where customMapStyle is a no-op. */}
        <View style={styles.mapLegend} pointerEvents="none">
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: C.blue }]} />
            <Text style={styles.legendText} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP.chrome}>
              {t("driverRide.legendYou")}
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: C.success }]} />
            <Text style={styles.legendText} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP.chrome}>
              {t("driverRide.legendPickup")}
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: C.purple }]} />
            <Text style={styles.legendText} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP.chrome}>
              {t("driverRide.legendDropoff")}
            </Text>
          </View>
        </View>
      </View>

      {!rideStarted ? (
        /* ── Pre-Start Panel ── */
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16, paddingHorizontal: panelPad }]}>
          <BlurView intensity={55} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.panelGlass} pointerEvents="none" />
          <View style={styles.panelScrim} pointerEvents="none" />
          {/* Pending Join Requests */}
          {pendingRequests.length > 0 && (
            <>
              <Text style={styles.sectionTitle} maxFontSizeMultiplier={FONT_CAP.body}>{t("driverRide.joinRequests")}</Text>
              <ScrollView style={[styles.passengerList, { maxHeight: listMaxHeight }]} nestedScrollEnabled>
                {pendingRequests.map((req) => (
                  <View key={req.passengerId} style={[styles.requestCard, shouldStack && styles.passengerCardStacked]}>
                    <TouchableOpacity
                      style={[styles.avatarPlaceholder, { width: avatarBox, height: avatarBox, borderRadius: avatarBox / 2 }]}
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
                        <Text style={{fontSize: 16}} allowFontScaling={false}>🙋</Text>
                      )}
                    </TouchableOpacity>
                    <View style={[styles.passengerInfo, shouldStack && styles.passengerInfoStacked]}>
                      <View style={styles.passengerNameRow}>
                        <Text style={styles.passengerIdText} numberOfLines={1} maxFontSizeMultiplier={FONT_CAP.body}>
                          {passengerProfiles[req.passengerId]?.name ?? req.passengerId.slice(0, 12) + "..."}
                        </Text>
                        <CertBadges certifications={passengerProfiles[req.passengerId]?.certifications} size="compact" hideWhenEmpty />
                      </View>
                      <Text style={styles.passengerSubtext} maxFontSizeMultiplier={FONT_CAP.chrome}>{t("driverRide.wantsToJoin")}</Text>
                    </View>
                    <View style={styles.rowActions}>
                      <TouchableOpacity
                        onPress={() => handleAcceptRequest(req.passengerId)}
                        style={styles.acceptBtn}
                        disabled={loading}
                        activeOpacity={0.8}
                      >
                        <Text style={{fontSize: 14}} allowFontScaling={false}>✅</Text>
                        <Text style={styles.acceptText} maxFontSizeMultiplier={FONT_CAP.chrome}>{t("driverRide.accept")}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleRejectRequest(req.passengerId)}
                        style={styles.kickBtn}
                        disabled={loading}
                        activeOpacity={0.8}
                      >
                        <Text style={{fontSize: 14}} allowFontScaling={false}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </>
          )}

          {/* Accepted Passengers — the "where do I go and who am I getting" card */}
          {passengers.length > 0 ? (
            <>
              <Text style={styles.sectionTitle} maxFontSizeMultiplier={FONT_CAP.body}>{t("driverRide.acceptedPassengers")}</Text>
              <ScrollView style={[styles.passengerList, { maxHeight: panelMaxHeight(0.42) }]} nestedScrollEnabled>
                {passengers.map((pid) => (
                  <PassengerStopCard key={pid} passengerId={pid} />
                ))}
              </ScrollView>
            </>
          ) : pendingRequests.length === 0 ? (
            <Text style={styles.waitingText} maxFontSizeMultiplier={FONT_CAP.body}>{t("driverRide.waitingForPassengers")}</Text>
          ) : null}

          {/* Show Boarding QR */}
          {qrToken && (
            <TouchableOpacity
              onPress={() => setShowQrModal(true)}
              activeOpacity={0.8}
              style={styles.primaryBtn}
            >
              <Text style={[{fontSize: 16}, { marginRight: 6 }]} allowFontScaling={false}>📱</Text>
              <Text style={styles.btnText} maxFontSizeMultiplier={FONT_CAP.action}>{t("driverRide.showBoardingQr")}</Text>
            </TouchableOpacity>
          )}

          {/* Start Ride — blocked until every dispatched passenger has swiped to
              confirm this driver (mutual match). */}
          {pendingConfirmation.length > 0 ? (
            <View style={[styles.primaryBtn, styles.btnDisabled, styles.waitingConfirmChip]}>
              <ActivityIndicator size="small" color="#e09af7" style={{ marginRight: 8 }} />
              <Text style={styles.waitingConfirmText} maxFontSizeMultiplier={FONT_CAP.action}>{t("driverRide.waitingForRiderConfirm")}</Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={startRideManually}
              disabled={loading || passengers.length === 0}
              activeOpacity={0.8}
              style={[styles.primaryBtn, (loading || passengers.length === 0) && styles.btnDisabled]}
            >
              <Text style={[{fontSize: 16}, { marginRight: 6 }]} allowFontScaling={false}>🧭</Text>
              <Text style={styles.btnText} maxFontSizeMultiplier={FONT_CAP.action}>{t("driverRide.startRide")}</Text>
            </TouchableOpacity>
          )}

          {/* Cancel Ride */}
          <TouchableOpacity
            style={[styles.dangerBtn, loading && styles.btnDisabled]}
            onPress={cancelRide}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText} maxFontSizeMultiplier={FONT_CAP.action}>{t("driverRide.cancelRide")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* ── In-Progress Panel ── */
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16, paddingHorizontal: panelPad }]}>
          <BlurView intensity={55} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.panelGlass} pointerEvents="none" />
          <View style={styles.panelScrim} pointerEvents="none" />
          <View style={styles.infoCard}>
            <Text style={[styles.infoLabel, { color: C.success }]} maxFontSizeMultiplier={FONT_CAP.body}>{t("driverRide.rideInProgress")}</Text>
            <Text style={styles.waitingText} maxFontSizeMultiplier={FONT_CAP.body}>{t("driverRide.locationShared")}</Text>
          </View>

          {/* Passenger drop-off list */}
          {passengers.length > 0 && (
            <ScrollView style={[styles.passengerList, { maxHeight: panelMaxHeight(0.42) }]} nestedScrollEnabled>
              {passengers.map((pid) => (
                <PassengerStopCard key={pid} passengerId={pid} />
              ))}
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
              <Text style={{fontSize: 14}} allowFontScaling={false}>🗺</Text>
              <Text style={styles.secondaryBtnText} maxFontSizeMultiplier={FONT_CAP.action}>{t("driverRide.reopenMaps")}</Text>
            </TouchableOpacity>
          )}

          {/* Show QR Code button */}
          {qrToken && (
            <TouchableOpacity
              onPress={() => setShowQrModal(true)}
              activeOpacity={0.8}
              style={styles.primaryBtn}
            >
              <Text style={[{fontSize: 16}, { marginRight: 6 }]} allowFontScaling={false}>📱</Text>
              <Text style={styles.btnText} maxFontSizeMultiplier={FONT_CAP.action}>{t("driverRide.showQrCode")}</Text>
            </TouchableOpacity>
          )}

          {paymentProcessing && (
            <View style={styles.infoCard}>
              <Text style={[styles.waitingText, { color: C.gold }]} maxFontSizeMultiplier={FONT_CAP.body}>{t("driverRide.processingPayment")}</Text>
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
              <Text style={styles.btnText} maxFontSizeMultiplier={FONT_CAP.action}>{t("driverRide.endRide")}</Text>
            </TouchableOpacity>
          )}

          {/* Always-available escape hatch while the ride is in progress. */}
          <TouchableOpacity
            style={[styles.cancelInlineBtn, (loading || paymentProcessing) && styles.btnDisabled]}
            disabled={loading || paymentProcessing}
            activeOpacity={0.8}
            onPress={cancelRide}
          >
            <Text style={styles.cancelInlineText} maxFontSizeMultiplier={FONT_CAP.action}>{t("driverRide.cancelRide")}</Text>
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
          <TouchableOpacity activeOpacity={1} style={[styles.profileSheet, { maxHeight: panelMaxHeight(0.85) }]}>
            {profileLoading ? (
              <View style={styles.profileLoadingWrap}>
                <Text style={styles.profileLoadingText} maxFontSizeMultiplier={FONT_CAP.body}>{t("common.loading")}</Text>
              </View>
            ) : profileModal ? (
              <ScrollView
                contentContainerStyle={styles.profileScrollContent}
                bounces={false}
                showsVerticalScrollIndicator={false}
              >
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
                      <Text style={{ fontSize: 32 }} allowFontScaling={false}>👤</Text>
                    </View>
                  )}
                </View>

                {/* Name + XP */}
                <Text style={styles.profileName} maxFontSizeMultiplier={FONT_CAP.display}>{profileModal.name}</Text>
                <View style={{ alignItems: "center", marginTop: 8 }}>
                  <CertBadges certifications={profileModal.certifications} size="full" />
                </View>
                <View style={styles.profileXpRow}>
                  <Text style={styles.profileXpText} maxFontSizeMultiplier={FONT_CAP.chrome}>⚡ {profileModal.xp} XP</Text>
                  {profileModal.rating > 0 && (
                    <Text style={styles.profileRatingText} maxFontSizeMultiplier={FONT_CAP.chrome}>⭐ {profileModal.rating.toFixed(1)}</Text>
                  )}
                </View>

                {/* Stats */}
                <View style={styles.profileStatsRow}>
                  <View style={styles.profileStat}>
                    <Text style={styles.profileStatVal} maxFontSizeMultiplier={FONT_CAP.display}>{profileModal.ridesCompleted}</Text>
                    <Text style={styles.profileStatLabel} numberOfLines={2} maxFontSizeMultiplier={FONT_CAP.chrome}>{t("driverRide.profileRides")}</Text>
                  </View>
                </View>

                {/* Extra info */}
                <View style={styles.profileInfoList}>
                  {profileModal.school ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon} allowFontScaling={false}>🎓</Text>
                      <Text style={styles.profileInfoText} maxFontSizeMultiplier={FONT_CAP.body}>{profileModal.school}</Text>
                    </View>
                  ) : null}
                  {profileModal.age ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon} allowFontScaling={false}>🎂</Text>
                      <Text style={styles.profileInfoText} maxFontSizeMultiplier={FONT_CAP.body}>{t("driverRide.profileAge", { age: profileModal.age })}</Text>
                    </View>
                  ) : null}
                  {profileModal.instagramHandle ? (
                    <View style={styles.profileInfoRow}>
                      <Text style={styles.profileInfoIcon} allowFontScaling={false}>📷</Text>
                      <Text style={styles.profileInfoText} maxFontSizeMultiplier={FONT_CAP.body}>@{profileModal.instagramHandle}</Text>
                    </View>
                  ) : null}
                </View>

                <TouchableOpacity
                  style={styles.profileCloseBtn}
                  onPress={() => setProfileModal(null)}
                >
                  <Text style={styles.profileCloseBtnText} maxFontSizeMultiplier={FONT_CAP.action}>{t("common.close")}</Text>
                </TouchableOpacity>
              </ScrollView>
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
    paddingBottom: 18,
    gap: 12,
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.10)",
  },
  headerScrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(10,8,18,0.86)" },
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
  // Large text: the title/destination and its pill each get a line.
  headerRowStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 8,
  },
  // Inline pills must not outgrow their share of the row, and must not be the
  // element squeezed to nothing either.
  badgeInline: {
    flexShrink: 0,
    maxWidth: "55%",
  },
  headerDestination: {
    flexGrow: 1,
    flexShrink: 1,
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
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
    backgroundColor: C.success,
  },
  headerTitle: {
    flexShrink: 1,
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
    paddingTop: 18,
    paddingBottom: 16,
    gap: 10,
    // Float the glass panel slightly above the map base layer.
    marginTop: -28,
  },
  // Frosted blur + dark scrim guarantee text contrast over any map content.
  panelGlass: { ...StyleSheet.absoluteFill },
  panelScrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(10,8,18,0.78)" },
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
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 13,
    color: C.muted,
  },
  infoValue: {
    flexShrink: 1,
    fontSize: 13,
    color: C.text,
    fontWeight: "600",
    maxWidth: "50%",
    textAlign: "right",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: C.purpleLight,
    marginTop: 4,
  },
  // maxHeight is supplied per-render from useResponsive() so the list tracks the
  // text size instead of clipping to a flat 140pt.
  passengerList: {},

  // ── Passenger stop card ───────────────────────────────────────────────────
  // Replaces the old one-line row: a driver needs the address, the distance and
  // a way to start navigating, not just a name.
  stopCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.borderFaint,
    padding: 12,
    marginVertical: 4,
    gap: 10,
  },
  stopCardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stopCardIdentity: { flex: 1, gap: 2 },
  stopCardRating: {
    color: C.gold,
    fontSize: 12,
    fontWeight: "700",
  },
  stopCardWhere: {
    gap: 3,
    borderLeftWidth: 2,
    borderLeftColor: C.success,
    paddingLeft: 10,
  },
  stopCardLabel: {
    color: C.dim,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  stopCardAddress: {
    color: C.text,
    fontSize: 13.5,
    fontWeight: "600",
    lineHeight: 19,
  },
  // Deliberately quiet but always present: the pickup pin never moves, and a
  // driver must not read it as live tracking.
  stopCardStaticNote: {
    color: C.dim,
    fontSize: 10.5,
    fontStyle: "italic",
    lineHeight: 15,
  },
  stopCardEta: {
    color: C.purpleLight,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
  stopCardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stopCardActionsStacked: { flexDirection: "column", alignItems: "stretch" },
  // Matches navigateBtn's height so the action row reads as one control group.
  stopCardSecondaryAction: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 12,
  },
  stopCardActionStacked: { width: "100%" },
  navigateBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.purple,
  },
  navigateBtnText: {
    flexShrink: 1,
    textAlign: "center",
    color: C.text,
    fontSize: 13,
    fontWeight: "800",
  },

  // ── Map legend ────────────────────────────────────────────────────────────
  mapLegend: {
    position: "absolute",
    left: 12,
    bottom: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(8,8,16,0.72)",
    borderWidth: 1,
    borderColor: C.borderFaint,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: C.muted, fontSize: 10.5, fontWeight: "600" },

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
  // Large text: avatar + name on the first line, actions on their own line.
  passengerCardStacked: {
    flexWrap: "wrap",
    rowGap: 8,
  },
  passengerInfoStacked: {
    minWidth: "60%",
  },
  passengerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  rowActionInline: {
    flexShrink: 0,
    maxWidth: "45%",
  },
  avatarPlaceholder: {
    backgroundColor: "rgba(137,56,213,0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
    overflow: "hidden",
  },
  // Fills the placeholder, which is sized from useResponsive().
  avatarThumb: {
    width: "100%",
    height: "100%",
  },
  passengerInfo: {
    flex: 1,
  },
  passengerIdText: {
    flexShrink: 1,
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
    flexShrink: 1,
  },
  acceptText: {
    flexShrink: 1,
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
    paddingVertical: 14,
    paddingHorizontal: 12,
    minHeight: 56,
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
    paddingVertical: 14,
    paddingHorizontal: 12,
    minHeight: 56,
    justifyContent: "center",
    alignItems: "center",
  },
  btnText: {
    flexShrink: 1,
    textAlign: "center",
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
    flexShrink: 1,
    textAlign: "center",
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
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  profileScrollContent: {
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
    textAlign: "center",
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
