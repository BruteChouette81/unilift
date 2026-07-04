import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { calculateDriverEarningCents, formatCentsAsDollars } from "@/constants/pricing";
import { useDriverSession } from "@/hooks/use-driver-session";
import { haversineKm } from "@/hooks/use-ride-recommendations";
import { acceptRideRequest, updateDriverSessionLocation } from "@/services/driverSessionService";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/firebaseConfig";
import { devLog, devWarn } from "@/constants/runtime-config";
import { DriverRideMapView } from "@/components/mapview";
import { startRideService } from "@/services/rideServices";
import { fetchUserDocument } from "@/services/userService";
import { calculateAgeFromBirthDate } from "@/components/userHelper";
import type { DriverSession, LocationPoint, RideRequest } from "@/types/models";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getAuth } from "firebase/auth";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const C = {
  bg: "#080810", surface: "#0f0f1e", surfaceAlt: "#13132a",
  border: "rgba(137, 56, 213, 0.30)", borderFaint: "rgba(255,255,255,0.06)",
  purple: "#8938D5", purpleLight: "#e09af7", pink: "#FD165A", blue: "#60a5fa",
  gold: "#fbbf24", text: "#f3f4f6", muted: "#9ca3af", dim: "#4b5563", success: "#34d399",
};
const AVATAR_FALLBACK = "https://www.macfcu.org/wp-content/uploads/2024/02/Windows_10_Default_Profile_Picture.svg.png";

type PassengerProfile = {
  uid: string;
  name: string;
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
  return {
    uid,
    name,
    xp: num("xp"),
    rating: num("rating"),
    avatar: str("avatar") || null,
    ridesCompleted: num("ridesCompleted"),
    school: str("school") || undefined,
    age: typeof age === "number" && age > 0 ? age : undefined,
    instagramHandle: str("instagramHandle") || undefined,
  };
}

type ScoredRequest = RideRequest & { detourKm: number };

function detourFor(session: DriverSession, r: RideRequest): number {
  const o = session.origin, d = session.destinationCoords;
  const p = r.origin, q = r.destinationCoords;
  const base = haversineKm(o.latitude, o.longitude, d.latitude, d.longitude);
  const ext =
    haversineKm(o.latitude, o.longitude, p.latitude, p.longitude) +
    haversineKm(p.latitude, p.longitude, q.latitude, q.longitude) +
    haversineKm(q.latitude, q.longitude, d.latitude, d.longitude);
  return Math.max(0, ext - base);
}

