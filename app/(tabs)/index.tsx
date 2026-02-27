import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import CreateRideScreen from "@/components/create-ride";
import RideMapView from "@/components/mapview";
import RideCard, { RideCardSlected } from "@/components/ridecard";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { acceptRide, fetchRides, geoCode } from "../../services/rideServices";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";
import {
  extractFavoriteRoutes,
  fetchUserDocument,
} from "@/services/userService";
import type { FavoriteRoute, Ride } from "@/types/models";

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
          },
        );
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

  const NoRideSelected = () => {
  return (
    <View style={styles.containerNoride}>
      <Text style={styles.title}>No ride selected</Text>
      <Text style={styles.subtitle}>
        Select a place on the map to view available rides.
      </Text>
    </View>
  );
};
  return (
    createNewRide ? <CreateRideScreen cancelCreate={() => { setCreateNewRide(false); }} /> :
    <View>
      <ScrollView style ={styles.container} contentContainerStyle={{ paddingBottom: 120 }} refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} >
      {/* Map */}
      <ThemedView style={styles.mapContainer}>
        <RideMapView onPlaceSelect={rideSelect} placeLocalisations={placesLocation} favorites={favoriteRoutes} homeLocalisation={homeLoc ?? { lat: 0, lng: 0 }} />
      </ThemedView>

      {/* Selected Ride */}
      {selectedRide && (
        <ThemedView style={styles.selectedRideContainer}>
          <ThemedText >Selected Ride</ThemedText>
          <RideCardSlected driverId={selectedRide.driverId}
            rating={selectedRide.rating}
            destination={selectedRide.destination}
            seatsAvailable={selectedRide.seatsAvailable}
            time={selectedRide.time}
            origin={selectedRide.origin}
            level={selectedRide.xp}
            onPress={() => {acceptARide(selectedRide.id, selectedRide.started)}}
            onCancel={() => {setSelectedRide("")}}
            
          />
        </ThemedView>
      )}

      {/* Nearby Rides */}
      {filter ? !selectedRide && 
      <ThemedView style={styles.nearbyContainer}>
        <ThemedText >Select your ride</ThemedText>
        <ThemedView style={styles.rideList}>
          {rides.map((ride) => {
             const onRideSelected = {
              ...ride,
              rating: 0,
              level: 0,
              time: ride.time ?? "",
              origin: `${ride.localisation.latitude.toFixed(3)}, ${ride.localisation.longitude.toFixed(3)}`,
    onPress: () => {
      setSelectedRide(onRideSelected)
    }
  }

  if (ride.destinationCoords.latitude >= filter.minLat && ride.destinationCoords.latitude <= filter.maxLat &&
      ride.destinationCoords.longitude >= filter.minLng && ride.destinationCoords.longitude <= filter.maxLng ) {
        return (
          ride.status === "planned" && <RideCard key={ride.id} {...onRideSelected} />
        )
      }
          })}
        </ThemedView>
      </ThemedView> : <View>
        <NoRideSelected/>
        </View>}
      
    </ScrollView>
    <TouchableOpacity style={styles.floatingButton} onPress={() => { setCreateNewRide(true)}}>
        <Text style={styles.floatingButtonText}>Start a New Ride</Text>
      </TouchableOpacity>
        
    </View>
    
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    gap: 24,
     backgroundColor: "#101010",
    padding: 20,
  },
  mapContainer: {
    height: 400,
    borderRadius: 16,
    overflow: "hidden",
    
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  selectedRideContainer: {
    marginTop: 16,
     backgroundColor: "#101010",
  },
  nearbyContainer: {
    marginTop: 8,
     backgroundColor: "#101010",
  },
  rideList: {
    gap: 12,
  },
   floatingButton: {
    position: "absolute",
    bottom: 30,
    left: 20,
    right: 20,
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  floatingButtonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
   title: {
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
    color: "white",
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    color: "#555",
    lineHeight: 22,
  },
  containerNoride: {
    marginTop: 50,
    marginBottom: 25,
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
});
