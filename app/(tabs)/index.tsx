import CreateRideScreen from "@/components/create-ride";
import RideMapView from "@/components/mapview";
import RideCard, { RideCardSlected } from "@/components/ridecard";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { acceptRide, fetchRides, geoCode } from "../../services/rideServices";

import { useAuth } from "@/context/AuthContext";
import {
  extractFavoriteRoutes,
  fetchUserDocument,
} from "@/services/userService";
import { recommendRides } from "@/hooks/use-ride-recommendations";
import type { FavoriteRoute, LocationPoint, Ride, ScoredRide, UserProfile } from "@/types/models";
import { useRouter } from "expo-router";

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(124, 58, 237, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#7C3AED",
  purpleLight: "#a78bfa",
  blue:        "#1D4ED8",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  gold:        "#fbbf24",
};

const CARD_GRADIENT   = ["#1e1b4b", "#0d1224"] as const;
const BUTTON_GRADIENT = ["#7C3AED", "#2563eb"] as const;

const placesLocation = [
  { name: "Shaker St-Foy", lat: 46.7869189, lng: -71.2822901 },
  { name: "Place Laurier", lat: 46.77146578, lng: -71.28316956 },
];

const radius = 10;

function getBoundingBox(lat: number, lng: number) {
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

// ─── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={sh.row}>
      <View style={sh.left}>
        <View style={sh.iconDot}>
          <Ionicons name={icon as any} size={14} color={C.purpleLight} />
        </View>
        <Text style={sh.title}>{title}</Text>
      </View>
    </View>
  );
}