export default function DriverRequestsScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { session, isOnline, loading: sessionLoading, goOffline, reload: reloadSession } = useDriverSession(user);
  const params = useLocalSearchParams<{
    readyRideId?: string;
    readyMaxSeat?: string;
    readyOriginLat?: string;
    readyOriginLng?: string;
    readyDest?: string;
    readyDestLat?: string;
    readyDestLng?: string;
    readyPassengerName?: string;
    readyPassengerAvatar?: string;
    readyPassengerId?: string;
  }>();

  const [requests, setRequests] = useState<ScoredRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  // After accepting, the driver lands on a "ready to start" state and starts
  // the drive from this waiting screen (rather than from the live ride screen).
  const [readyRide, setReadyRide] = useState<
    (Awaited<ReturnType<typeof acceptRideRequest>> & {
      passengerName?: string;
      passengerAvatar?: string;
      passengerId?: string;
    }) | null
  >(() => {
    // Pre-populate readyRide when navigated here from the notification accept flow.
    if (!params.readyRideId) return null;
    return {
      rideId: params.readyRideId,
      maxSeat: parseInt(params.readyMaxSeat ?? "3", 10),
      originLat: parseFloat(params.readyOriginLat ?? "0"),
      originLng: parseFloat(params.readyOriginLng ?? "0"),
      destination: params.readyDest ? decodeURIComponent(params.readyDest) : "",
      destinationLat: parseFloat(params.readyDestLat ?? "0"),
      destinationLng: parseFloat(params.readyDestLng ?? "0"),
      passengerName: params.readyPassengerName ? decodeURIComponent(params.readyPassengerName) : undefined,
      passengerAvatar: params.readyPassengerAvatar ? decodeURIComponent(params.readyPassengerAvatar) : undefined,
      passengerId: params.readyPassengerId || undefined,
    };
  });
  const [starting, setStarting] = useState(false);
  // Live passenger pickup/drop-off for the accepted ride, streamed from the ride
  // doc so the ready-to-start map shows the passenger the instant we accept.
  const [livePassengers, setLivePassengers] = useState<string[]>([]);
  const [livePickups, setLivePickups] = useState<Record<string, { latitude: number; longitude: number }>>({});
  const [liveDropoffs, setLiveDropoffs] = useState<Record<string, { latitude: number; longitude: number }>>({});
  const [profileModal, setProfileModal] = useState<PassengerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [passengerProfiles, setPassengerProfiles] = useState<Record<string, PassengerProfile>>({});
  const sessionRef = useRef<DriverSession | null>(null);
  sessionRef.current = session;

  const openPassengerProfile = async (passengerId: string, fallbackName?: string, fallbackAvatar?: string) => {
    if (passengerProfiles[passengerId]) {
      setProfileModal(passengerProfiles[passengerId]);
      return;
    }
    setProfileLoading(true);
    try {
      const idToken = await getAuth().currentUser?.getIdToken();
      const doc = await fetchUserDocument(passengerId, idToken);
      if (doc) {
        const profile = extractPassengerProfile(passengerId, doc);
        setPassengerProfiles((prev) => ({ ...prev, [passengerId]: profile }));
        setProfileModal(profile);
      } else {
        // Fallback to data embedded in the request
        setProfileModal({
          uid: passengerId,
          name: fallbackName ?? "Passenger",
          xp: 0, rating: 0, avatar: fallbackAvatar ?? null, ridesCompleted: 0,
        });
      }
    } catch {
      setProfileModal({
        uid: passengerId,
        name: fallbackName ?? "Passenger",
        xp: 0, rating: 0, avatar: fallbackAvatar ?? null, ridesCompleted: 0,
      });
    } finally {
      setProfileLoading(false);
    }
  };

  // Live listener for open ride requests while online.
  useEffect(() => {
    if (!isOnline) return;
    setLoading(true);
    const unsubscribe = onSnapshot(
      query(collection(db, "rideRequests"), where("status", "==", "open")),
      (snapshot) => {
        const s = sessionRef.current;
        if (!s) { setRequests([]); setLoading(false); return; }
        const open: RideRequest[] = snapshot.docs.map((docSnap) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d = docSnap.data() as Record<string, any>;
          return {
            id: docSnap.id,
            passengerId: d.passengerId as string,
            passengerName: d.passengerName as string | undefined,
            passengerAvatar: d.passengerAvatar as string | undefined,
            origin: d.origin as LocationPoint,
            destination: d.destination as string,
            destinationCoords: d.destinationCoords as LocationPoint,
            date: (d.date as string) ?? "",
            seatsRequested: d.seatsRequested as number,
            status: d.status as string,
          };
        });
        const scored = open
          .map((r) => ({ ...r, detourKm: detourFor(s, r) }))
          .filter((r) => r.detourKm <= s.maxDetourKm && r.seatsRequested <= s.seatsAvailable)
          .sort((a, b) => a.detourKm - b.detourKm);
        setRequests(scored);
        setLoading(false);
      },
      (error) => {
        console.warn("rideRequests listener error", error);
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [isOnline]);

  // Keep the driver's origin fresh so matching stays accurate.
  useEffect(() => {
    if (!isOnline) return;
    const update = async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await updateDriverSessionLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      } catch { /* non-fatal */ }
    };
    const interval = setInterval(() => void update(), 30000);
    return () => clearInterval(interval);
  }, [isOnline]);

  // Stream the accepted ride's passenger pickup/drop-off coords so the
  // ready-to-start map reflects the live ride doc (works for both the Ride Mode
  // notification accept and the live-inbox accept).
  const readyRideId = readyRide?.rideId;
  useEffect(() => {
    if (!readyRideId) return;
    const unsubscribe = onSnapshot(
      doc(db, "rides", readyRideId),
      (snapshot) => {
        devLog("[RIDE-DEBUG] ready ride snapshot", { readyRideId, exists: snapshot.exists() });
        if (!snapshot.exists()) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = snapshot.data() as Record<string, any>;
        devLog("[RIDE-DEBUG] ready ride pickups/dropoffs", {
          passengers: d.passengers,
          passengerPickups: d.passengerPickups,
          passengerDropoffs: d.passengerDropoffs,
        });
        setLivePassengers(Array.isArray(d.passengers) ? d.passengers : []);
        const parseMap = (raw: Record<string, { latitude?: number; longitude?: number }> | undefined) => {
          const next: Record<string, { latitude: number; longitude: number }> = {};
          if (raw) {
            for (const [uid, loc] of Object.entries(raw)) {
              next[uid] = { latitude: loc?.latitude ?? 0, longitude: loc?.longitude ?? 0 };
            }
          }
          return next;
        };
        setLivePickups(parseMap(d.passengerPickups));
        setLiveDropoffs(parseMap(d.passengerDropoffs));
      },
      (error) => devWarn("[RIDE-DEBUG] ready ride listener error", error),
    );
    return () => unsubscribe();
  }, [readyRideId]);

  const handleAccept = async (r: ScoredRequest) => {
    if (accepting) return;
    setAccepting(r.id);
    try {
      const ride = await acceptRideRequest(r.id);
      // Don't jump into the live screen — show the "ready to start" state so the
      // driver starts the drive from here when they're ready.
      setReadyRide({ ...ride, passengerName: r.passengerName, passengerAvatar: r.passengerAvatar, passengerId: r.passengerId });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "ALREADY_TAKEN") {
        setRequests((prev) => prev.filter((x) => x.id !== r.id));
        Alert.alert(t("driverInbox.takenTitle"), t("driverInbox.takenMsg"));
      } else {
        Alert.alert(t("common.error"), t("driverInbox.acceptFailed"));
      }
    } finally {
      setAccepting(null);
    }
  };

  // Start the accepted drive from this waiting screen. Marks the ride started
  // server-side, then opens the live ride screen already in-progress.
  const handleStartDrive = async () => {
    if (!readyRide || starting) return;
    setStarting(true);
    try {
      await startRideService(readyRide.rideId);
      router.replace(
        `/riderScreen?rideId=${readyRide.rideId}&maxSeat=${readyRide.maxSeat}&Originlat=${readyRide.originLat}&OriginLng=${readyRide.originLng}&Destination=${encodeURIComponent(readyRide.destination)}&DestinationLat=${readyRide.destinationLat}&DestinationLng=${readyRide.destinationLng}&started=true&autostart=true`,
      );
    } catch {
      Alert.alert(t("common.error"), t("driverInbox.startFailed"));
      setStarting(false);
    }
  };

  const handleGoOffline = async () => {
    await goOffline();
    router.back();
  };

  // Shared passenger-profile modal — rendered in both the ready-to-start state
  // and the request list so the driver can inspect the full profile from either.
  const profileModalEl = (
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
              <ActivityIndicator color={C.purpleLight} size="large" />
            </View>
          ) : profileModal ? (
            <>
              <View style={styles.profileAvatarWrap}>
                {profileModal.avatar ? (
                  <Image source={{ uri: profileModal.avatar }} style={styles.profileAvatar} contentFit="cover" cachePolicy="memory-disk" />
                ) : (
                  <View style={[styles.profileAvatar, styles.profileAvatarFallback]}>
                    <Ionicons name="person" size={32} color={C.purpleLight} />
                  </View>
                )}
              </View>
              <Text style={styles.profileName}>{profileModal.name}</Text>
              <View style={styles.profileXpRow}>
                <Text style={styles.profileXpText}>⚡ {profileModal.xp} XP</Text>
                {profileModal.rating > 0 && (
                  <Text style={styles.profileRatingText}>⭐ {profileModal.rating.toFixed(1)}</Text>
                )}
              </View>
              <View style={styles.profileStatsRow}>
                <View style={styles.profileStat}>
                  <Text style={styles.profileStatVal}>{profileModal.ridesCompleted}</Text>
                  <Text style={styles.profileStatLabel}>{t("driverRide.profileRides")}</Text>
                </View>
              </View>
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
              <TouchableOpacity style={styles.profileCloseBtn} onPress={() => setProfileModal(null)}>
                <Text style={styles.profileCloseBtnText}>{t("common.close")}</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );

  // ── Ready-to-start state ──────────────────────────────────────────────────
  // Shown after accepting a passenger. The driver starts the drive from here.
  // Rendered before the offline check because accepting the last seat
  // auto-offlines the session server-side.
  if (readyRide) {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ width: 38 }} />
          <Text style={styles.headerTitle}>{t("driverInbox.readyTitle")}</Text>
          <View style={{ width: 38 }} />
        </View>
        {/* Live map — shows the passenger pickup (green) + drop-off (purple)
            streamed from the ride doc, so the driver sees exactly where the
            passenger is the moment they accept. */}
        <View style={styles.readyMapWrap}>
          <DriverRideMapView
            origin={{ latitude: readyRide.originLat, longitude: readyRide.originLng }}
            destination={{ latitude: readyRide.destinationLat, longitude: readyRide.destinationLng }}
            passengers={livePassengers}
            passengerPickups={livePickups}
            passengerDropoffs={liveDropoffs}
          />
        </View>

        <View style={styles.readyPanel}>
          <TouchableOpacity
            activeOpacity={readyRide.passengerId ? 0.75 : 1}
            disabled={!readyRide.passengerId}
            onPress={() =>
              readyRide.passengerId &&
              openPassengerProfile(readyRide.passengerId, readyRide.passengerName, readyRide.passengerAvatar)
            }
            style={styles.readyPassengerRow}
          >
            <Image
              source={{ uri: readyRide.passengerAvatar || AVATAR_FALLBACK }}
              style={styles.readyAvatarSm}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.readyName} numberOfLines={1}>
                {readyRide.passengerName ?? t("driverInbox.acceptedPassenger")}
              </Text>
              {readyRide.passengerId ? (
                <Text style={styles.viewProfileHint}>{t("driverInbox.viewProfile")}</Text>
              ) : null}
            </View>
          </TouchableOpacity>

          <View style={styles.readyRouteCard}>
            <View style={styles.routeRow}>
              <View style={styles.dotGreen} />
              <Text style={styles.routeText} numberOfLines={1}>{t("driverInbox.pickup")}</Text>
            </View>
            <View style={styles.routeLine} />
            <View style={styles.routeRow}>
              <View style={styles.dotPink} />
              <Text style={styles.routeText} numberOfLines={1}>{readyRide.destination}</Text>
            </View>
          </View>

          <Pressable onPress={handleStartDrive} disabled={starting} style={{ width: "100%" }}>
            <LinearGradient
              colors={["#059669", "#34d399"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.startBtn, starting && { opacity: 0.7 }]}
            >
              {starting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="navigate" size={18} color="#fff" />
                  <Text style={styles.startBtnText}>{t("driverInbox.startDrive")}</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>

          <TouchableOpacity onPress={() => setReadyRide(null)} style={styles.backLink} disabled={starting}>
            <Text style={styles.backLinkText}>{t("driverInbox.backToRequests")}</Text>
          </TouchableOpacity>
        </View>
        {profileModalEl}
      </View>
    );
  }

  // ── Offline state ─────────────────────────────────────────────────────────
  if (!sessionLoading && !isOnline) {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <LinearGradient colors={["#FD165A", "#8938D5"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.backBtnGrad}>
              <Ionicons name="arrow-back" size={18} color="#fff" />
            </LinearGradient>
          </Pressable>
          <Text style={styles.headerTitle}>{t("driverInbox.title")}</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={styles.offlineWrap}>
          <View style={styles.offlineIcon}>
            <Ionicons name="moon-outline" size={28} color={C.muted} />
          </View>
          <Text style={styles.offlineTitle}>{t("driverInbox.offlineTitle")}</Text>
          <Text style={styles.offlineSub}>{t("driverInbox.offlineSub")}</Text>
          <Pressable onPress={() => router.replace("/driveOnlineScreen")} style={{ marginTop: 18 }}>
            <LinearGradient colors={["#059669", "#34d399"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.goBtn}>
              <Ionicons name="radio-outline" size={18} color="#fff" />
              <Text style={styles.goBtnText}>{t("driveOnline.goOnline")}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    );
  }

  const renderItem = ({ item }: { item: ScoredRequest }) => {
    const rideKm = haversineKm(
      item.origin.latitude, item.origin.longitude,
      item.destinationCoords.latitude, item.destinationCoords.longitude,
    );
    const returnCents = calculateDriverEarningCents(rideKm, 1);
    return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <TouchableOpacity onPress={() => openPassengerProfile(item.passengerId, item.passengerName, item.passengerAvatar)} activeOpacity={0.75}>
          <Image source={{ uri: item.passengerAvatar || AVATAR_FALLBACK }} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <TouchableOpacity onPress={() => openPassengerProfile(item.passengerId, item.passengerName, item.passengerAvatar)} activeOpacity={0.75}>
            <Text style={styles.passengerName} numberOfLines={1}>{item.passengerName ?? t("rides.unknownDriver")}</Text>
            <Text style={styles.viewProfileHint}>{t("driverInbox.viewProfile")}</Text>
          </TouchableOpacity>
          <View style={styles.metaRow}>
            <View style={styles.chip}>
              <Ionicons name="people-outline" size={12} color={C.purpleLight} />
              <Text style={styles.chipText}>{item.seatsRequested}</Text>
            </View>
            <View style={[styles.chip, { backgroundColor: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.3)" }]}>
              <Ionicons name="cash-outline" size={12} color={C.gold} />
              <Text style={[styles.chipText, { color: C.gold }]}>{formatCentsAsDollars(returnCents)}</Text>
            </View>
            <View style={styles.chip}>
              <Ionicons name="navigate-outline" size={12} color={C.purpleLight} />
              <Text style={styles.chipText}>{rideKm.toFixed(1)} {t("createRide.maxDetourUnit")}</Text>
            </View>
            <View style={[styles.chip, { backgroundColor: "rgba(52,211,153,0.12)", borderColor: "rgba(52,211,153,0.3)" }]}>
              <Ionicons name="git-branch-outline" size={12} color={C.success} />
              <Text style={[styles.chipText, { color: C.success }]}>
                +{item.detourKm.toFixed(1)} {t("createRide.maxDetourUnit")}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Pickup → dropoff */}
      <View style={styles.routeBlock}>
        <View style={styles.routeRow}>
          <View style={styles.dotGreen} />
          <Text style={styles.routeText} numberOfLines={1}>{t("driverInbox.pickup")}</Text>
        </View>
        <View style={styles.routeLine} />
        <View style={styles.routeRow}>
          <View style={styles.dotPink} />
          <Text style={styles.routeText} numberOfLines={1}>{item.destination}</Text>
        </View>
      </View>

      <Pressable onPress={() => handleAccept(item)} disabled={accepting !== null}>
        <LinearGradient colors={["#059669", "#34d399"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={[styles.acceptBtn, accepting !== null && { opacity: 0.6 }]}>
          {accepting === item.id ? <ActivityIndicator color="#fff" size="small" /> : (
            <>
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={styles.acceptText}>{t("driverInbox.accept")}</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>
    </View>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <LinearGradient colors={["#FD165A", "#8938D5"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.backBtnGrad}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </LinearGradient>
        </Pressable>
        <Text style={styles.headerTitle}>{t("driverInbox.title")}</Text>
        <TouchableOpacity onPress={handleGoOffline} style={styles.offlineBtn}>
          <Text style={styles.offlineBtnText}>{t("driveOnline.goOffline")}</Text>
        </TouchableOpacity>
      </View>

      {/* Online status strip */}
      <View style={styles.statusStrip}>
        <View style={styles.onlineDot} />
        <Text style={styles.statusText} numberOfLines={1}>
          {t("driverInbox.headingTo")} {session?.destination ?? ""}
        </Text>
        {loading && <ActivityIndicator size="small" color={C.purpleLight} />}
      </View>

      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}>
              <Ionicons name="search-outline" size={26} color={C.purpleLight} />
            </View>
            <Text style={styles.emptyTitle}>{t("driverInbox.emptyTitle")}</Text>
            <Text style={styles.emptySub}>{t("driverInbox.emptySub")}</Text>
          </View>
        }
      />

      {/* Passenger Profile Modal */}
      {profileModalEl}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 56 : 20, paddingBottom: 14,
    backgroundColor: "rgba(8,8,16,0.97)", borderBottomWidth: 1, borderBottomColor: "rgba(137,56,213,0.20)",
  },
  backBtn: { borderRadius: 10, overflow: "hidden" },
  backBtnGrad: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: "700" },
  offlineBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: "rgba(248,113,113,0.1)", borderWidth: 1, borderColor: "rgba(248,113,113,0.3)",
  },
  offlineBtnText: { color: "#f87171", fontSize: 12, fontWeight: "700" },

  statusStrip: {
    flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: "rgba(52,211,153,0.06)", borderBottomWidth: 1, borderBottomColor: "rgba(52,211,153,0.15)",
  },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.success },
  statusText: { color: C.muted, fontSize: 13, flex: 1, fontWeight: "600" },

  card: {
    backgroundColor: C.surfaceAlt, borderRadius: 18, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 12, gap: 12,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: C.border },
  passengerName: { color: C.text, fontSize: 16, fontWeight: "700", marginBottom: 5 },
  metaRow: { flexDirection: "row", gap: 6 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(137,56,213,0.12)",
    borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  chipText: { color: C.purpleLight, fontSize: 12, fontWeight: "700" },

  routeBlock: {
    backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.borderFaint,
  },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  routeText: { color: C.text, fontSize: 14, flex: 1 },
  routeLine: { width: 2, height: 14, backgroundColor: C.border, marginLeft: 5, marginVertical: 3 },
  dotGreen: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.success, borderWidth: 2, borderColor: "rgba(52,211,153,0.3)" },
  dotPink: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.pink, borderWidth: 2, borderColor: "rgba(253,22,90,0.3)" },

  acceptBtn: { height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  acceptText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  emptyWrap: { alignItems: "center", paddingTop: 80, gap: 8 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(137,56,213,0.1)", borderWidth: 1, borderColor: C.border, marginBottom: 6,
  },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "700" },
  emptySub: { color: C.dim, fontSize: 13, textAlign: "center", paddingHorizontal: 40, lineHeight: 18 },

  // ── Ready-to-start ─────────────────────────────────────────────────────────
  readyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 8 },
  readyMapWrap: { flex: 1 },
  readyPanel: {
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, gap: 12,
    backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: C.border, marginTop: -24,
  },
  readyPassengerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  readyAvatarSm: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: C.border },
  readyAvatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: C.border, marginBottom: 6 },
  readyName: { color: C.text, fontSize: 20, fontWeight: "800", maxWidth: "100%" },
  readySub: { color: C.muted, fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 8 },
  readyRouteCard: {
    width: "100%", backgroundColor: C.surfaceAlt, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 18,
  },
  startBtn: {
    height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8,
    shadowColor: "#34d399", shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  startBtnText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  backLink: { paddingVertical: 14 },
  backLinkText: { color: C.muted, fontSize: 14, fontWeight: "600" },

  offlineWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  offlineIcon: {
    width: 70, height: 70, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderFaint, marginBottom: 14,
  },
  offlineTitle: { color: C.text, fontSize: 18, fontWeight: "800" },
  offlineSub: { color: C.muted, fontSize: 14, textAlign: "center", marginTop: 6, lineHeight: 20 },
  goBtn: { height: 52, borderRadius: 15, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 28 },
  goBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  viewProfileHint: { color: C.purpleLight, fontSize: 11, fontWeight: "500", marginTop: 1 },

  // ── Passenger profile modal ───────────────────────────────────────────────
  profileBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center", alignItems: "center", paddingHorizontal: 24,
  },
  profileSheet: {
    width: "100%", backgroundColor: "#13132a", borderRadius: 24,
    borderWidth: 1, borderColor: "rgba(137,56,213,0.3)", padding: 24,
    alignItems: "center", gap: 12,
  },
  profileLoadingWrap: { paddingVertical: 40, alignItems: "center" },
  profileAvatarWrap: { marginBottom: 4 },
  profileAvatar: { width: 80, height: 80, borderRadius: 40 },
  profileAvatarFallback: {
    backgroundColor: "rgba(137,56,213,0.15)", alignItems: "center", justifyContent: "center",
  },
  profileName: { color: C.text, fontSize: 18, fontWeight: "700", textAlign: "center" },
  profileXpRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  profileXpText: { color: "#a78bfa", fontSize: 13, fontWeight: "600" },
  profileRatingText: { color: C.gold, fontSize: 13, fontWeight: "600" },
  profileStatsRow: {
    flexDirection: "row", gap: 20,
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 10,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
    width: "100%", justifyContent: "center",
  },
  profileStat: { alignItems: "center", gap: 2 },
  profileStatVal: { color: C.text, fontSize: 18, fontWeight: "700" },
  profileStatLabel: { color: C.muted, fontSize: 11 },
  profileInfoList: { width: "100%", gap: 8 },
  profileInfoRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  profileInfoIcon: { fontSize: 15 },
  profileInfoText: { color: "#d1d5db", fontSize: 13, fontWeight: "500", flex: 1 },
  profileCloseBtn: {
    marginTop: 4, paddingVertical: 10, paddingHorizontal: 32, borderRadius: 12,
    borderWidth: 1, borderColor: "rgba(137,56,213,0.4)", backgroundColor: "rgba(137,56,213,0.1)",
  },
  profileCloseBtnText: { color: "#a78bfa", fontSize: 14, fontWeight: "600" },
});
