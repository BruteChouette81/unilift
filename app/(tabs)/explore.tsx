import DropdownSection from "@/components/dropdowns-sections";
import EventCard from "@/components/event-card";
import FavoriteRouteCard from "@/components/favorite-rides";
import RideCard, { RideCardSlected } from "@/components/ridecard";
import { PROMOTED_EVENTS } from "@/constants/events";
import {
  firestoreDocumentUrl,
  runtimeConfig,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { recommendRides } from "@/hooks/use-ride-recommendations";
import { enrollInFutureRide, fetchRides, geoSuggestion, requestToJoinRide, type LocationResult } from "@/services/rideServices";
import { extractFavoriteRoutes } from "@/services/userService";
import type { FavoriteRoute, Ride, ScoredRide, UserProfile } from "@/types/models";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
};

export async function geocodePlace(
  place: string,
): Promise<{ lat: number; lon: number } | null> {
  try {
    const url = `https://api.openrouteservice.org/geocode/search`;
    const response = await fetch(
      `${url}?api_key=${runtimeConfig.orsApiKey}&text=${encodeURIComponent(place)}&size=1`
    );
    if (!response.ok) {
      console.error("ORS error:", await response.text());
      return null;
    }
    const data = await response.json();
    if (
      !data.features ||
      data.features?.length === 0 ||
      !data.features[0].geometry
    ) {
      return null;
    }
    const [lon, lat] = data.features[0].geometry.coordinates;
    return { lat, lon };
  } catch (error) {
    console.error("Geocoding failed:", error);
    return null;
  }
}

