// RideScreen.tsx
import { UserRideMapView } from '@/components/mapview';
import RatingScreen from '@/components/ratings';
import { useAuth } from '@/context/AuthContext';
import { NavigationProp } from '@react-navigation/native';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
// Define type for navigation prop (replace RootStackParamList with your stack types)
type RootStackParamList = {
  Home: undefined;
  Ride: undefined;
};

type RideScreenProps = {
  navigation: NavigationProp<RootStackParamList, 'Ride'>;
};


type RideParams = {
  rideId: string;
  maxSeat:string;
  Originlat:string;
  OriginLng:string;
  DestinationLat:string;
  DestinationLng:string;
};

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

 const projectId = "unilift-6e756";
        const apiKey = "AIzaSyDQMdY0la_sZuHvumHjFl4ibfCsOe1UW6Q"; // from Firebase console



/**
 * ride joined loc (marker)
 * time starting ride 
 * ETA from driver and to destination 
 * 
 */

export default function RideScreen({ navigation }: RideScreenProps) {
  const { rideId, Originlat, OriginLng, DestinationLat, DestinationLng } = useLocalSearchParams<RideParams>();
  const [originCoords, setOriginCoords] = React.useState<{latitude: number, longitude: number}>({latitude: 0, longitude: 0});
  const [destinationCoords, setDestinationCoords] = React.useState<{latitude: number, longitude: number}>({latitude: 0, longitude: 0});
  const [rideEnded, setRideEnded] = React.useState(false);

  useKeepAwake();
    const router = useRouter();

      const {user, loading} = useAuth()
    
  

  /*useFocusEffect(
    React.useCallback(() => {
      const onBackPress = () => true; // Block hardware back button
      BackHandler.addEventListener('hardwareBackPress', onBackPress);

      return () => BackHandler. removeEventListener('hardwareBackPress', onBackPress);
    }, [])
  );*/

  const quitRide = async () => {
    //make a full api call to cancel ride
     const rideUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/rides/${rideId}?key=${apiKey}?updateMask.fieldPaths=passengers,seatsAvailable`;

  // Get current passengers
  const rideRes = await fetch(rideUrl);
  const rideData = await rideRes.json();

  let currentPassengers =
    rideData.fields.passengers.arrayValue?.values?.map((v: any) => v.stringValue) || [];

  // Add this user
  //if (currentPassengers.includes(user?.uid)) return rideData; // already joined
 let newpassagers = currentPassengers.filter((pid:string) => pid !== user?.uid)
  

  const updateDoc = {
    fields: {

      passengers: {
        arrayValue: { values: newpassagers.map((id: string) => ({ stringValue: id })) },
      },
      seatsAvailable: {
        integerValue: Number(rideData.fields.seatsAvailable.integerValue + 1)
      }
    },
  };

  const updateRes = await fetch(rideUrl, { //+ `?key=${API_KEY}`
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updateDoc),
  });

  if (!updateRes.ok) throw new Error("Failed to accept ride");
  //return await updateRes.json();
  router.push('/(tabs)');

  }

  const endRide = () => {
    setRideEnded(true);
    //navigation.dispatch(StackActions.replace('Home')); // safely navigate back to home
  //router.push('/(tabs)');

  };

  useEffect(() => {
    /*const normalizedDest = Destination
  ?.toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();

const matchedRide = allRides.find(
  ride =>
    ride
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim() === normalizedDest
);

const rideIndex = matchedRide ? allRides.indexOf(matchedRide) : 0;*/

const originCoords = {
  latitude: parseFloat(Originlat),
  longitude: parseFloat(OriginLng)
};
setOriginCoords(originCoords);

const destCoords = {
  latitude: parseFloat(DestinationLat),
  longitude: parseFloat(DestinationLng)
};

setDestinationCoords(destCoords)}, [DestinationLat, DestinationLng, Originlat, OriginLng, setDestinationCoords, setOriginCoords]);
//check if kicked out of ride every 5 seconds
  useEffect(() => {
    const checkRide = async () => {
      try {
        const rideUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/rides/${rideId}?key=${apiKey}`;
        const rideRes = await fetch(rideUrl);
        const rideData = await rideRes.json();
        let currentPassengers =
          rideData.fields.passengers.arrayValue?.values?.map((v: any) => v.stringValue) || [];
        if (!currentPassengers.includes(user?.uid)) {
          // User has been removed from the ride
          alert("You have been removed from the ride.");
          router.push('/(tabs)');
        }
      } catch (error) {
        console.error("Error checking ride status:", error);
      }
    };
    const interval = setInterval(checkRide, 5000);
    return () => clearInterval(interval);
  }, [rideId, user?.uid, router]);

  return (
    rideEnded ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <View style={styles.mapContainer}>
    <UserRideMapView origin={originCoords} destination={destinationCoords} />
  </View>
      
      <View style={styles.infoContainer}>
        <Text style={styles.title}>Ride Mode</Text>
        <Text style={styles.status}>
          Joined ride {rideId}
        </Text>

        <TouchableOpacity style={styles.cancelBtn} onPress={quitRide}>
          <Text style={styles.cancelText}>Quit Ride</Text>
        </TouchableOpacity>
         <TouchableOpacity style={styles.cancelBtn} onPress={endRide}>
          <Text style={styles.cancelText}>End Ride</Text>
        </TouchableOpacity>
      </View>

     

      
    </View> :   <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}> 
      <RatingScreen rideId={rideId}/>
      
  </View>
  );
}

const styles = StyleSheet.create({
  
   container: { flex: 1, backgroundColor: "white" },
  
  mapContainer: { flex: 1 },

  infoContainer: {
    padding: 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderColor: "#eee",
  },

  title: { fontSize: 20, fontWeight: "bold", marginBottom: 4 },

  status: { fontSize: 16, color: "gray", marginBottom: 6 },

  timer: { fontSize: 18, marginBottom: 16 },

  cancelBtn: {
    backgroundColor: "#ff4d4d",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  startBtn: {
    backgroundColor: "#1e6828ff",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  cancelText: { color: "white", fontWeight: "bold", fontSize: 16 },
});