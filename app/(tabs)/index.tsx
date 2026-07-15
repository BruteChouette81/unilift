import RideMapView from "@/components/mapview";
import { RequestLiftSheet } from "@/components/request-lift-sheet";
import WizardModal, { type WizardStep } from "@/components/wizard/wizard-modal";
import ProfileCompletionSheet from "@/components/profile-completion-sheet";
import { useProfileCompletion } from "@/hooks/use-profile-completion";
import { useFirstRun } from "@/hooks/use-first-run";
import HypeEventCard from "@/components/hype-event-card";
import SponsorCard from "@/components/sponsor-card";
import { type HypeEvent } from "@/constants/events";
import { type Sponsor } from "@/constants/sponsors";
import { isRideExpired } from "@/utils/ride-lifecycle";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { devAwareCurrentPosition } from "@/utils/dev-location";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type AppStateStatus,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  cleanupAbandonedStartedRide,
  cleanupExpiredRide,
  fetchRides,
  geoCode,
  geoSuggestion,
  type LocationResult,
} from "../../services/rideServices";

import { useActiveRide } from "@/context/ActiveRideContext";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchHistory } from "@/hooks/use-search-history";
import { useWallet } from "@/context/WalletContext";
import { createRideRequest } from "@/services/rideRequestService";
import { dispatchRideRequest, fetchAvailableDriverCount } from "@/services/driverSessionService";
import { fetchHypeEvents } from "@/services/eventService";
import { fetchSponsors } from "@/services/sponsorService";
import type { FavoriteRoute, LocationPoint, Ride } from "@/types/models";
import { ensurePaymentMethodOrAlert } from "@/utils/ensurePaymentMethod";
import { rideErrorMessage } from "@/utils/rideErrors";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { haversineKm } from "@/utils/matching/geometry";

type SuggestionKind = "geo" | "home" | "favorite" | "event" | "history";
type Suggestion = LocationResult & { kind: SuggestionKind };

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  blue:        "#FD165A",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  gold:        "#fbbf24",
  fire:        "#f97316",
};

// Hype (night) mode overrides — only the tokens that shift when Hype is toggled on.
const C_HYPE = {
  ...C,
  bg:          "#0a0014",
  surface:     "#150430",
  surfaceAlt:  "#1a0533",
  border:      "rgba(249, 115, 22, 0.35)",
  borderFaint: "rgba(249, 115, 22, 0.10)",
  purpleLight: "#f97316",
};

const HYPE_MODE_STORAGE_KEY = "unilift:hypeMode";


// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const [homeLoc, setHomeLoc] = useState<{ lat: number; lng: number } | undefined>();
  const [favoriteRoutes, setFavoriteRoutes] = useState<FavoriteRoute[]>([]);
  const [userLocation, setUserLocation] = useState<LocationPoint | null>(null);
  const { user } = useAuth();
  const { activeRide } = useActiveRide();
  const { hasPaymentMethod, loading: walletLoading } = useWallet();
  const { history: searchHistory, addToHistory, removeFromHistory } = useSearchHistory(user?.uid);
  const { t } = useLanguage();
  const { userData } = useUserProfile();
  const router = useRouter();
  const [rides, setRides] = useState<Ride[]>([]);

  // Profile-completion nudge: a ride request held while we encourage the user
  // to finish their profile. Shown at most once per app session.
  const [pendingRide, setPendingRide] = useState<{ place: string; dropoff: LocationPoint } | null>(null);
  const profileNudgeShown = useRef(false);
  const { completion: profileCompletion, ready: profileCompletionReady } = useProfileCompletion();

  // First-run wizard: explains how a passenger searches for a lift.
  const searchWizard = useFirstRun("home-search");
  const searchWizardSteps = useMemo<WizardStep[]>(() => [
    { icon: "search-outline",   title: t("wizard.home.step1Title"), highlight: t("wizard.home.step1Highlight"), body: t("wizard.home.step1Body") },
    { icon: "list-outline",     title: t("wizard.home.step2Title"), body: t("wizard.home.step2Body") },
    { icon: "flame-outline",    title: t("wizard.home.step3Title"), body: t("wizard.home.step3Body") },
    { icon: "map-outline",      title: t("wizard.home.step4Title"), body: t("wizard.home.step4Body") },
  ], [t]);

  // Hype-map events (Firestore-backed) + the tapped event's floating card.
  const [hypeEvents, setHypeEvents] = useState<HypeEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<HypeEvent | null>(null);

  // Sponsors (Firestore-backed) + the tapped sponsor's card. Always shown on the map.
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [selectedSponsor, setSelectedSponsor] = useState<Sponsor | null>(null);

  // Search + suggestions
  const [searchText, setSearchText] = useState("");
  const suppressSuggestionsRef = useRef(false);
  const debouncedSearch = useDebouncedValue(searchText, 700);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  // Hype mode: toggles the night-mode map style + reveals event markers
  const [hypeMode, setHypeMode] = useState(false);
  const theme = hypeMode ? C_HYPE : C;

  // Lift request sheet
  const [showLiftSheet, setShowLiftSheet] = useState(false);
  const [availableDrivers, setAvailableDrivers] = useState<number | undefined>(undefined);

  // Selected destination (drives the on-demand lift request)
  const [selectedPlace, setSelectedPlace] = useState("");
  const [selectedDropoff, setSelectedDropoff] = useState<LocationPoint | null>(null);

  // Sync home location + favorites from session cache (no Firestore fetch)
  useEffect(() => {
    if (!userData) return;
    setFavoriteRoutes(userData.favorite ?? []);
    const geocodeHome = async () => {
      if (!userData.homeAddress) { setHomeLoc(undefined); return; }
      // Use stored coordinates if available (saved from profile suggestions)
      if (userData.homeAddressCoords) {
        setHomeLoc({ lat: userData.homeAddressCoords.latitude, lng: userData.homeAddressCoords.longitude });
        return;
      }
      // Fallback: geocode the address string
      try {
        const geo = await geoCode(userData.homeAddress);
        if (geo) setHomeLoc({ lat: geo.latitude, lng: geo.longitude });
        else setHomeLoc(undefined);
      } catch { setHomeLoc(undefined); }
    };
    void geocodeHome();
  }, [userData?.homeAddress, userData?.favorite]);

  // Fetch GPS location once on mount
  useEffect(() => {
    const getLoc = async () => {
      try {
        const pos = await Location.getCurrentPositionAsync({});
        setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      } catch { /* GPS unavailable */ }
    };
    void getLoc();
  }, []);

  // Load Hype-map events once on mount.
  useEffect(() => {
    void fetchHypeEvents().then(setHypeEvents).catch(() => {});
  }, []);

  // Load sponsors once on mount.
  useEffect(() => {
    void fetchSponsors().then(setSponsors).catch(() => {});
  }, []);

  // Hydrate Hype mode from the last session (defaults to off, no flash).
  useEffect(() => {
    void AsyncStorage.getItem(HYPE_MODE_STORAGE_KEY).then((v) => {
      if (v === "1") setHypeMode(true);
    }).catch(() => {});
  }, []);

  const toggleHypeMode = () => {
    setHypeMode((prev) => {
      const next = !prev;
      void AsyncStorage.setItem(HYPE_MODE_STORAGE_KEY, next ? "1" : "0").catch(() => {});
      return next;
    });
  };

  const openLiftSheet = () => {
    // Reset to the pulsing placeholder; the live poll below fills it in for the
    // selected place.
    setAvailableDrivers(undefined);
    setShowLiftSheet(true);
  };

  // Live driver count — while the lift sheet is open, poll the backend which
  // mirrors dispatch matching (online live drives + active Ride Mode windows,
  // deduped, filtered by the selected destination). A raw driverSessions
  // listener would miss Ride Mode (offline) drivers entirely.
  useEffect(() => {
    if (!showLiftSheet || !selectedDropoff) return;
    let cancelled = false;
    const refresh = async () => {
      const count = await fetchAvailableDriverCount({
        origin: userLocation,
        destination: { lat: selectedDropoff.latitude, lng: selectedDropoff.longitude },
        seats: 1,
      });
      if (!cancelled) setAvailableDrivers(count);
    };
    void refresh();
    const interval = setInterval(refresh, 12000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showLiftSheet, selectedDropoff, userLocation]);

  // Tapping a place on the map or selecting a suggestion opens the passenger
  // lift request sheet. (Driving is initiated from notifications for now.)
  const rideSelect = (name: string, lat: number, lng: number) => {
    setSelectedPlace(name);
    setSelectedDropoff({ latitude: lat, longitude: lng });
    openLiftSheet();
  };

  const handleLiftRequest = () => {
    setShowLiftSheet(false);
    setAvailableDrivers(undefined);
    if (!selectedDropoff) return;
    void handleChoosePassengerWith(selectedPlace, selectedDropoff);
  };

  // ── Debounced geo-suggestion effect ──────────────────────────────────────
  useEffect(() => {
    if (suppressSuggestionsRef.current) {
      suppressSuggestionsRef.current = false;
      return;
    }
    const q = debouncedSearch.trim().toLowerCase();
    if (q.length < 1) {
      if (searchHistory.length > 0) {
        setSuggestions(
          searchHistory.map((h) => ({ displayName: h.displayName, lat: h.lat, lon: h.lon, kind: "history" as const })),
        );
        setShowSuggestions(true);
      } else {
        setShowSuggestions(false);
        setSuggestions([]);
      }
      setIsLoadingSuggestions(false);
      return;
    }

    // ── Local suggestions (home / favorites / events) ──────────────────────
    const local: Suggestion[] = [];

    // Home
    if (("home".startsWith(q) || "maison".startsWith(q)) && userData?.homeAddress) {
      local.push({
        displayName: userData.homeAddress,
        lat: String(userData.localisation?.latitude ?? 0),
        lon: String(userData.localisation?.longitude ?? 0),
        kind: "home",
      });
    }

    // Favorites
    for (const fav of favoriteRoutes) {
      if (fav.destination.toLowerCase().includes(q)) {
        local.push({
          displayName: fav.destination,
          lat: String(fav.destinationGeo.lat),
          lon: String(fav.destinationGeo.lon),
          kind: "favorite",
        });
      }
    }

    // Hype events
    for (const ev of hypeEvents) {
      if (
        ev.name.toLowerCase().includes(q) ||
        (ev.nameFr?.toLowerCase().includes(q) ?? false) ||
        ev.venue.toLowerCase().includes(q)
      ) {
        local.push({
          displayName: `${ev.name} — ${ev.venue}`,
          lat: String(ev.lat),
          lon: String(ev.lng),
          kind: "event",
        });
      }
    }

    // Show local-only results immediately (no spinner)
    if (local.length > 0 && q.length < 3) {
      setSuggestions(local);
      setShowSuggestions(true);
      setIsLoadingSuggestions(false);
      return;
    }

    // ── Geo suggestions ────────────────────────────────────────────────────
    if (q.length < 3) {
      setSuggestions(local);
      setShowSuggestions(local.length > 0);
      setIsLoadingSuggestions(false);
      return;
    }

    const controller = new AbortController();
    setIsLoadingSuggestions(true);
    geoSuggestion(debouncedSearch.trim(), controller.signal).then((results) => {
      const geo: Suggestion[] = results.map((r) => ({ ...r, kind: "geo" as const }));
      setSuggestions([...local, ...geo]);
      setShowSuggestions(local.length + geo.length > 0);
      setIsLoadingSuggestions(false);
    });
    return () => controller.abort();
  }, [debouncedSearch, favoriteRoutes, userData, searchHistory, hypeEvents]);

  // ── Search handlers ──────────────────────────────────────────────────────
  const handleSearchInput = (text: string) => {
    suppressSuggestionsRef.current = false;
    setSearchText(text);
  };

  const onSelectSuggestion = (item: Suggestion) => {
    Keyboard.dismiss();
    suppressSuggestionsRef.current = true;
    setSearchText(item.displayName);
    setShowSuggestions(false);
    setSelectedPlace(item.displayName);
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    const dropoff: LocationPoint = { latitude: lat, longitude: lon };
    setSelectedDropoff(dropoff);
    // Persist to history for non-ephemeral kinds (home/events change; only save real places)
    if (item.kind === "geo" || item.kind === "favorite" || item.kind === "history") {
      addToHistory({ displayName: item.displayName, lat: item.lat, lon: item.lon });
    }
    openLiftSheet();
  };

  const clearSearch = () => {
    setSearchText("");
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedDropoff(null);
  };

  // Posts the live ride request and waits for a driver to accept. Split out of
  // handleChoosePassengerWith so the profile-completion nudge can pause the
  // request and resume it here when the user picks "Later".
  const actuallyRequestRide = async (place: string, dropoff: LocationPoint) => {
    try {
      let origin = userLocation;
      if (!origin) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await devAwareCurrentPosition({ accuracy: Location.Accuracy.Balanced });
          origin = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        }
      }
      if (!origin) { Alert.alert(t("common.error"), t("home.locationUnavailable")); return; }

      const resjson = await createRideRequest({
        destination: place,
        destinationCoords: { lat: dropoff.latitude, lng: dropoff.longitude },
        origin,
        date: new Date().toISOString(),
        seatsRequested: 1,
      });
      const requestId = resjson.name.split("/").pop() ?? "";

      let notified = 0;
      try { notified = (await dispatchRideRequest(requestId)).notified; } catch { /* drivers may come online later */ }

      router.push(
        `/findingDriverScreen?requestId=${requestId}&destination=${encodeURIComponent(place)}&destLat=${dropoff.latitude}&destLng=${dropoff.longitude}&originLat=${origin.latitude}&originLng=${origin.longitude}&notified=${notified}`,
      );
    } catch (err) {
      Alert.alert(t("common.error"), rideErrorMessage(err, t));
    }
  };

  // Passenger requests a ride. Two gates run before the request goes out:
  //   1. Payment method — hard block (can't ride without a card).
  //   2. Profile completion — soft nudge, at most once per session. "Later"
  //      resumes the paused request via actuallyRequestRide.
  const handleChoosePassengerWith = async (place: string, dropoff: LocationPoint) => {
    if (!ensurePaymentMethodOrAlert(hasPaymentMethod, t, router, walletLoading)) return;

    if (profileCompletionReady && !profileCompletion.isComplete && !profileNudgeShown.current) {
      profileNudgeShown.current = true;
      setPendingRide({ place, dropoff });
      return;
    }

    await actuallyRequestRide(place, dropoff);
  };

  const syncRides = useRef(async () => {
    const ridelist = await fetchRides({ force: true }).catch(() => null);
    if (!ridelist) return;
    const uid = user?.uid || "";
    ridelist.forEach((ride: Ride) => {
      if (
        ride.passengers &&
        ride.passengers.includes(uid) &&
        ride.started &&
        ride.status === "started" &&
        // Don't re-push if this passenger was already dropped — their
        // rideScreen called clearActiveRide() which triggers this sync, but
        // Firestore already has droppedPassengers set at that point.
        !ride.droppedPassengers?.includes(uid)
      ) {
        router.push(
          `/rideScreen?rideId=${ride.id}&Originlat=${ride.localisation.latitude}&OriginLng=${ride.localisation.longitude}&DestinationLat=${ride.destinationCoords.latitude}&DestinationLng=${ride.destinationCoords.longitude}`,
        );
      }
    });
    setRides(ridelist);
  });

  useEffect(() => {
    syncRides.current = async () => {
      const ridelist = await fetchRides({ force: true }).catch(() => null);
      if (!ridelist) return;
      const uid = user?.uid || "";
      ridelist.forEach((ride: Ride) => {
        if (
          ride.passengers &&
          ride.passengers.includes(uid) &&
          ride.started &&
          ride.status === "started" &&
          !ride.droppedPassengers?.includes(uid)
        ) {
          router.push(
            `/rideScreen?rideId=${ride.id}&Originlat=${ride.localisation.latitude}&OriginLng=${ride.localisation.longitude}&DestinationLat=${ride.destinationCoords.latitude}&DestinationLng=${ride.destinationCoords.longitude}`,
          );
        }
      });
      setRides(ridelist);
    };
  }, [router, user?.uid]);

  useEffect(() => {
    // Suspend all ride polling while the user is in an active ride (driver or
    // passenger). syncRides calls router.push when it finds the user is a
    // passenger in a started ride — doing that while already on the rideScreen
    // pushes a duplicate fresh instance, which is the source of the visible
    // state-reset flash reported by users.
    if (activeRide) return;

    // Initial fetch
    void syncRides.current();

    // Background poll every 15 s — pauses automatically when app is backgrounded
    const intervalRef = { id: 0 as ReturnType<typeof setInterval> };

    const startPolling = () => {
      intervalRef.id = setInterval(() => void syncRides.current(), 15_000);
    };
    const stopPolling = () => clearInterval(intervalRef.id);

    startPolling();

    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        void syncRides.current(); // immediate refresh on foreground
        startPolling();
      } else {
        stopPolling();
      }
    });

    return () => {
      stopPolling();
      sub.remove();
    };
  }, [activeRide]);

  // Lazy cleanup of expired rides (3h past scheduled time for planned, 3h past start for abandoned)
  const cleanedUpRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = new Date();
    for (const ride of rides) {
      if (cleanedUpRef.current.has(ride.id)) continue;
      if (!isRideExpired(ride, now)) continue;
      cleanedUpRef.current.add(ride.id);
      if (ride.status === "started") {
        void cleanupAbandonedStartedRide(ride.id);
      } else if (ride.status === "planned") {
        void cleanupExpiredRide(ride.id);
      }
    }
  }, [rides]);

  const insets = useSafeAreaInsets();

  // Wait for the user profile to finish loading before mounting the map —
  // otherwise favorites/home arrive late and don't render until the user
  // touches the map. `userData === null` means still loading from Firestore;
  // once it's defined the favorite array may be empty (account has none),
  // which is fine — we render the map either way.
  const profileLoading = userData === null;

  if (profileLoading) {
    return (
      <View style={[styles.shell, styles.loadingShell]}>
        <LinearGradient
          colors={["#1e1b4b", "#0d1224"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.loadingCard}
        >
          <ActivityIndicator size="large" color={C.purpleLight} />
          <Text style={styles.loadingTitle}>{t("home.loadingTitle") || "Loading map"}</Text>
          <Text style={styles.loadingSub}>
            {t("home.loadingSub") || "Fetching your favorites and nearby rides…"}
          </Text>
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      {/* ── Full-screen Map ─────────────────────────────────────────────── */}
      <RideMapView
        onPlaceSelect={rideSelect}
        favorites={favoriteRoutes}
        homeLocalisation={homeLoc ?? { lat: 0, lng: 0 }}
        events={hypeMode ? hypeEvents : []}
        onEventSelect={setSelectedEvent}
        hypeMode={hypeMode}
        sponsors={sponsors}
        onSponsorSelect={setSelectedSponsor}
      />

      {/* ── Floating Search Bar ─────────────────────────────────────────── */}
      <View style={[styles.searchBarWrapper, { top: insets.top - 38 }]}>
        <BlurView
          intensity={70}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={[styles.searchBarBlur, hypeMode && styles.searchBarBlurHype]}
        >
          <View style={styles.searchBarInner}>
            <Ionicons name="search" size={20} color={theme.purpleLight} />
            <TextInput
              style={styles.searchInput}
              placeholder={t("home.searchPlaceholder") || "Where are you going?"}
              placeholderTextColor={C.muted}
              cursorColor={C.purpleLight}
              value={searchText}
              onChangeText={handleSearchInput}
              onFocus={() => {
                if (searchText.length === 0 && searchHistory.length > 0) {
                  setSuggestions(
                    searchHistory.map((h) => ({ displayName: h.displayName, lat: h.lat, lon: h.lon, kind: "history" as const })),
                  );
                  setShowSuggestions(true);
                }
              }}
            />
            {searchText.length > 0 && (
              <TouchableOpacity style={styles.searchFilterBtn} activeOpacity={0.7} onPress={clearSearch}>
                <Ionicons name="close" size={18} color={C.text} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.hypeToggleBtn, hypeMode && styles.hypeToggleBtnActive]}
              onPress={toggleHypeMode}
              activeOpacity={0.8}
            >
              <Ionicons name="flame" size={18} color={hypeMode ? C.fire : C.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.searchFilterBtn}
              onPress={searchWizard.replay}
              activeOpacity={0.7}
            >
              <Ionicons name="help-circle-outline" size={18} color={C.purpleLight} />
            </TouchableOpacity>
          </View>
        </BlurView>
      </View>

      {/* ── Suggestions Dropdown ───────────────────────────────────────────── */}
      {showSuggestions && (
        <View style={[styles.suggestionsDropdown, { top: insets.top - 38 + 64 }]}>
          <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.suggestionsBlur}>
            {isLoadingSuggestions ? (
              <View style={styles.suggestionRow}>
                <ActivityIndicator size="small" color={C.purpleLight} />
                <Text style={styles.suggestionLoadingText}>
                  {t("explore.searching") || "Searching..."}
                </Text>
              </View>
            ) : suggestions.length === 0 ? (
              <View style={styles.suggestionRow}>
                <Ionicons name="location-outline" size={14} color={C.muted} />
                <Text style={styles.suggestionNoResultText}>
                  {t("explore.noLocations") || "No locations found"}
                </Text>
              </View>
            ) : (
              suggestions.map((item, index) => {
                const isEvent    = item.kind === "event";
                const isFavorite = item.kind === "favorite";
                const isHome     = item.kind === "home";
                const isHistory  = item.kind === "history";
                const icon = isHome     ? "home"
                           : isFavorite ? "star"
                           : isEvent    ? "flame"
                           : isHistory  ? "time-outline"
                           : "location";
                const iconColor = isHome     ? "#60a5fa"
                                : isFavorite ? C.gold
                                : isEvent    ? "#f97316"
                                : isHistory  ? C.muted
                                : C.purpleLight;
                const rowStyle = isEvent
                  ? [styles.suggestionItem, { backgroundColor: "rgba(249,115,22,0.08)" }, index === suggestions.length - 1 && { borderBottomWidth: 0 }]
                  : [styles.suggestionItem, index === suggestions.length - 1 && { borderBottomWidth: 0 }];
                const textColor = isEvent ? "#fdba74" : C.text;
                const distKm =
                  userLocation !== null &&
                  !isNaN(parseFloat(item.lat)) && parseFloat(item.lat) !== 0 &&
                  !isNaN(parseFloat(item.lon)) && parseFloat(item.lon) !== 0
                    ? haversineKm(
                        { lat: userLocation.latitude, lng: userLocation.longitude },
                        { lat: parseFloat(item.lat), lng: parseFloat(item.lon) },
                      )
                    : null;
                const distLabel =
                  distKm === null ? null
                  : distKm < 1 ? `${Math.round(distKm * 1000)} m ${t("home.away")}`
                  : `${distKm.toFixed(1)} km ${t("home.away")}`;
                return (
                  <View key={index} style={rowStyle}>
                    <TouchableOpacity
                      style={[styles.suggestionRowTouchable, { alignItems: "flex-start" }]}
                      onPress={() => onSelectSuggestion(item)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={icon as any} size={14} color={iconColor} style={{ marginTop: 2 }} />
                      <View style={styles.suggestionTextGroup}>
                        <Text style={[styles.suggestionText, { color: textColor }]} numberOfLines={1}>
                          {item.displayName}
                        </Text>
                        {distLabel !== null && (
                          <Text style={styles.suggestionDistance}>{distLabel}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                    {isHistory && (
                      <TouchableOpacity
                        onPress={() => {
                          removeFromHistory(item.displayName);
                          setSuggestions((prev) => prev.filter((s) => s.displayName !== item.displayName));
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close" size={14} color={C.muted} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </BlurView>
        </View>
      )}

      {/* ── Request Lift Sheet ───────────────────────────────────────────── */}
      <RequestLiftSheet
        visible={showLiftSheet}
        onClose={() => { setShowLiftSheet(false); setAvailableDrivers(undefined); }}
        placeName={selectedPlace}
        availableDrivers={availableDrivers}
        onRequestLift={handleLiftRequest}
      />

      {/* ── Hype Event Card ──────────────────────────────────────────────── */}
      <HypeEventCard
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onAccess={(ev) => {
          // Tapping "Access event" continues with the normal lift process
          // (respects the passenger/driver role toggle).
          setSelectedEvent(null);
          rideSelect(ev.venue || ev.name, ev.lat, ev.lng);
        }}
      />

      <SponsorCard
        sponsor={selectedSponsor}
        onClose={() => setSelectedSponsor(null)}
        onHeadThere={(sp) => {
          // "Head there" continues with the normal lift process to the sponsor.
          setSelectedSponsor(null);
          rideSelect(sp.name, sp.lat, sp.lng);
        }}
      />

      <WizardModal
        visible={searchWizard.shouldShow}
        steps={searchWizardSteps}
        onDone={searchWizard.markSeen}
        finalLabel={t("wizard.home.finalCta")}
      />

      {/* Soft profile-completion nudge holding a pending ride request. */}
      <ProfileCompletionSheet
        visible={pendingRide !== null}
        completion={profileCompletion}
        onCompleteNow={() => {
          setPendingRide(null);
          router.push("/(tabs)/profile");
        }}
        onLater={() => {
          const ride = pendingRide;
          setPendingRide(null);
          if (ride) void actuallyRequestRide(ride.place, ride.dropoff);
        }}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: C.bg,
  },

  // ── Loading state (waiting for user profile) ───────────────────────────────
  loadingShell: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  loadingCard: {
    width: "100%",
    maxWidth: 360,
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    gap: 12,
  },
  loadingTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: "700",
    marginTop: 6,
  },
  loadingSub: {
    color: C.muted,
    fontSize: 13,
    textAlign: "center",
  },

  // ── Floating Search Bar ────────────────────────────────────────────────────
  searchBarWrapper: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 10,
  },
  searchBarBlur: {
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.30)",
  },
  searchBarBlurHype: {
    borderColor: "rgba(249, 115, 22, 0.45)",
  },
  searchBarInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    height: 56,
    gap: 10,
    backgroundColor: "rgba(10, 10, 22, 0.72)",
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: 0.2,
    padding: 0,
  },
  searchFilterBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(137, 56, 213, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  hypeToggleBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(249, 115, 22, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(249, 115, 22, 0.20)",
  },
  hypeToggleBtnActive: {
    backgroundColor: "rgba(249, 115, 22, 0.22)",
    borderColor: "rgba(249, 115, 22, 0.55)",
    shadowColor: "#f97316",
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },

  // ── Suggestions Dropdown ──────────────────────────────────────────────────
  suggestionsDropdown: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9,
  },
  suggestionsBlur: {
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.30)",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 10,
    backgroundColor: "rgba(10, 10, 22, 0.88)",
  },
  suggestionLoadingText: {
    color: C.muted,
    fontSize: 13,
  },
  suggestionNoResultText: {
    color: C.dim,
    fontSize: 13,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(137, 56, 213, 0.12)",
    gap: 10,
    backgroundColor: "rgba(10, 10, 22, 0.88)",
  },
  suggestionRowTouchable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  suggestionText: {
    color: C.text,
    fontSize: 14,
  },
  suggestionTextGroup: {
    flex: 1,
    gap: 2,
  },
  suggestionDistance: {
    color: C.muted,
    fontSize: 12,
    fontWeight: "400",
  },

  // ── Modal ─────────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    height: "90%",
    backgroundColor: "rgba(8,8,16,0.97)",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "rgba(137,56,213,0.30)",
    overflow: "hidden",
    marginBottom: 0,
  },
  modalHeader: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(137,56,213,0.15)",
    backgroundColor: "rgba(137,56,213,0.06)",
  },
  modalDragZone: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 14,
  },
  modalHandle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(137,56,213,0.45)",
  },
  modalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
  },
  modalLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  modalTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: "700",
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 16,
    gap: 14,
  },
  modalEmptyState: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 10,
  },
  modalEmptyTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: "700",
  },
  modalEmptySubtext: {
    color: C.dim,
    fontSize: 13,
    textAlign: "center",
  },

  // ── Section headers ──────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(137,56,213,0.08)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.18)",
    alignSelf: "flex-start",
  },
  sectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#34d399",
  },
  sectionTitle: {
    color: C.purpleLight,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  // ── Seat stepper (modal) ────────────────────────────────────────────────
  seatStepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(137,56,213,0.08)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.28)",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  seatStepperLabel: {
    color: C.muted,
    fontSize: 13,
    fontWeight: "600",
  },

  // ── Passenger filter card (inside modal) ─────────────────────────────────
  filterCard: {
    backgroundColor: "rgba(137,56,213,0.06)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.22)",
    padding: 14,
    gap: 10,
  },
  filterTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  filterTitleText: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  filterResetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(137,56,213,0.15)",
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.30)",
  },
  filterResetText: {
    color: C.purpleLight,
    fontSize: 11,
    fontWeight: "600",
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(137,56,213,0.10)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.28)",
  },
  filterChipText: {
    color: C.purpleLight,
    fontSize: 12,
    fontWeight: "600",
  },
  filterStepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(137,56,213,0.10)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.28)",
    flex: 1,
  },
  filterStepperBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: "rgba(137,56,213,0.25)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.40)",
  },
  filterStepperBtnText: {
    color: C.purpleLight,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  filterStepperValue: {
    color: C.text,
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
    textAlign: "center",
  },
  filterSlider: {
    width: "100%",
    height: 32,
  },
  leavingAtDone: {
    marginTop: 8,
    alignSelf: "flex-end",
    backgroundColor: C.purple,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  leavingAtDoneText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(137, 56, 213, 0.25)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.40)",
  },
  stepperBtnText: {
    color: C.purpleLight,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 20,
  },
  stepperValue: {
    color: C.text,
    fontSize: 15,
    fontWeight: "700",
    minWidth: 20,
    textAlign: "center",
  },
});