export default function TabTwoScreen() {
  const [search, setSearch] = useState("");
  const suppressSuggestionsRef = useRef(false);
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const { user } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [rides, setRides] = useState<Ride[]>([]);
  const [favoriteRoutes, setFavoriteRoutes] = useState<FavoriteRoute[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const debouncedSearch = useDebouncedValue(search, 400);

  const [suggestions, setSuggestions] = useState<LocationResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<{
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null>(null);

  const radius = 10;

  function getBoundingBox(lat: number, lng: number) {
    const earthRadius = 6371;
    const latDelta = (radius / earthRadius) * (180 / Math.PI);
    const lngDelta =
      (radius / earthRadius) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);
    return {
      minLat: lat - latDelta,
      maxLat: lat + latDelta,
      minLng: lng - lngDelta,
      maxLng: lng + lngDelta,
    };
  }

  const handleSearch = (text: string) => {
    suppressSuggestionsRef.current = false;
    setSearch(text);
  };

  const onSelectSuggestion = (value: LocationResult) => {
    suppressSuggestionsRef.current = true;
    setSearch(value.displayName);
    setShowSuggestions(false);
    const box = getBoundingBox(parseFloat(value.lat), parseFloat(value.lon));
    setFilter(box);
  };

  const createDefaultUserProfile = useCallback(async (uid: string, token: string, email?: string | null) => {
    const url = withFirebaseApiKey(firestoreDocumentUrl("users", uid));
    const payload = {
      fields: {
        email: { stringValue: email ?? "" },
        xp: { integerValue: 0 },
        ratings: { integerValue: 0 },
        ratingWeigth: { integerValue: 0 },
        favorite: { arrayValue: { values: [] } },
        createdAt: { timestampValue: new Date().toISOString() },
      },
    };
    const res = await fetch(
      url + "?updateMask.fieldPaths=email&updateMask.fieldPaths=xp&updateMask.fieldPaths=ratings&updateMask.fieldPaths=ratingWeigth&updateMask.fieldPaths=favorite&updateMask.fieldPaths=createdAt",
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      const details = await res.text().catch(() => "");
      throw new Error(`Failed creating user profile (${res.status}): ${details}`);
    }
    return await res.json();
  }, []);

  const fetchUser = useCallback(async (uid: string, token?: string, email?: string | null) => {
    const url = withFirebaseApiKey(firestoreDocumentUrl("users", uid));
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        if (res.status === 404 && token) {
          return await createDefaultUserProfile(uid, token, email);
        }
        console.log("Failed to fetch user profile in explore:", res.status);
        return null;
      } else {
        const data = await res.json();
        console.log("Firestore user data:", JSON.stringify(data?.fields));
        return data;
      }
    } catch (err) {
      console.error(err);
      return null;
    }
  }, [createDefaultUserProfile]);

  const reloadData = useCallback(async (forceRidesFetch = false) => {
    const rideData = await fetchRides({ force: forceRidesFetch }).catch(() => []);
    setRides(rideData);
    console.log(user)
    if (!user) return;
    const token = await user.getIdToken().catch(() => null);
    console.log(token)

    const data = await fetchUser(user.uid, token ?? undefined, user.email).catch(() => null);
    const favs = extractFavoriteRoutes(data);
    setFavoriteRoutes(favs);
    const rawPrefs = (data?.fields?.preferences?.arrayValue?.values ?? []) as string[];
    setUserProfile({
      email: "", xp: 0, rating: 0, avatar: null, homeAddress: null,
      localisation: { latitude: null, longitude: null },
      ridesCompleted: 0,
      favorite: favs,
      preferences: rawPrefs,
    });
  }, [fetchUser, user]);

  useEffect(() => {
    void reloadData();
  }, [reloadData]);

  useEffect(() => {
    if (suppressSuggestionsRef.current) {
      suppressSuggestionsRef.current = false;
      return;
    }
    if (debouncedSearch.length < 3) {
      setShowSuggestions(false);
      setSuggestions([]);
      setIsLoadingSuggestions(false);
      return;
    }
    const controller = new AbortController();
    setIsLoadingSuggestions(true);
    geoSuggestion(debouncedSearch.trim(), controller.signal).then((results) => {
      setSuggestions(results);
      setShowSuggestions(true);
      setIsLoadingSuggestions(false);
    });
    return () => controller.abort();
  }, [debouncedSearch]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reloadData(true);
    setRefreshing(false);
  }, [reloadData]);

  const todayStr = new Date().toISOString().split("T")[0];

  const filteredRides = useMemo(
    () =>
      filter
        ? rides.filter(
            (ride) =>
              ride.destinationCoords.latitude >= filter.minLat &&
              ride.destinationCoords.latitude <= filter.maxLat &&
              ride.destinationCoords.longitude >= filter.minLng &&
              ride.destinationCoords.longitude <= filter.maxLng &&
              ride.status === "planned" &&
              ride.driverId !== user?.uid &&
              !ride.passengers.includes(user?.uid ?? ""),
          )
        : [],
    [filter, rides, user?.uid],
  );

  const scoredRides = useMemo((): ScoredRide[] => {
    if (!userProfile) return filteredRides as ScoredRide[];
    return recommendRides(filteredRides, userProfile);
  }, [filteredRides, userProfile]);

  // Split into live (today or no date) vs scheduled (future date)
  const liveRides = useMemo(
    () => scoredRides.filter((r) => !r.date || r.date.split("T")[0] <= todayStr),
    [scoredRides, todayStr],
  );
  const scheduledRides = useMemo(
    () => scoredRides.filter((r) => r.date && r.date.split("T")[0] > todayStr),
    [scoredRides, todayStr],
  );

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={C.purpleLight}
        />
      }
    >
      <View style={styles.content}>
        {/* ── Search Bar ──────────────────────────────────────────────────── */}
        <View style={styles.searchContainer}>
          <View style={styles.searchIconWrap}>
            <Text style={{fontSize: 14}}>🔍</Text>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder={t("explore.searchPlaceholder")}
            placeholderTextColor={C.dim}
            value={search}
            onChangeText={handleSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => { setSearch(""); setShowSuggestions(false); setSuggestions([]); setFilter(null); }}>
              <Text style={{fontSize: 16}}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Suggestions Dropdown ─────────────────────────────────────────── */}
        {showSuggestions && (
          <View style={styles.suggestionsContainer}>
            {isLoadingSuggestions ? (
              <View style={styles.suggestionLoadingRow}>
                <ActivityIndicator size="small" color={C.purpleLight} />
                <Text style={styles.suggestionLoadingText}>{t("explore.searching")}</Text>
              </View>
            ) : suggestions.length === 0 ? (
              <View style={styles.suggestionNoResults}>
                <Text style={{fontSize: 12}}>📍</Text>
                <Text style={styles.suggestionNoResultsText}>{t("explore.noLocations")}</Text>
              </View>
            ) : (
              suggestions.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  onPress={() => onSelectSuggestion(item)}
                  style={[
                    styles.suggestionItem,
                    index === suggestions.length - 1 && styles.suggestionItemLast,
                  ]}
                >
                  <View style={styles.suggestionIcon}>
                    <Text style={{fontSize: 11}}>📍</Text>
                  </View>
                  <Text style={styles.suggestionText} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* ── Favorite Routes ──────────────────────────────────────────────── */}
        <DropdownSection title={t("explore.favoriteRoutes")}>
          <View style={styles.rideList}>
            {favoriteRoutes && favoriteRoutes.length > 0 ? (
              favoriteRoutes.map((route: FavoriteRoute, index: number) => (
                <FavoriteRouteCard
                  key={index}
                  destination={route.destination}
                  onPress={() => {
                    onSelectSuggestion({
                      displayName: route.destination,
                      lat: route.destinationGeo.lat.toString(),
                      lon: route.destinationGeo.lon.toString(),
                    });
                  }}
                />
              ))
            ) : (
              <View style={styles.emptyFavorites}>
                <Text style={{fontSize: 16}}>⭐</Text>
                <Text style={styles.emptyFavoritesText}>{t("explore.noFavoriteRoutes")}</Text>
              </View>
            )}
          </View>
        </DropdownSection>

        {/* ── Hot Events Near You ──────────────────────────────────────────── */}
        <View style={styles.eventsSection}>
          <View style={styles.eventsSectionHeader}>
            <Text style={{fontSize: 13}}>🔥</Text>
            <Text style={styles.eventsSectionTitle}>{t("events.hotEventsNearYou")}</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.eventsScroll}
            contentContainerStyle={styles.eventsScrollContent}
          >
            {PROMOTED_EVENTS.map((ev) => (
              <EventCard
                key={ev.id}
                event={ev}
                onPress={() =>
                  onSelectSuggestion({
                    displayName: ev.venue,
                    lat: ev.lat.toString(),
                    lon: ev.lng.toString(),
                  })
                }
              />
            ))}
          </ScrollView>
        </View>

        {/* ── Ride Results / Empty State ───────────────────────────────────── */}
        {filter ? (
          <View style={styles.rideList}>
            {/* Selected ride card with Join/Enroll/Cancel */}
            {selectedRide && (() => {
              const isScheduled = !!(selectedRide.date && selectedRide.date.split("T")[0] > todayStr);
              return (
                <RideCardSlected
                  driverId={selectedRide.driverId}
                  driverName={selectedRide.driverName}
                  driverAvatar={selectedRide.driverAvatar}
                  rating={0}
                  destination={selectedRide.destination}
                  seatsAvailable={selectedRide.seatsAvailable}
                  time={selectedRide.time ?? ""}
                  origin={`${selectedRide.localisation.latitude.toFixed(3)}, ${selectedRide.localisation.longitude.toFixed(3)}`}
                  level={0}
                  scheduledDate={selectedRide.date}
                  isScheduled={isScheduled}
                  onPress={async () => {
                    try {
                      if (isScheduled) {
                        // Direct enrollment — no driver approval needed
                        await enrollInFutureRide(selectedRide.id);
                        setSelectedRide(null);
                        Alert.alert(
                          t("explore.enrolledTitle"),
                          t("explore.enrolledMsg"),
                        );
                      } else {
                        // Live ride — send join request, navigate to ride screen
                        const { status } = await Location.requestForegroundPermissionsAsync();
                        let userLocation = { latitude: 0, longitude: 0 };
                        if (status === "granted") {
                          const pos = await Location.getCurrentPositionAsync({});
                          userLocation = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
                        }
                        await requestToJoinRide(selectedRide.id, userLocation);
                        Alert.alert(t("explore.requestSent"), t("explore.requestSentMsg"));
                        router.push(
                          `/rideScreen?rideId=${selectedRide.id}&Originlat=${selectedRide.localisation.latitude}&OriginLng=${selectedRide.localisation.longitude}&DestinationLat=${selectedRide.destinationCoords.latitude}&DestinationLng=${selectedRide.destinationCoords.longitude}&pending=true`,
                        );
                      }
                    } catch (err: any) {
                      Alert.alert(t("explore.requestError"), err.message ?? t("explore.requestError"));
                    }
                  }}
                  onCancel={() => setSelectedRide(null)}
                />
              );
            })()}

            {/* Ride sections (hide when one is selected) */}
            {!selectedRide && (
              <>
                {/* Live rides */}
                {liveRides.length > 0 && (
                  <>
                    <View style={styles.sectionHeader}>
                      <View style={styles.liveDot} />
                      <Text style={styles.sectionTitle}>{t("explore.liveRides")}</Text>
                    </View>
                    {liveRides.map((ride) => (
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
                        scheduledDate={ride.date}
                        onPress={() => setSelectedRide(ride)}
                      />
                    ))}
                  </>
                )}

                {/* Scheduled rides */}
                {scheduledRides.length > 0 && (
                  <>
                    <View style={[styles.sectionHeader, { marginTop: liveRides.length > 0 ? 16 : 0 }]}>
                      <Text style={{fontSize: 13}}>📅</Text>
                      <Text style={styles.sectionTitle}>{t("explore.scheduledRides")}</Text>
                    </View>
                    {scheduledRides.map((ride) => (
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
                        scheduledDate={ride.date}
                        onPress={() => setSelectedRide(ride)}
                      />
                    ))}
                  </>
                )}

                {liveRides.length === 0 && scheduledRides.length === 0 && (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyIconWrap}>
                      <Text style={{fontSize: 24}}>🚗</Text>
                    </View>
                    <Text style={styles.emptyTitle}>{t("explore.noRidesFound")}</Text>
                    <Text style={styles.emptySubtext}>{t("explore.noRidesFoundSub")}</Text>
                  </View>
                )}
              </>
            )}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Text style={{fontSize: 24}}>🔍</Text>
            </View>
            <Text style={styles.emptyTitle}>{t("explore.whereToGo")}</Text>
            <Text style={styles.emptySubtext}>{t("explore.whereToGoSub")}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // ── Shell ─────────────────────────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 100,
  },

  // ── Search ────────────────────────────────────────────────────────────────
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    height: 50,
    marginBottom: 4,
    gap: 8,
  },
  searchIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: "rgba(224,154,247,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 15,
  },

  // ── Suggestions ───────────────────────────────────────────────────────────
  suggestionsContainer: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 6,
    marginBottom: 8,
    overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.borderFaint,
    gap: 10,
  },
  suggestionItemLast: {
    borderBottomWidth: 0,
  },
  suggestionIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: "rgba(224,154,247,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionText: {
    color: C.text,
    fontSize: 14,
    flex: 1,
  },
  suggestionLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 10,
  },
  suggestionLoadingText: {
    color: C.muted,
    fontSize: 13,
  },
  suggestionNoResults: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 10,
  },
  suggestionNoResultsText: {
    color: C.dim,
    fontSize: 13,
  },

  // ── Ride List ─────────────────────────────────────────────────────────────
  rideList: {
    gap: 10,
  },

  // ── Section Headers ───────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
    marginTop: 4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#34d399",
  },
  sectionTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  // ── Empty Favorites ───────────────────────────────────────────────────────
  emptyFavorites: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  emptyFavoritesText: {
    color: C.dim,
    fontSize: 13,
  },

  // ── Hot Events Section ────────────────────────────────────────────────────
  eventsSection: {
    marginTop: 16,
    marginBottom: 4,
  },
  eventsSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  eventsSectionTitle: {
    color: "#f3f4f6",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  eventsScroll: {
    marginHorizontal: -16,
  },
  eventsScrollContent: {
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 4,
  },

  // ── Empty State ───────────────────────────────────────────────────────────
  emptyState: {
    alignItems: "center",
    paddingVertical: 44,
    marginTop: 12,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderFaint,
    gap: 6,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "rgba(137,56,213,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: "700",
  },
  emptySubtext: {
    color: C.dim,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 32,
    lineHeight: 20,
  },
});
