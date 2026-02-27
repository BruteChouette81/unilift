/**
 * map view with polylines and markers
 * passenger that enters
 * cancels ride (must alert passenger and driver)
 * timer to start ride
 */


import { DriverRideMapView } from "@/components/mapview";
import { useKeepAwake } from "expo-keep-awake";
import { useAdaptivePolling } from "@/hooks/use-adaptive-polling";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import { Alert, Button, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  firestoreDocumentUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";

/*
* Map with markers for origin, passengers, and destination
* Countdown timer until ride starts
* Listen for passenger joining the ride 
* Cancel ride button that notifies passenger
* Button to start ride manually (if needed)
* When ride starts, got to google maps navigation
* End ride button (not implemented yet)
*/



// Types
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

export default function RideModeDriver() {
  useKeepAwake();
  const router = useRouter();
  const { rideId, Originlat, OriginLng, DestinationLat, DestinationLng } = useLocalSearchParams<RideParams>();
  //const [destinationCoords, setDestinationCoords] = useState<{latitude: number, longitude: number} | null>(null);

  const [passengerJoined, setPassengerJoined] = useState<string[]>();

  const [passengersCoords, setPassengersCoords] = useState<{latitude: number, longitude: number}[] | null>(null);
  const [rideStarted, setRideStarted] = useState(false);
  
  //const [countdown, setCountdown] = useState(20); // 20-second countdown example
  //const [rideCancelled, setRideCancelled] = useState(false);
        const url = withFirebaseApiKey(firestoreDocumentUrl("rides", rideId));

const originCoords = {
  latitude: toSafeNumber(Originlat),
  longitude: toSafeNumber(OriginLng)
};


const destCoords = {
latitude: toSafeNumber(DestinationLat),
longitude: toSafeNumber(DestinationLng)
};

  const passengerCountRef = useRef(0);
  useAdaptivePolling(
    async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return false;

        const data = await res.json();
        const ids =
          data?.fields?.passengers?.arrayValue?.values?.map((v: any) => v.stringValue) ?? [];

        if (ids.length > passengerCountRef.current) {
          Alert.alert("Passenger Joined", "A new passenger joined your ride.");
        }
        passengerCountRef.current = ids.length;
        setPassengerJoined((prev) => {
          const prevKey = (prev ?? []).join(",");
          const nextKey = ids.join(",");
          return prevKey === nextKey ? prev : ids;
        });
        return ids.length > 0;
      } catch (e) {
        console.log("Error polling ride:", e);
        return false;
      }
    },
    {
      enabled: Boolean(rideId),
      initialDelayMs: 1500,
      maxDelayMs: 20000,
      backoffFactor: 1.6,
    },
  );


  // ❌ CANCEL RIDE (via Fetch DELETE)
  const cancelRide = async () => {
    if (!rideId) return;

    try {
       
      await fetch(url, {
        method: "DELETE",
      });

      Alert.alert("Ride Cancelled", "The passenger has been notified.");
      router.replace("/");
    } catch (e) {
      Alert.alert("Error", "Failed to cancel ride.");
      console.log(e);
    }
  };

  const endRide = async () => {
  //change status to completed
    const url = withFirebaseApiKey(
      `${firestoreDocumentUrl("rides", rideId)}?updateMask.fieldPaths=status`,
    );

  const body = {
    fields: {
      status: {
        stringValue: "completed"
      }
    }
  };

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to end ride: ${errorText}`);
  }

  Alert.alert("Ride Ended", "The ride has been completed.");
  router.replace("/");
  }

  const onPassengerKicked = async (passengerId: string) => {
    Alert.alert("Passenger Kicked", `Passenger ${passengerId} has been removed from the ride.`);
    
     const url = withFirebaseApiKey(firestoreDocumentUrl("rides", rideId));

  const body = {
    fields: {
      passengers: {
        arrayValue: {
          values: [
            {
              stringValue: passengerId,
            },
          ],
        },
      },
    },
    updateTransforms: [
      {
        fieldPath: "passengers",
        removeAllFromArray: {
          values: [
            {
              stringValue: passengerId,
            },
          ],
        },
      },
      {
        fieldPath: "availableSeats",
        increment: {
          integerValue: 1,
        },
      },
    ],
  };

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      //Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to kick passenger: ${errorText}`);
  }

    

  }

  const DisplayPassenger = (passengerId:string) => {
    return (
      <View
          key={passengerId}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginVertical: 6,
          }}
        >
          <Text>{passengerId}</Text>

          <Button
            title="Kick"
            color="#d32f2f"
            onPress={() =>
              onPassengerKicked(passengerId)
            }
          />
        </View>
    )


  }



  const openGoogleMaps = (coords: any[]) => {
    // coords is an array of { latitude, longitude }
    const path = coords.map(c => `${c.latitude},${c.longitude}`).join('/');
    const url = `https://www.google.com/maps/dir/${path}`;
    Linking.openURL(url);
  };


  //start ride manually
  const startRideManually = () => {
    Alert.alert("Ride Started", "The ride is now active.");
    if (!passengersCoords) {
      let coord = [originCoords, destCoords];
    //console.log(coord);
    setRideStarted(true);
    openGoogleMaps(coord);
    } else {
    let coord = [originCoords, ...passengersCoords.map((p) => {
      return {latitude: p.latitude, longitude: p.longitude};
    }), destCoords];
    //console.log(coord);
    setRideStarted(true);

    openGoogleMaps(coord);
  }
    //router.replace(`/driver/activeRide?rideId=${rideId}`);
  }


  // 🚀 Automatically start ride when countdown ends & passenger joined
  /*useEffect(() => {
    if (countdown === 0 && passengerJoined) {
      Alert.alert("Ride Started", "The ride is now active.");
      //router.replace(`/driver/activeRide?rideId=${rideId}`);
    }
  }, [countdown, passengerJoined]);*/



  return (
    <View style={styles.container}>
      {/* Map View */}
      <View style={styles.mapContainer}>
        <DriverRideMapView origin={originCoords} destination={destCoords} passengers={passengerJoined} setCoords={setPassengersCoords}/>
      </View>

      {!rideStarted ? (<View style={styles.infoContainer}>
        <Text style={styles.title}>Driver Ride Mode</Text>

        <Text style={styles.status}>
          {passengerJoined && passengerJoined.length>0 ? `${passengerJoined.length} Passenger Joined` : "Waiting for passenger..."}
        </Text>

        {passengerJoined && passengerJoined.length>0 && passengerJoined.map((pid) => DisplayPassenger(pid))}

         <TouchableOpacity style={styles.startBtn} onPress={startRideManually}>
          <Text style={styles.cancelText}>Start Now!</Text>
        </TouchableOpacity>


        <TouchableOpacity style={styles.cancelBtn} onPress={cancelRide}>
          <Text style={styles.cancelText}>Cancel Ride</Text>
        </TouchableOpacity>
      </View>) : <View style={styles.infoContainer}>
        <Text style={styles.title}>Ride In Progress</Text>
        <Text style={styles.status}>Navigate using Google Maps</Text>
        <TouchableOpacity style={styles.cancelBtn} onPress={endRide}>
          <Text style={styles.cancelText}>End Ride</Text>
        </TouchableOpacity>
         </View>
}
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
    marginBottom: 10,
  },
  cancelText: { color: "white", fontWeight: "bold", fontSize: 16 },
});