const sh = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "center", marginBottom: 10, marginTop: 20 },
  left:    { flexDirection: "row", alignItems: "center", gap: 8 },
  iconDot: { width: 26, height: 26, borderRadius: 7, backgroundColor: "rgba(167,139,250,0.12)", alignItems: "center", justifyContent: "center" },
  title:   { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const [selectedRide, setSelectedRide] = useState<any>();
  const [createNewRide, setCreateNewRide] = useState(false);
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
  const router = useRouter();
  const [rides, setRides] = useState<Ride[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

  const acceptARide = (id: string, started: boolean) => {
    acceptRide(id).then(() => {
      if (started) {
        Alert.alert("Ride accepted", "The ride will start now");
        router.push(
          `/rideScreen?rideId=${id}&Originlat=${selectedRide?.origin?.latitude}&OriginLng=${selectedRide?.origin?.longitude}&Destination=${selectedRide.destination}`,
        );
      } else {
        Alert.alert(
          "Ride accepted",
          "The driver will start the ride when he/she is ready.",
        );
      }
    });
  };

  const getHomeLoc = useCallback(async () => {
    try {
      const data = await fetchUserDocument(user?.uid || "");
      if (!data) return;
      const fields = asRecord(data.fields) ?? {};
      const homeAddressField = asRecord(fields.homeAddress);
      const homeAddress =
        typeof homeAddressField?.stringValue === "string"
          ? homeAddressField.stringValue
          : "";
      if (!homeAddress) {
        setHomeLoc({ lat: 0, lng: 0 });
      } else {
        const geoHomeloc = await geoCode(JSON.stringify(homeAddress));
        setHomeLoc({
          lat: geoHomeloc?.latitude ?? 0,
          lng: geoHomeloc?.longitude ?? 0,
        });
      }
      const favs = extractFavoriteRoutes(data);
      setFavoriteRoutes(favs.length > 0 ? favs : []);
      try {
        const Location = await import("expo-location");
        const pos = await Location.getCurrentPositionAsync({});
        setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      } catch {
        // GPS unavailable — leave userLocation null for neutral fallback scores
      }
      return data;
    } catch (err) {
      console.error(err);
    }
  }, [user?.uid]);

  const rideSelect = (_name: string, lat: number, lng: number) => {
    const box = getBoundingBox(lat, lng);
    setFilter(box);
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
              `/rideScreen?rideId=${ride.id}&Originlat=${ride.localisation.latitude}&OriginLng=${ride.localisation.longitude}&Destination=${ride.destination}`,
            );
          }
        });
        setRides(ridelist);
      })
      .catch(console.error);
    getHomeLoc();
  }, [getHomeLoc, router, user?.uid]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRides({ force: true }).then(setRides).catch(console.error);
    await getHomeLoc();
    setRefreshing(false);
  };

  const filteredRides = useMemo(() => {
    if (!filter) return [];
    return rides.filter(
      (ride) =>
        ride.destinationCoords.latitude  >= filter.minLat &&
        ride.destinationCoords.latitude  <= filter.maxLat &&
        ride.destinationCoords.longitude >= filter.minLng &&
        ride.destinationCoords.longitude <= filter.maxLng &&
        ride.status === "planned",
    );
  }, [filter, rides]);

  const scoredRides = useMemo((): ScoredRide[] => {
    const profile: UserProfile = {
      email: "", xp: 0, rating: 0, avatar: null, homeAddress: null,
      localisation: userLocation ?? { latitude: null, longitude: null },
      ridesCompleted: 0,
      favorite: favoriteRoutes,
    };
    return recommendRides(filteredRides, profile);
  }, [filteredRides, favoriteRoutes, userLocation]);

  if (createNewRide) {
    return <CreateRideScreen cancelCreate={() => setCreateNewRide(false)} />;
  }

  return (
    <View style={styles.shell}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.purpleLight}
          />
        }
      >
        {/* ── Map ─────────────────────────────────────────────────────────── */}
        <LinearGradient colors={CARD_GRADIENT} style={styles.mapCard}>
          <RideMapView
            onPlaceSelect={rideSelect}
            placeLocalisations={placesLocation}
            favorites={favoriteRoutes}
            homeLocalisation={homeLoc ?? { lat: 0, lng: 0 }}
          />
        </LinearGradient>

        {/* ── Selected Ride ────────────────────────────────────────────────── */}
        {selectedRide && (
          <>
            <SectionHeader icon="car-outline" title="Selected Ride" />
            <View style={styles.rideContainer}>
              <RideCardSlected
                driverId={selectedRide.driverId}
                rating={selectedRide.rating}
                destination={selectedRide.destination}
                seatsAvailable={selectedRide.seatsAvailable}
                time={selectedRide.time}
                origin={selectedRide.origin}
                level={selectedRide.xp}
                onPress={() => acceptARide(selectedRide.id, selectedRide.started)}
                onCancel={() => setSelectedRide("")}
              />
            </View>
          </>
        )}

        {/* ── Nearby Rides / Empty State ───────────────────────────────────── */}
        {filter ? (
          !selectedRide && (
            <>
              <SectionHeader icon="navigate-outline" title="Select your ride" />
              <View style={styles.rideList}>
                {scoredRides.map((ride) => {
                  const onRideSelected = {
                    ...ride,
                    rating: 0,
                    level: 0,
                    time: ride.time ?? "",
                    origin: `${ride.localisation.latitude.toFixed(3)}, ${ride.localisation.longitude.toFixed(3)}`,
                    onPress: () => setSelectedRide(onRideSelected),
                  };
                  return <RideCard key={ride.id} {...onRideSelected} />;
                })}
              </View>
            </>
          )
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="map-outline" size={26} color={C.purple} />
            </View>
            <Text style={styles.emptyTitle}>No ride selected</Text>
            <Text style={styles.emptySubtext}>
              Select a place on the map to view available rides.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── Floating Action Button ───────────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.floatingButton}
        onPress={() => setCreateNewRide(true)}
        activeOpacity={0.85}
      >
        <LinearGradient
          colors={BUTTON_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.floatingBtnGrad}
        >
          <Ionicons name="add-circle-outline" size={20} color="#fff" />
          <Text style={styles.floatingButtonText}>Start a New Ride</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Shell ────────────────────────────────────────────────────────────────
  shell: {
    flex: 1,
    backgroundColor: C.bg,
  },
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 120,
  },

  // ── Map ───────────────────────────────────────────────────────────────────
  mapCard: {
    height: 400,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
  },

  // ── Ride Containers ───────────────────────────────────────────────────────
  rideContainer: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.borderFaint,
    overflow: "hidden",
  },
  rideList: {
    gap: 10,
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

  // ── Empty State ────────────────────────────────────────────────────────────
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    marginTop: 16,
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
