import RideMapView from "@/components/mapview";
import RideCard, { RideCardSlected } from "@/components/ridecard";
import { PROMOTED_EVENTS } from "@/constants/events";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  acceptRide,
  fetchRides,
  geoCode,
  geoSuggestion,
  requestToJoinRide,
  type LocationResult,
} from "../../services/rideServices";

import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import Slider from "@react-native-community/slider";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { recommendRides, type RecommendOptions } from "@/hooks/use-ride-recommendations";
import type { FavoriteRoute, LocationPoint, Ride, ScoredRide } from "@/types/models";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

type SuggestionKind = "geo" | "home" | "favorite" | "event";
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
};

const BUTTON_GRADIENT = ["#FD165A", "#8938D5"] as const;

function getBoundingBox(lat: number, lng: number, radius: number) {
  const earthRadius = 6371;
  const latDelta = (radius / earthRadius) * (180 / Math.PI);
  const lngDelta =
    ((radius / earthRadius) * (180 / Math.PI)) / Math.cos((lat * Math.PI) / 180);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const [selectedRide, setSelectedRide] = useState<any>();
  const [homeLoc, setHomeLoc] = useState<{ lat: number; lng: number } | undefined>();
  const [filter, setFilter] = useState<{
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  }>();
  const [favoriteRoutes, setFavoriteRoutes] = useState<FavoriteRoute[]>([]);
  const [userLocation, setUserLocation] = useState<LocationPoint | null>(null);
  const { user } = useAuth();
  const { t } = useLanguage();
  const { userData } = useUserProfile();
  const router = useRouter();
  const [rides, setRides] = useState<Ride[]>([]);

  // Search + suggestions
  const [searchText, setSearchText] = useState("");
  const suppressSuggestionsRef = useRef(false);
  const debouncedSearch = useDebouncedValue(searchText, 400);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  // Search settings (session-only, not persisted)
  const [showSettings, setShowSettings] = useState(false);
  const [searchRadius, setSearchRadius] = useState(10);
  const [minSeats, setMinSeats] = useState(1);
  const [maxBudget, setMaxBudget] = useState(50);
  // Recommendation weights (kept as state for the algorithm, not shown in UI)
  const [wDistance] = useState(35);
  const [wTime] = useState(30);
  const [wDirection] = useState(25);

  // Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState("");
  const [modalSelectedRide, setModalSelectedRide] = useState<ScoredRide | null>(null);

  const acceptARide = (id: string, started: boolean) => {
    acceptRide(id).then(() => {
      if (started) {
        Alert.alert(t("home.rideAccepted"), t("home.rideStartNow"));
        router.push(
          `/rideScreen?rideId=${id}&Originlat=${selectedRide?.localisation?.latitude}&OriginLng=${selectedRide?.localisation?.longitude}&DestinationLat=${selectedRide?.destinationCoords?.latitude}&DestinationLng=${selectedRide?.destinationCoords?.longitude}`,
        );
      } else {
        Alert.alert(t("home.rideAccepted"), t("home.rideDriverReady"));
      }
    });
  };

  // Sync home location + favorites from session cache (no Firestore fetch)
  useEffect(() => {
    if (!userData) return;
    setFavoriteRoutes(userData.favorite ?? []);
    const geocodeHome = async () => {
      if (!userData.homeAddress) { setHomeLoc({ lat: 0, lng: 0 }); return; }
      try {
        const geo = await geoCode(JSON.stringify(userData.homeAddress));
        setHomeLoc({ lat: geo?.latitude ?? 0, lng: geo?.longitude ?? 0 });
      } catch { setHomeLoc({ lat: 0, lng: 0 }); }
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

  const rideSelect = (name: string, lat: number, lng: number) => {
    setModalSelectedRide(null);
    setSelectedPlace(name);
    setFilter(getBoundingBox(lat, lng, searchRadius));
    setModalVisible(true);
  };

  // ── Debounced geo-suggestion effect ──────────────────────────────────────
  useEffect(() => {
    if (suppressSuggestionsRef.current) {
      suppressSuggestionsRef.current = false;
      return;
    }
    const q = debouncedSearch.trim().toLowerCase();
    if (q.length < 1) {
      setShowSuggestions(false);
      setSuggestions([]);
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

    // Events
    for (const ev of PROMOTED_EVENTS) {
      if (ev.name.toLowerCase().includes(q) || ev.nameFr.toLowerCase().includes(q) || ev.venue.toLowerCase().includes(q)) {
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
  }, [debouncedSearch, favoriteRoutes, userData]);

  // ── Search handlers ──────────────────────────────────────────────────────
  const handleSearchInput = (text: string) => {
    suppressSuggestionsRef.current = false;
    if (text.length > 0) setShowSettings(false);
    setSearchText(text);
  };

  const onSelectSuggestion = (item: Suggestion) => {
    Keyboard.dismiss();
    suppressSuggestionsRef.current = true;
    setSearchText(item.displayName);
    setShowSuggestions(false);
    setSelectedPlace(item.displayName);
    setModalSelectedRide(null);
    const box = getBoundingBox(parseFloat(item.lat), parseFloat(item.lon), searchRadius);
    setFilter(box);
    setModalVisible(true);
  };

  const clearSearch = () => {
    setSearchText("");
    setShowSuggestions(false);
    setSuggestions([]);
    setFilter(undefined);
    setModalVisible(false);
    setModalSelectedRide(null);
  };

  useEffect(() => {
    fetchRides()
      .then((ridelist) => {
        ridelist?.forEach((ride: Ride & { passengerIds?: string[] }) => {
          if (
            ride.passengerIds &&
            ride.passengerIds.includes(user?.uid || "") &&
            ride.started &&
            ride.status === "planned"
          ) {
            router.push(
              `/rideScreen?rideId=${ride.id}&Originlat=${ride.localisation.latitude}&OriginLng=${ride.localisation.longitude}&DestinationLat=${ride.destinationCoords.latitude}&DestinationLng=${ride.destinationCoords.longitude}`,
            );
          }
        });
        setRides(ridelist);
      })
      .catch(console.error);
  }, [router, user?.uid]);

  const filteredRides = useMemo(() => {
    if (!filter) return [];
    return rides.filter(
      (ride) =>
        ride.destinationCoords.latitude  >= filter.minLat &&
        ride.destinationCoords.latitude  <= filter.maxLat &&
        ride.destinationCoords.longitude >= filter.minLng &&
        ride.destinationCoords.longitude <= filter.maxLng &&
        ride.status === "planned" &&
        ride.seatsAvailable >= minSeats,
    );
  }, [filter, rides]);

  const normalizedWeights = useMemo((): RecommendOptions["weights"] => {
    const preference = Math.max(0, 100 - wDistance - wTime - wDirection);
    const sum = wDistance + wTime + wDirection + preference;
    return {
      distance:   wDistance   / sum,
      time:       wTime       / sum,
      direction:  wDirection  / sum,
      preference: preference  / sum,
    };
  }, [wDistance, wTime, wDirection]);

  const scoredRides = useMemo((): ScoredRide[] => {
    const profile = {
      email: "", xp: 0, rating: 0, avatar: null as null, homeAddress: null as null,
      localisation: userLocation ?? { latitude: null, longitude: null },
      ridesCompleted: 0,
      favorite: favoriteRoutes,
    };
    return recommendRides(filteredRides, profile, { weights: normalizedWeights });
  }, [filteredRides, favoriteRoutes, userLocation, normalizedWeights]);

  const insets = useSafeAreaInsets();

  const swipePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 40 || gs.vy > 0.3) setModalVisible(false);
      },
    }),
  ).current;

  return (
    <View style={styles.shell}>
      {/* ── Full-screen Map ─────────────────────────────────────────────── */}
      <RideMapView
        onPlaceSelect={rideSelect}
        favorites={favoriteRoutes}
        homeLocalisation={homeLoc ?? { lat: 0, lng: 0 }}
        promotedEvents={PROMOTED_EVENTS}
      />

      {/* ── Floating Search Bar ─────────────────────────────────────────── */}
      <View style={[styles.searchBarWrapper, { top: insets.top - 38 }]}>
        <BlurView
          intensity={60}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={styles.searchBarBlur}
        >
          <View style={styles.searchBarInner}>
            <Ionicons name="search" size={20} color={C.purpleLight} />
            <TextInput
              style={styles.searchInput}
              placeholder={t("home.searchPlaceholder") || "Where are you going?"}
              placeholderTextColor={C.muted}
              cursorColor={C.purpleLight}
              value={searchText}
              onChangeText={handleSearchInput}
            />
            {searchText.length > 0 ? (
              <TouchableOpacity style={styles.searchFilterBtn} activeOpacity={0.7} onPress={clearSearch}>
                <Ionicons name="close" size={18} color={C.text} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.searchFilterBtn,
                  (showSettings || searchRadius !== 10 || minSeats !== 1 || maxBudget !== 50)
                    && { backgroundColor: "rgba(137, 56, 213, 0.45)" },
                ]}
                activeOpacity={0.7}
                onPress={() => setShowSettings((v) => !v)}
              >
                <Ionicons name="options-outline" size={18} color={showSettings ? C.purpleLight : C.text} />
              </TouchableOpacity>
            )}
          </View>
        </BlurView>
      </View>

      {/* ── Search Settings Panel ─────────────────────────────────────────── */}
      {showSettings && (
        <View style={[styles.settingsPanel, { top: insets.top - 38 + 58 }]}>
          <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.settingsBlur}>
            <View style={styles.settingsInner}>
              {/* Title row */}
              <View style={styles.settingsTitleRow}>
                <Text style={styles.settingsTitleText}>{t("searchSettings.title")}</Text>
                <TouchableOpacity
                  onPress={() => { setSearchRadius(10); setMinSeats(1); setMaxBudget(50); }}
                  style={styles.settingsResetBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.settingsResetText}>{t("searchSettings.reset")}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.settingsDivider} />

              {/* Search radius */}
              <View style={styles.settingsSection}>
                <View style={styles.settingsLabelRow}>
                  <Text style={styles.settingsLabel}>{t("searchSettings.radius")}</Text>
                  <Text style={styles.settingsValue}>{searchRadius} km</Text>
                </View>
                <Slider
                  style={styles.settingsSlider}
                  minimumValue={1}
                  maximumValue={50}
                  step={1}
                  value={searchRadius}
                  onValueChange={setSearchRadius}
                  minimumTrackTintColor={C.purple}
                  maximumTrackTintColor={C.dim}
                  thumbTintColor={C.purpleLight}
                />
              </View>

              <View style={styles.settingsDivider} />

              {/* Number of people stepper */}
              <View style={styles.settingsSection}>
                <View style={styles.settingsLabelRow}>
                  <Text style={styles.settingsLabel}>{t("searchSettings.people")}</Text>
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => setMinSeats((v) => Math.max(1, v - 1))}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.stepperBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{minSeats}</Text>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => setMinSeats((v) => Math.min(6, v + 1))}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.stepperBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <View style={styles.settingsDivider} />

              {/* Max budget slider */}
              <View style={styles.settingsSection}>
                <View style={styles.settingsLabelRow}>
                  <Text style={styles.settingsLabel}>{t("searchSettings.budget")}</Text>
                  <Text style={styles.settingsValue}>
                    {maxBudget >= 100 ? t("searchSettings.anyBudget") : `$${maxBudget}`}
                  </Text>
                </View>
                <Slider
                  style={styles.settingsSlider}
                  minimumValue={5}
                  maximumValue={100}
                  step={5}
                  value={maxBudget}
                  onValueChange={setMaxBudget}
                  minimumTrackTintColor={C.purple}
                  maximumTrackTintColor={C.dim}
                  thumbTintColor={C.purpleLight}
                />
              </View>
            </View>
          </BlurView>
        </View>
      )}

      {/* ── Suggestions Dropdown ───────────────────────────────────────────── */}
      {showSuggestions && (
        <View style={[styles.suggestionsDropdown, { top: insets.top - 38 + 58 }]}>
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
                const icon = isHome     ? "home"
                           : isFavorite ? "star"
                           : isEvent    ? "flame"
                           : "location";
                const iconColor = isHome     ? "#60a5fa"
                                : isFavorite ? C.gold
                                : isEvent    ? "#f97316"
                                : C.purpleLight;
                const rowStyle = isEvent
                  ? [styles.suggestionItem, { backgroundColor: "rgba(249,115,22,0.08)" }, index === suggestions.length - 1 && { borderBottomWidth: 0 }]
                  : [styles.suggestionItem, index === suggestions.length - 1 && { borderBottomWidth: 0 }];
                const textColor = isEvent ? "#fdba74" : C.text;
                return (
                  <TouchableOpacity
                    key={index}
                    onPress={() => onSelectSuggestion(item)}
                    style={rowStyle}
                  >
                    <Ionicons name={icon as any} size={14} color={iconColor} />
                    <Text style={[styles.suggestionText, { color: textColor }]} numberOfLines={1}>
                      {item.displayName}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </BlurView>
        </View>
      )}

      {/* ── Floating Action Button ───────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.floatingButton}
        onPress={() => router.push("/createRideScreen")}
        activeOpacity={0.85}
      >
        <LinearGradient
          colors={BUTTON_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.floatingBtnGrad}
        >
          <Text style={{fontSize: 18}}>➕</Text>
          <Text style={styles.floatingButtonText}>{t("home.startNewRide")}</Text>
        </LinearGradient>
      </TouchableOpacity>
      {/* ── Rides Modal ────────────────────────────────────────────────────── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalDragZone} {...swipePanResponder.panHandlers}>
                <View style={styles.modalHandle} />
              </View>
              <View style={styles.modalTitleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalLabel}>
                    {t("home.ridesTo") || "Rides to"}
                  </Text>
                  <Text style={styles.modalTitle} numberOfLines={2}>
                    {selectedPlace}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setModalVisible(false)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={22} color={C.text} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Ride list */}
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {modalSelectedRide ? (
                <RideCardSlected
                  driverId={modalSelectedRide.driverId}
                  driverName={modalSelectedRide.driverName}
                  driverAvatar={modalSelectedRide.driverAvatar}
                  rating={0}
                  destination={modalSelectedRide.destination}
                  seatsAvailable={modalSelectedRide.seatsAvailable}
                  time={modalSelectedRide.time ?? ""}
                  origin={`${modalSelectedRide.localisation.latitude.toFixed(3)}, ${modalSelectedRide.localisation.longitude.toFixed(3)}`}
                  level={0}
                  onPress={async () => {
                    try {
                      let loc = { latitude: 0, longitude: 0 };
                      const { status } = await Location.requestForegroundPermissionsAsync();
                      if (status === "granted") {
                        const pos = await Location.getCurrentPositionAsync({});
                        loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
                      }
                      await requestToJoinRide(modalSelectedRide.id, loc);
                      Alert.alert(
                        t("explore.requestSent") || "Request Sent",
                        t("explore.requestSentMsg") || "Your request has been sent.",
                      );
                      setModalVisible(false);
                      router.push(
                        `/rideScreen?rideId=${modalSelectedRide.id}&Originlat=${modalSelectedRide.localisation.latitude}&OriginLng=${modalSelectedRide.localisation.longitude}&DestinationLat=${modalSelectedRide.destinationCoords.latitude}&DestinationLng=${modalSelectedRide.destinationCoords.longitude}&pending=true`,
                      );
                    } catch (err: any) {
                      Alert.alert("Error", err.message ?? "Could not join ride");
                    }
                  }}
                  onCancel={() => setModalSelectedRide(null)}
                />
              ) : scoredRides.length > 0 ? (
                scoredRides.map((ride) => (
                  <RideCard
                    key={ride.id}
                    driverId={ride.driverId}
                    driverName={ride.driverName}
                    driverAvatar={ride.driverAvatar}
                    rating={0}
                    level={0}
                    destination={ride.destination}
                    seatsAvailable={ride.seatsAvailable}
                    time={ride.time ?? ""}
                    origin={`${ride.localisation.latitude.toFixed(3)}, ${ride.localisation.longitude.toFixed(3)}`}
                    onPress={() => setModalSelectedRide(ride)}
                  />
                ))
              ) : (
                <View style={styles.modalEmptyState}>
                  <Ionicons name="car-outline" size={32} color={C.muted} />
                  <Text style={styles.modalEmptyTitle}>
                    {t("explore.noRidesFound") || "No rides found"}
                  </Text>
                  <Text style={styles.modalEmptySubtext}>
                    {t("explore.noRidesFoundSub") || "Try a different destination"}
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: C.bg,
  },

  // ── Floating Search Bar ────────────────────────────────────────────────────
  searchBarWrapper: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 10,
  },
  searchBarBlur: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.25)",
  },
  searchBarInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 10,
    gap: 10,
    backgroundColor: "rgba(15, 15, 30, 0.55)",
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

  // ── Suggestions Dropdown ──────────────────────────────────────────────────
  suggestionsDropdown: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9,
  },
  suggestionsBlur: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.25)",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 10,
    backgroundColor: "rgba(15, 15, 30, 0.85)",
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
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
    gap: 10,
    backgroundColor: "rgba(15, 15, 30, 0.85)",
  },
  suggestionText: {
    color: C.text,
    fontSize: 14,
    flex: 1,
  },

  // ── Modal ─────────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    height: "90%",
    backgroundColor: C.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: C.border,
    overflow: "hidden",
  },
  modalHeader: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
    backgroundColor: C.surface,
  },
  modalDragZone: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 12,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.dim,
  },
  modalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
  },
  modalLabel: {
    color: C.muted,
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.5,
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
    backgroundColor: "rgba(137, 56, 213, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 40,
  },
  modalEmptyState: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 8,
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

  // ── Search Settings Panel ─────────────────────────────────────────────────
  settingsPanel: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9,
  },
  settingsBlur: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.25)",
  },
  settingsInner: {
    backgroundColor: "rgba(15, 15, 30, 0.85)",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingsTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  settingsTitleText: {
    color: C.text,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  settingsResetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(137, 56, 213, 0.18)",
  },
  settingsResetText: {
    color: C.purpleLight,
    fontSize: 12,
    fontWeight: "600",
  },
  settingsDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    marginBottom: 12,
  },
  settingsSection: {
    marginBottom: 10,
  },
  settingsLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  settingsLabel: {
    color: C.muted,
    fontSize: 13,
    fontWeight: "500",
  },
  settingsValue: {
    color: C.purpleLight,
    fontSize: 13,
    fontWeight: "600",
  },
  settingsSlider: {
    width: "100%",
    height: 36,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(137, 56, 213, 0.25)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.4)",
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

  // ── Floating Button ────────────────────────────────────────────────────────
  floatingButton: {
    position: "absolute",
    bottom: 30,
    left: 20,
    right: 20,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: C.purple,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  floatingBtnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
  },
  floatingButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
