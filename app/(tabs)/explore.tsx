import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import DropdownSection from "@/components/dropdowns-sections";
import FavoriteRouteCard from "@/components/favorite-rides";
import RideCard from "@/components/ridecard";
import { useAuth } from "@/context/AuthContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fetchRides, geoSuggestion, type LocationResult } from "@/services/rideServices";
import { extractFavoriteRoutes } from "@/services/userService";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { recommendRides } from "@/hooks/use-ride-recommendations";
import type { FavoriteRoute, Ride, ScoredRide, UserProfile } from "@/types/models";
import {
  firestoreDocumentUrl,
  runtimeConfig,
  withFirebaseApiKey,
} from "@/constants/runtime-config";

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(124, 58, 237, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#7C3AED",
  purpleLight: "#a78bfa",
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
  const { user } = useAuth();
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
    setSearch(text);
  };

  const onSelectSuggestion = (value: LocationResult) => {
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
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
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
        console.log("Firestore user data:", JSON.stringify(data?.fields?.favorite));
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
    if (!user) return;
    const token = await user.getIdToken().catch(() => null);
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

  const filteredRides = useMemo(
    () =>
      filter
        ? rides.filter(
            (ride) =>
              ride.destinationCoords.latitude >= filter.minLat &&
              ride.destinationCoords.latitude <= filter.maxLat &&
              ride.destinationCoords.longitude >= filter.minLng &&
              ride.destinationCoords.longitude <= filter.maxLng &&
              ride.status === "planned",
          )
        : [],
    [filter, rides],
  );

  const scoredRides = useMemo((): ScoredRide[] => {
    if (!userProfile) return filteredRides as ScoredRide[];
    return recommendRides(filteredRides, userProfile);
  }, [filteredRides, userProfile]);

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
            <Ionicons name="search" size={16} color={C.purpleLight} />
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Search rides by destination…"
            placeholderTextColor={C.dim}
            value={search}
            onChangeText={handleSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => { setSearch(""); setShowSuggestions(false); setSuggestions([]); setFilter(null); }}>
              <Ionicons name="close-circle" size={18} color={C.dim} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Suggestions Dropdown ─────────────────────────────────────────── */}
        {showSuggestions && (
          <View style={styles.suggestionsContainer}>
            {isLoadingSuggestions ? (
              <View style={styles.suggestionLoadingRow}>
                <ActivityIndicator size="small" color={C.purpleLight} />
                <Text style={styles.suggestionLoadingText}>Searching…</Text>
              </View>
            ) : suggestions.length === 0 ? (
              <View style={styles.suggestionNoResults}>
                <Ionicons name="location-outline" size={14} color={C.dim} />
                <Text style={styles.suggestionNoResultsText}>No locations found in North America.</Text>
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
                    <Ionicons name="location-outline" size={13} color={C.purpleLight} />
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
        <DropdownSection title="⭐ Favorite Routes">
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
                <Ionicons name="star-outline" size={18} color={C.dim} />
                <Text style={styles.emptyFavoritesText}>No favorite routes yet.</Text>
              </View>
            )}
          </View>
        </DropdownSection>

        {/* ── Ride Results / Empty State ───────────────────────────────────── */}
        {filter ? (
          <View style={styles.rideList}>
            {scoredRides.map((ride) => (
              <RideCard
                key={ride.id}
                {...ride}
                rating={0}
                level={0}
                time={ride.time ?? ""}
                origin={`${ride.localisation.latitude.toFixed(3)}, ${ride.localisation.longitude.toFixed(3)}`}
                onPress={() => {}}
              />
            ))}
            {scoredRides.length === 0 && (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="car-outline" size={26} color={C.purple} />
                </View>
                <Text style={styles.emptyTitle}>No rides found</Text>
                <Text style={styles.emptySubtext}>
                  No planned rides to this destination right now.
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="search-outline" size={26} color={C.purple} />
            </View>
            <Text style={styles.emptyTitle}>Where do you want to go?</Text>
            <Text style={styles.emptySubtext}>
              Type in the search bar and select a destination.
            </Text>
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
    backgroundColor: "rgba(167,139,250,0.12)",
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
    backgroundColor: "rgba(167,139,250,0.1)",
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
    backgroundColor: "rgba(124,58,237,0.1)",
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
