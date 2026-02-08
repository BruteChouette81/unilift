import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

import DropdownSection from '@/components/dropdowns-sections';
import FavoriteRouteCard from '@/components/favorite-rides';
import RideCard from '@/components/ridecard';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/context/AuthContext';
import { acceptRide, fetchRides, geoSuggestion } from '@/services/rideServices';
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

const projectId = "unilift-6e756";

const apiKey = "AIzaSyDQMdY0la_sZuHvumHjFl4ibfCsOe1UW6Q"; // from Firebase console

export async function geocodePlace(
  place: string,
  apiKey: string
): Promise<{ lat: number; lon: number } | null> {
  try {
      const ors_apikep = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijk3YWZhNDcxNWRkZjQxZDliNjUxOGVlZDg4NmYxOTk2IiwiaCI6Im11cm11cjY0In0="
   
    const url = `https://api.openrouteservice.org/geocode/search`;

    const response = await fetch(
      `${url}?api_key=${ors_apikep}&text=${encodeURIComponent(place)}&size=1`
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
    const {user, loading} = useAuth()
  const [selectedRide, setSelectedRide] = useState<any>({
      driver: { name: "John D.", avatar: "https://via.placeholder.com/80" },
      destination: "Central Park",
      seats: 2,
      time: "10:15 AM",
    });
  
    const [createNewRide, setCreateNewRide] = useState(false)
  
   
  
    const [rides, setRides] = useState<any[]>([])
    const [favoriteRoutes, setFavoriteRoutes] = useState<any[]>([])
    
    const acceptARide = (id: string) => {
      acceptRide(id)
      alert("Ride accepted")
    }

    const [suggestions, setSuggestions] = useState<any[]>([]);
const [showSuggestions, setShowSuggestions] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<any>(null);


const allRides = [
  "Quebec",
  "St Antoine de Tilly",
  "St Jean",
  "St redempteur",
  "St Nicolas",
  "Cegep Limoilou",
  "Cegep Ste Foy",
  "Cegep Garneau",
  "Cegep Champlain St Lawrence",
];

const allCoords = [
  { lat: 46.8139, lon: -71.2080 }, // Quebec
  { lat: 46.6833, lon: -71.3333 }, // St Antoine de Tilly   
  { lat: 46.8167, lon: -71.2333 }, // St Jean
  { lat: 46.7833, lon: -71.2500 }, // St redempteur
  { lat: 46.7833, lon: -71.1833 }, // St Nicolas
  { lat: 46.7833, lon: -71.2333 }, // Cegep Limoilou
  { lat: 46.7833, lon: -71.2667 }, // Cegep Ste Foy
  { lat: 46.8000, lon: -71.2333 }, // Cegep Garneau
  { lat: 46.8167, lon: -71.2500 }, // Cegep Champlain St Lawrence
];

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
const handleSearch = async (text: string) => {
  setSearch(text);

  /*if (text.trim().length === 0) {
    setSuggestions([]);
    setShowSuggestions(false);
    return;
  }

  const results = await geoSuggestion(text.toLowerCase().trim())
  console.log(results)

  const filtered = allRides.filter((r) =>
    r.toLowerCase().includes(text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim())
  );

  setSuggestions(filtered);
  setShowSuggestions(true);*/
};

// When user taps a suggestion
const onSelectSuggestion = (value:any) => {
  
  setSearch(value.displayName);
  setShowSuggestions(false);
  // bounding box logic



  const box = getBoundingBox(parseFloat(value.lat), parseFloat(value.lon));
  console.log(box);
  setFilter(box);

};

    async function fetchUser(uid:string) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/users/${uid}?key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(res)
    } else {
       const data = await res.json();
    console.log("Firestore user data:", JSON.stringify(data.fields.favorite));
    return data
    }
   
  } catch (err) {
    console.error(err);
  }
}



async function whattodoonrefresh() {
  fetchRides().then(setRides).catch(console.error);
      if(!user) return;
      fetchUser(user.uid).then((data) => {
        if (data.fields.favorite?.arrayValue?.values?.length > 0) {
          const favs = data.fields.favorite.arrayValue.values.map((item: any) => ({
            destinationGeo: { lat: parseFloat(item.mapValue.fields.destinationGeolocation?.geoPointValue?.latitude),
                            lon: parseFloat(item.mapValue.fields.destinationGeolocation?.geoPointValue?.longitude) },
            destination: item.mapValue.fields.destination.stringValue,
          }));
          setFavoriteRoutes(favs);
        }}).catch(console.error);
}

  
   useEffect(() => {
      fetchRides().then(setRides).catch(console.error);
      if(!user) return;
      fetchUser(user.uid).then((data) => {
        if (data.fields.favorite?.arrayValue?.values?.length > 0) {
          const favs = data.fields.favorite.arrayValue.values.map((item: any) => ({
            destinationGeo: { lat: parseFloat(item.mapValue.fields.destinationGeolocation?.geoPointValue?.latitude),
                            lon: parseFloat(item.mapValue.fields.destinationGeolocation?.geoPointValue?.longitude) },
            destination: item.mapValue.fields.destination.stringValue,
          }));
          setFavoriteRoutes(favs);
        }}).catch(console.error);
    }, []);

    useEffect(() => {
    const timeout = setTimeout(async () => {
      if (search?.length < 2) {
        setShowSuggestions(false);
        //setSuggestions([]);
        return;
      }

      //setLoading(true);
      const results = await geoSuggestion(search);
      //console.log(results)
      setSuggestions(results);
      setShowSuggestions(true);
      //setLoading(false);
    }, 1000); // debounce

    return () => clearTimeout(timeout);
  }, [search]);

     const onRefresh = async () => {
    setRefreshing(true);
    await whattodoonrefresh(); // refetch your data or do other reloading logic
    setRefreshing(false);
  };
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
                                favoriteRoutes.map((route: any, index: number) => (
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
                      {rides.map((ride, index) => {
                       if (ride.destinationCoords.latitude >= filter.minLat && ride.destinationCoords.latitude <= filter.maxLat &&
                             ride.destinationCoords.longitude >= filter.minLng && ride.destinationCoords.longitude <= filter.maxLng ) {
                               return (
                                 ride.status=="planned" && <RideCard key={index} {...ride} />
                               )
                              }
                                 
                       })}
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
