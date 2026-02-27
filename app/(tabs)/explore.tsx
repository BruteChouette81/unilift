import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import DropdownSection from '@/components/dropdowns-sections';
import FavoriteRouteCard from '@/components/favorite-rides';
import RideCard from '@/components/ridecard';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/context/AuthContext';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { fetchRides, geoSuggestion, type LocationResult } from '@/services/rideServices';
import { extractFavoriteRoutes } from '@/services/userService';
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FavoriteRoute, Ride } from '@/types/models';
import {
  firestoreDocumentUrl,
  runtimeConfig,
  withFirebaseApiKey,
} from "@/constants/runtime-config";

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
    const {user} = useAuth()
    const [rides, setRides] = useState<Ride[]>([])
    const [favoriteRoutes, setFavoriteRoutes] = useState<FavoriteRoute[]>([])
    const debouncedSearch = useDebouncedValue(search, 400);
    
    const [suggestions, setSuggestions] = useState<LocationResult[]>([]);
const [showSuggestions, setShowSuggestions] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<{
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null>(null);


const radius = 10

function getBoundingBox(lat:number, lng:number) {
  const earthRadius = 6371;

  const latDelta = (radius / earthRadius) * (180 / Math.PI);
  const lngDelta =
    (radius / earthRadius) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180);

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta
  };
}

// Trigger suggestions
const handleSearch = (text: string) => {
  setSearch(text);
};

// When user taps a suggestion
const onSelectSuggestion = (value: LocationResult) => {
  
  setSearch(value.displayName);
  setShowSuggestions(false);
  // bounding box logic



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

    const fetchUser = useCallback(async (uid:string, token?: string, email?: string | null) => {
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
    return data
    }
   
  } catch (err) {
    console.error(err);
    return null;
  }
}, [createDefaultUserProfile]);

const reloadData = useCallback(async (forceRidesFetch = false) => {
  const rideData = await fetchRides({ force: forceRidesFetch }).catch(() => []);
  setRides(rideData);
  if(!user) return;

  const token = await user.getIdToken().catch(() => null);
  const data = await fetchUser(user.uid, token ?? undefined, user.email).catch(() => null);
  const favs = extractFavoriteRoutes(data);
  setFavoriteRoutes(favs);
}, [fetchUser, user]);

  
   useEffect(() => {
      void reloadData();
    }, [reloadData]);

    useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (debouncedSearch?.length < 2) {
        setShowSuggestions(false);
        setSuggestions([]);
        return;
      }

      const results = await geoSuggestion(debouncedSearch.trim());
      if (cancelled) return;
      setSuggestions(results ?? []);
      setShowSuggestions((results?.length ?? 0) > 0);
    };

    void run();
    return () => {
      cancelled = true;
    };
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
   {/*<Text>Find rides near you</Text>*/}
         {/* Search Bar */}
  
  return (
    <ScrollView  style={styles.container} refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
       

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#aaa" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search rides..."
          placeholderTextColor="#777"
          value={search}
          onChangeText={handleSearch}
        />
        
      </View>
      {/* SUGGESTIONS DROPDOWN */}
  {showSuggestions && suggestions?.length > 0 && (
    <View style={styles.suggestionsContainer}>
      {suggestions.map((item, index) => (
        <TouchableOpacity
          key={index}
          onPress={() => onSelectSuggestion(item)}
          style={styles.suggestionItem}
        >
          <Text style={{color:"white"}}>{item.displayName}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )}
       <DropdownSection title="⭐ Favorite Routes">
        <ThemedView style={styles.rideList}>
                      {favoriteRoutes ? 
                                favoriteRoutes.map((route: FavoriteRoute, index: number) => (
                                   <FavoriteRouteCard
                                   key={index}
                             
                              destination={route.destination}
                              onPress={() => {
                                onSelectSuggestion({displayName: route.destination, lat: route.destinationGeo.lat.toString(), lon: route.destinationGeo.lon.toString()})
                                //alert("Clicked!")
                                }}
                            />
                                ) )
                               : <Text>No favorite routes yet.</Text>}
                    </ThemedView>
       
      </DropdownSection>

            {filter ? <ThemedView style={styles.rideList}>
                      {filteredRides.map((ride) => (
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
                    </ThemedView> :  <View style={styles.containerNoride}>
      <Text style={styles.title}>Where do you want to go ?</Text>
      <Text style={styles.subtitle}>
        Type in the search bar and select a destination.
      </Text>
    </View>}
          
      
    </ScrollView>
  );
}

const styles = StyleSheet.create({
   container: {
    paddingBottom: 96, // ~pb-24
    paddingHorizontal: 16,
    gap: 24, // space-y-6
    //paddingTop:70,
    backgroundColor: "#101010",
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  nearbyContainer: {
    marginTop: 8,
  },
  rideList: {
    gap: 12,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E1E1E",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#333",
    paddingHorizontal: 12,
    height: 50,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: "white",
    fontSize: 16,
  },
  suggestionsContainer: {
  backgroundColor: "#222",
  borderRadius: 8,
  marginTop: 0,
  paddingVertical: 4,
  marginBottom: 16,
},

suggestionItem: {
  padding: 12,
  borderBottomWidth: 1,
  borderBottomColor: "rgba(255,255,255,0.1)",
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
