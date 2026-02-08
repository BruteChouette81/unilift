import React, { useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/*

import MapView from '@/components/mapview';*/
import CreateRideScreen from '@/components/create-ride';
import RideMapView from '@/components/mapview';
import RideCard, { RideCardSlected } from '@/components/ridecard';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { acceptRide, fetchRides, geoCode } from "../../services/rideServices";

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'expo-router';



const cegepLocation = [
   /*{"name": "Cegep St-Foy", "lat":46.786151, "lng": -71.286286819}, //46.786151275181425, -71.28628681997914
   {"name": "Cegep Champlain St-Lawrence", "lat":46.788592, "lng": -71.282054916}, //46.78859212490406, -71.28205491674998
   {"name": "Cegep Garneau", "lat":46.79293114, "lng": -71.264626980}, //46.79293114003179, -71.26462698028814
   {"name": "Universite Laval", "lat":46.7819830185, "lng": -71.27402889}, //46.78198301855337, -71.27402889335816*/
]

const placesLocation = [
   {"name": "Shaker St-Foy", "lat":46.78691890, "lng": -71.2822901}, //46.78691890002908, -71.28229019678189
   {"name": "Place Laurier", "lat":46.77146578, "lng": -71.28316956}, //46.771465785997044, -71.28316956330362

 
]

const projectId = "unilift-6e756";

const apiKey = "AIzaSyDQMdY0la_sZuHvumHjFl4ibfCsOe1UW6Q"; // from Firebase console

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
// Start ride mode
export default function HomeScreen() {
  const [selectedRide, setSelectedRide] = useState<any>();

  const [createNewRide, setCreateNewRide] = useState(false)
  const [homeLoc, setHomeLoc] = useState<any|{lat:Number, lng:Number}>()

  const [filter, setFilter] = useState<any>()
  const [placeGoing, setPLaceGoing] = useState<string>()
  const [favoriteRoutes, setFavoriteRoutes] = useState<any[]>([])
  
    const {user, loading} = useAuth()
  
  
  const router = useRouter();
 

  const [rides, setRides] = useState<any[]>([])
    const [refreshing, setRefreshing] = useState(false);


  
  
  const acceptARide = (id: string, started: boolean) => {
    acceptRide(id).then(() => {
      
      if (started) {
        //if started push to ridescreen
        Alert.alert("Ride accepted", "The ride will start now" )
        router.push(`/rideScreen?rideId=${id}&Originlat=${selectedRide?.origin?.latitude}&OriginLng=${selectedRide?.origin?.longitude}&Destination=${selectedRide.destination}`);}
        else {
          Alert.alert("Ride accepted", "The driver will start the ride when he/she is ready." )
        }

    })
    

  }

  const getHomeLoc = async() => {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/users/${user?.uid}?key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(res)
    } else {
       const data = await res.json();
    console.log("Firestore user data:", JSON.stringify(data.fields.homeAddress?.stringValue));
    if (!data.fields.homeAddress?.stringValue) {
      console.log("No home address set")
      setHomeLoc({lat: 0, lng:0})
      
    } else {
       const geoHomeloc = await geoCode(JSON.stringify(data.fields.homeAddress.stringValue))
      console.log(geoHomeloc)
      setHomeLoc({lat: geoHomeloc?.latitude, lng:geoHomeloc?.longitude})

    }
     if (data.fields.favorite?.arrayValue?.values?.length > 0) {

    const favs = data.fields.favorite?.arrayValue?.values.map((item: any) => ({
            destinationGeo: { lat: parseFloat(item.mapValue.fields.destinationGeolocation?.geoPointValue?.latitude),
                            lon: parseFloat(item.mapValue.fields.destinationGeolocation?.geoPointValue?.longitude) },
            destination: item.mapValue.fields.destination.stringValue,
          }));
      setFavoriteRoutes(favs);}
      else {
        setFavoriteRoutes([])
      }
    

    return data
    }
   
  } catch (err) {
    console.error(err);
  }
}

const rideSelect = (name:string, lat:number, lng:number) => {
  setPLaceGoing(name)
  const box = getBoundingBox(lat, lng)
  setFilter(box)
}

 useEffect(() => {
    /*const interval = setInterval(() => {
    fetchRides().then(setRides).catch(console.error);
  }, 10000); // every 10 seconds

  return () => clearInterval(interval);*/
    fetchRides().then((ridelist) => {
      ridelist?.forEach((ride: { passengerIds: string | string[]; started: any; id: any; origin: { latitude: any; longitude: any; }; destination: any; status: string;}) => {
      if (ride.passengerIds && ride.passengerIds.includes(user?.uid || "") && ride.started && ride.status=="planned") {
        //redirect to ride screen
        router.push(`/rideScreen?rideId=${ride.id}&Originlat=${ride.origin.latitude}&OriginLng=${ride.origin.longitude}&Destination=${ride.destination}`)
      }})
      setRides(ridelist);
    }).catch(console.error);
    //get user homeloc
    getHomeLoc()

    //check if some started and planned rides were accepted by user
    

    
  }, []);

   const onRefresh = async () => {
    setRefreshing(true);
    await fetchRides().then(setRides).catch(console.error);
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
    createNewRide ? <CreateRideScreen cancelCreate={()=>{setCreateNewRide(false)}}/> :
    <View>
      <ScrollView style ={styles.container} contentContainerStyle={{ paddingBottom: 120 }} refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} >
      {/* Map */}
      <ThemedView style={styles.mapContainer}>
        <RideMapView onPlaceSelect={rideSelect} placeLocalisations={placesLocation} favorites={favoriteRoutes} homeLocalisation={homeLoc} />
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
          {rides.map((ride, index) => {
             const onRideSelected = {
              ...ride,
    onPress: () => {
      setSelectedRide(ride)
    }
  }

  //destination filter /*ride.started ?*/
  if (ride.destinationCoords.latitude >= filter.minLat && ride.destinationCoords.latitude <= filter.maxLat &&
      ride.destinationCoords.longitude >= filter.minLng && ride.destinationCoords.longitude <= filter.maxLng ) {
        return (
          ride.status=="planned" && <RideCard key={index} {...onRideSelected} />
        )
      }

           /* return (
             ride.status=="planned" && <RideCard key={index} {...onRideSelected} />
          )*/
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
  
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
  container: {
  
    paddingHorizontal: 16,
    gap: 24, // space-y-6
     backgroundColor: "#101010",
    padding: 20,
    //paddingTop: 70,
     
  },
  mapContainer: {
    height: 400,
    borderRadius: 16,
    overflow: "hidden",
    
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3, // for Android shadow
  },
  selectedRideContainer: {
    marginTop: 16,
     backgroundColor: "#101010",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111",
    marginBottom: 12,
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
    elevation: 6, // Android shadow
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
