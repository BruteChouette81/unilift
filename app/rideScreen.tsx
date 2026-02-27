// RideScreen.tsx
import { UserRideMapView } from '@/components/mapview';
import RatingScreen from '@/components/ratings';
import { useAuth } from '@/context/AuthContext';
import { useAdaptivePolling } from '@/hooks/use-adaptive-polling';
import { NavigationProp } from '@react-navigation/native';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  firestoreDocumentUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
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

const toSafeNumber = (value: string, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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

      const {user} = useAuth()
    
  

  /*useFocusEffect(
    React.useCallback(() => {
      const onBackPress = () => true; // Block hardware back button
      BackHandler.addEventListener('hardwareBackPress', onBackPress);

      return () => BackHandler. removeEventListener('hardwareBackPress', onBackPress);
    }, [])
  );*/

  const quitRide = async () => {
    if (!user) return;
    //make a full api call to cancel ride
     const rideUrl = withFirebaseApiKey(
      `${firestoreDocumentUrl("rides", rideId)}?updateMask.fieldPaths=passengers,seatsAvailable`,
    );

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
  latitude: toSafeNumber(Originlat),
  longitude: toSafeNumber(OriginLng)
};
setOriginCoords(originCoords);

const destCoords = {
  latitude: toSafeNumber(DestinationLat),
  longitude: toSafeNumber(DestinationLng)
};

setDestinationCoords(destCoords)}, [DestinationLat, DestinationLng, Originlat, OriginLng, setDestinationCoords, setOriginCoords]);
  const hasNavigatedAwayRef = useRef(false);
  useAdaptivePolling(
    async () => {
      try {
        const rideUrl = withFirebaseApiKey(
          firestoreDocumentUrl("rides", rideId),
        );
        const rideRes = await fetch(rideUrl);
        if (!rideRes.ok) return false;
        const rideData = await rideRes.json();
        let currentPassengers =
          rideData.fields.passengers.arrayValue?.values?.map((v: any) => v.stringValue) || [];
        const removed = !currentPassengers.includes(user?.uid);
        if (removed && !hasNavigatedAwayRef.current) {
          // User has been removed from the ride
          hasNavigatedAwayRef.current = true;
          alert("You have been removed from the ride.");
          router.push('/(tabs)');
        }
        return !removed;
      } catch (error) {
        console.error("Error checking ride status:", error);
        return false;
      }
    },
    {
      enabled: Boolean(rideId && user?.uid),
      initialDelayMs: 2500,
      maxDelayMs: 30000,
      backoffFactor: 1.8,
    },
  );

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
