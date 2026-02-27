import DateTimePicker from "@react-native-community/datetimepicker";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as Location from "expo-location";
import { GeoPoint } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";

import { router } from "expo-router";
import { createRide, geoSuggestion } from "../services/rideServices";

export default function CreateRideScreen(props: {cancelCreate: ()=> void}) {
  const [destination, setDestination] = useState("");

  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [seats, setSeats] = useState("1");
  const [suggestions, setSuggestions] = useState<any[]>([]);
const [showSuggestions, setShowSuggestions] = useState(false);
 const [liveRide, setLiveRide] = useState(true);
 const [destinationCoords, setDestinationCoords] = useState<{lat:number, lng:number}>()
 const debouncedDestination = useDebouncedValue(destination, 450);

 const onDestinationChange = (text:string) => {
  setDestination(text)
  setShowSuggestions(false);

  /*if (text.trim().length === 0) {
    setSuggestions([]);
    setShowSuggestions(false);
    return;
  }

  const filtered = allRides.filter((r) =>
    r.toLowerCase().includes(text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim())
  );

  setSuggestions(filtered);
  setShowSuggestions(true);*/
 }

    async function getUserLocation() {
        // Ask permission
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
            throw new Error("Location permission denied");
        }

        // Get coordinates
        const pos = await Location.getCurrentPositionAsync({});
        
        return {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
        };
    }


  async function handleSubmit() {
    if (!destination || !seats) {
      Alert.alert("Error", "Please fill out all fields.");
      return;
    }

    try {
      const loc = await getUserLocation();
      /*console.log(loc.latitude)
      const data = {
        origin,
        destination,
        date: date.toISOString(),
        seatsAvailable: parseInt(seats),
        geopoint: new GeoPoint(loc.latitude, loc.longitude)
      }
      console.log(data)*/
      const resjson = await createRide({
        destination,
        date: date.toISOString(),
        seatsAvailable: parseInt(seats),
        geopoint: new GeoPoint(loc.latitude, loc.longitude),
        destinationCoords: {lat: destinationCoords?.lat, lng: destinationCoords?.lng},
        started:liveRide
            
      });
      console.log(resjson)
      const rideId = resjson.name.split("/").pop();

      //props.cancelCreate()
      if (liveRide) {
      Alert.alert("Success", "Your ride has been created!");

      router.replace(`/riderScreen?rideId=${rideId}&maxSeat=${seats}&Originlat=${loc.latitude}&OriginLng=${loc.longitude}&Destination=${destination}`);

      } else {
        //planned
      Alert.alert("Success", "Your ride has been planned!");
      //router.replace(`/(tabs)`);
      props.cancelCreate()

      }

      //router.back();
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to create ride.");
    }
  }

  const onSelectSuggestion = (value: string, lat:number, lng:number) => {
    const destString = value.split(",")[0] + " " + value.split(",")[1];
  setDestination(destString);
  setDestinationCoords({lat, lng})
  setShowSuggestions(false);
};

    useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (debouncedDestination.length < 2) {
        setShowSuggestions(false);
        return;
      }

      const results = await geoSuggestion(debouncedDestination.trim());
      if (cancelled) return;
      setSuggestions(results ?? []);
      setShowSuggestions((results?.length ?? 0) > 0);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [debouncedDestination]);

  

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Create a New Ride</Text>

      <Text style={styles.label}>Origin: Your location</Text>
      

      <Text style={styles.label}>Destination</Text>
      <TextInput
        style={styles.input}
        placeholder="Ex: Montreal"
        placeholderTextColor="#888"
        value={destination}
        onChangeText={onDestinationChange}
      />
       {/* SUGGESTIONS DROPDOWN */}
       
        {showSuggestions && suggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            {suggestions.map((item, index) => (
              <TouchableOpacity
                       key={index}
                       onPress={() => onSelectSuggestion(item?.displayName, item?.lat, item?.lon)}
                       style={styles.suggestionItem}
                     >
                       <Text style={{color:"white"}}>{item?.displayName}</Text>
                     </TouchableOpacity>
            ))}
          </View>
        )}

         <View >
           <Text style={styles.label}>{liveRide ? "Starting you ride live" : "Plan your ride"} </Text>
      <Switch
        value={liveRide}
        onValueChange={setLiveRide}
      />

      {!liveRide && (
        <View >
          <Text style={styles.label}>Select the time and date</Text>

  <TouchableOpacity
    onPress={() => setShowPicker(true)}
    style={styles.dateButton}
  >
    <Text style={styles.dateText}>
      {date.toLocaleDateString()} —{" "}
      {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </Text>
  </TouchableOpacity>

  {showPicker && (
    <DateTimePicker
      value={date}
      mode="datetime"
      display={Platform.OS === "ios" ? "inline" : "default"}
      onChange={(event, selectedDate) => {
        if (event.type === "dismissed") {
          setShowPicker(false);
          return;
        }

        if (selectedDate) {
          // Force minutes & seconds to zero
          const cleanDate = new Date(selectedDate);
          cleanDate.setMinutes(0);
          cleanDate.setSeconds(0);

          setDate(cleanDate);
        }

        // Only close automatically on Android
        if (Platform.OS === "android") {
          setShowPicker(false);
        }
      }}
    />
  )}

  {/* iOS Done Button */}
  {Platform.OS === "ios" && showPicker && (
    <TouchableOpacity
      onPress={() => setShowPicker(false)}
      style={styles.doneButton}
    >
      <Text style={styles.doneText}>Done</Text>
    </TouchableOpacity>
  )}
        </View>
      )}
    </View>

      

      <Text style={styles.label}>Seats Available</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        value={seats}
        onChangeText={setSeats}
      />

      

      <TouchableOpacity onPress={handleSubmit} style={styles.submitButton}>
        <Text style={styles.submitText}>Create Ride</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => {props.cancelCreate()}} style={styles.cancelButton}>
        <Text style={styles.submitText}>Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    padding: 20,
    //paddingTop: 80
  },
  header: {
    color: "white",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 20,
  },
  label: {
    color: "#aaa",
    fontSize: 14,
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#1a1a1a",
    padding: 14,
    borderRadius: 10,
    color: "white",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#333",
  },
  dateButton: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#333",
  },
  dateText: {
    color: "white",
    fontSize: 16,
  },
  submitButton: {
    backgroundColor: "#4A8FFF",
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 30,
    alignItems: "center",
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
  cancelButton: {
    backgroundColor: "#ff4a4aff",
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 30,
    alignItems: "center",
  },
  submitText: {
    color: "white",
    fontSize: 18,
    fontWeight: "700",
  },
  doneButton: {
    marginTop: 12,
    alignSelf: "flex-end",
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: "#007AFF", // iOS blue
    borderRadius: 8,
  },
  doneText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
